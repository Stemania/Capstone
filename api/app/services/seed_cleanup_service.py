"""Find, and optionally remove, clients and suppliers made by the seed scripts.

Used by `flask cleanup-seed-data` (a dry run unless --apply). Every client and
supplier is put in one group:

- REAL: a supplier from the reference loader (by code, name or alias, or a
  retired reference supplier), or a record entered in the app (an audit-log
  CREATE by a user, or job orders / supplier orders that are not seed-tagged).
- SEED: made by a seed script. Clients: a name starting "HIST-SEED " or
  "TC-SEED ", a contact or email ending ".local", or one of `flask seed`'s
  demo clients. Suppliers: is_seed or the same markers, and not REAL.
- DUPLICATE: a supplier renamed "<name> (duplicate)" by the reference loader;
  it merges into the reference supplier that name or alias belongs to.
- UNSURE: anything else, or a seed-looking record that also carries work
  entered in the app. Never changed.

--apply removes SEED clients and suppliers with everything that belongs only
to them (option A): their job orders with operations, time logs, helpers,
material lines, schedule moves, alerts, notifications and invoices; supplier
orders that are seed-tagged or carry only seed-job lines; and seed-tagged or
seed-job machine downtimes. Consumable stock movements are kept and only lose
their link to the deleted job or line. DUPLICATE suppliers have their
references moved to the target and are then deleted. Users, machines,
operation types, the catalog, consumables, shop details and every REAL or
UNSURE record are never changed. Running it twice changes nothing the
second time.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import bindparam, text

from app.extensions import db
from app.services.reference_data_service import (
    DUPLICATE_SUFFIX,
    INACTIVE_SUPPLIERS,
    SUPPLIERS,
)

SEED_TAGS = ("HIST-SEED", "TC-SEED")
SEED_EMAIL_SUFFIX = ".local"
# `flask seed`'s demo clients, as (name, contact).
DEMO_CLIENTS = (
    ("ABC Manufacturing", "09171234567"),
    ("Metro Steel Corp", "09181234567"),
    ("Pacific Engineering", "09191234567"),
)

REAL, SEED, DUPLICATE, UNSURE = "REAL", "SEED", "DUPLICATE", "UNSURE"
GROUPS = (REAL, SEED, DUPLICATE, UNSURE)


@dataclass
class Record:
    kind: str  # "client" | "supplier"
    id: str
    name: str
    group: str
    reason: str
    merge_into: tuple[str, str] | None = None  # (id, name) for DUPLICATE
    linked: dict = field(default_factory=dict)


@dataclass
class Plan:
    clients: list[Record]
    suppliers: list[Record]
    seed_job_ids: list[str]
    seed_order_ids: list[str]
    seed_downtime_ids: list[str]
    seed_orders_by_supplier: dict
    untouched: dict
    before: dict | None = None
    after: dict | None = None

    def records(self, kind=None, group=None):
        rows = self.clients + self.suppliers
        return [
            r for r in rows if (kind is None or r.kind == kind) and (group is None or r.group == group)
        ]


def _rows(sql, **params):
    stmt = text(sql)
    expanding = [k for k, v in params.items() if isinstance(v, (list, tuple, set))]
    if expanding:
        stmt = stmt.bindparams(*(bindparam(k, expanding=True) for k in expanding))
        params = {k: (list(v) if k in expanding else v) for k, v in params.items()}
    return db.session.execute(stmt, params).all()


def _scalar(sql, **params):
    return _rows(sql, **params)[0][0]


def _exec(sql, **params):
    stmt = text(sql)
    expanding = [k for k, v in params.items() if isinstance(v, (list, tuple, set))]
    if expanding:
        stmt = stmt.bindparams(*(bindparam(k, expanding=True) for k in expanding))
        params = {k: (list(v) if k in expanding else v) for k, v in params.items()}
    return db.session.execute(stmt, params).rowcount


def _tagged(value) -> bool:
    v = (value or "").strip()
    return any(v == t or v.startswith(f"{t} ") or v.startswith(f"{t}-") for t in SEED_TAGS)


def _seed_po(po) -> bool:
    return any((po or "").startswith(f"{t}-") for t in SEED_TAGS)


def _local(value) -> bool:
    return (value or "").strip().lower().endswith(SEED_EMAIL_SUFFIX)


def _created_in_app(entity_type) -> dict:
    """{entity id: role} for records an audit log says a user created."""
    return {
        eid: role
        for eid, role in _rows(
            "SELECT entity_id, user_role FROM audit_logs "
            "WHERE entity_type = :t AND action = 'CREATE' AND user_id IS NOT NULL",
            t=entity_type,
        )
    }


def _reference_supplier(name):
    """The reference spec a supplier name (or alias) belongs to, if any."""
    low = (name or "").strip().lower()
    for spec in SUPPLIERS:
        if low in {n.lower() for n in (spec["name"], *spec["aliases"])}:
            return spec
    return None


# --- Classification ----------------------------------------------------------


def _classify_clients(app_created) -> list[Record]:
    jobs = {}
    for cid, po in _rows("SELECT client_id, client_po_number FROM job_orders"):
        jobs.setdefault(cid, []).append(po)
    demo = {(n.lower(), c) for n, c in DEMO_CLIENTS}
    out = []
    for cid, name, contact, email in _rows(
        "SELECT id, name, contact, email FROM clients ORDER BY name"
    ):
        pos = jobs.get(cid, [])
        app_jobs = [po for po in pos if not _seed_po(po)]
        markers = []
        if _tagged(name):
            markers.append("seed name")
        if _local(contact) or _local(email):
            markers.append(".local contact")
        if ((name or "").strip().lower(), (contact or "").strip()) in demo:
            markers.append("`flask seed` demo client")
        if markers and not app_jobs and cid not in app_created:
            out.append(Record("client", cid, name, SEED, ", ".join(markers)))
        elif markers:
            why = f"{', '.join(markers)}, but "
            why += (
                f"{len(app_jobs)} job order(s) entered in the app"
                if app_jobs
                else f"created in the app by {app_created[cid]}"
            )
            out.append(Record("client", cid, name, UNSURE, why))
        elif cid in app_created:
            out.append(Record("client", cid, name, REAL, f"entered in the app by {app_created[cid]}"))
        elif app_jobs:
            out.append(Record("client", cid, name, REAL, f"{len(app_jobs)} job order(s) entered in the app"))
        else:
            out.append(Record("client", cid, name, UNSURE, "no seed markers and no app history"))
    return out


def _seed_supplier_order_ids(seed_job_ids) -> tuple[set, dict]:
    """Supplier orders that are seed-tagged or carry only seed-job lines, and
    none that belong to other jobs. Also {supplier id: count}."""
    lines = _rows(
        "SELECT o.id, o.supplier_id, o.notes, m.id, m.job_order_id "
        "FROM supplier_orders o LEFT JOIN material_purchases m ON m.supplier_order_id = o.id"
    )
    info = {}
    for oid, sid, notes, line_id, job_id in lines:
        row = info.setdefault(oid, {"supplier": sid, "tagged": _tagged(notes), "seed": 0, "other": 0, "restock": 0})
        if line_id is None:
            continue
        if job_id is None:
            row["restock"] += 1
        elif job_id in seed_job_ids:
            row["seed"] += 1
        else:
            row["other"] += 1
    ids, by_supplier = set(), {}
    for oid, row in info.items():
        if row["other"]:
            continue
        only_seed_jobs = row["seed"] > 0 and row["restock"] == 0
        if row["tagged"] or only_seed_jobs:
            ids.add(oid)
            by_supplier[row["supplier"]] = by_supplier.get(row["supplier"], 0) + 1
    return ids, by_supplier


def _classify_suppliers(app_created, seed_order_ids) -> list[Record]:
    by_code = {}
    rows = _rows("SELECT id, name, code, is_seed, email FROM suppliers ORDER BY name")
    for sid, name, code, _seed, _email in rows:
        if code:
            by_code[code] = (sid, name)
    retired = {n.lower() for n in INACTIVE_SUPPLIERS}
    app_orders = {
        sid: n
        for sid, n in _rows(
            "SELECT supplier_id, count(*) FROM supplier_orders "
            "WHERE NOT (id IN :ids) GROUP BY supplier_id",
            ids=list(seed_order_ids) or [""],
        )
    }
    out = []
    for sid, name, code, is_seed, email in rows:
        if name.endswith(DUPLICATE_SUFFIX):
            base = name[: -len(DUPLICATE_SUFFIX)]
            spec = _reference_supplier(base)
            target = by_code.get(spec["code"]) if spec else None
            if target and target[0] != sid:
                out.append(
                    Record("supplier", sid, name, DUPLICATE, f"renamed by the reference loader; same as {spec['code']}", merge_into=target)
                )
            else:
                out.append(Record("supplier", sid, name, UNSURE, "marked duplicate, but no reference supplier matches"))
            continue
        spec = next((s for s in SUPPLIERS if s["code"] == code), None) or _reference_supplier(name)
        if spec:
            out.append(Record("supplier", sid, name, REAL, f"reference supplier {spec['code']}"))
        elif name.strip().lower() in retired:
            out.append(Record("supplier", sid, name, REAL, "retired reference supplier"))
        elif sid in app_created:
            out.append(Record("supplier", sid, name, REAL, f"entered in the app by {app_created[sid]}"))
        elif is_seed or _tagged(name) or _local(email):
            if app_orders.get(sid):
                out.append(Record("supplier", sid, name, UNSURE, f"seed flag, but {app_orders[sid]} supplier order(s) entered in the app"))
            else:
                out.append(Record("supplier", sid, name, SEED, "seed flag" if is_seed else "seed name or .local email"))
        elif app_orders.get(sid):
            out.append(Record("supplier", sid, name, REAL, f"{app_orders[sid]} supplier order(s) entered in the app"))
        else:
            out.append(Record("supplier", sid, name, UNSURE, "no seed markers and no app history"))
    return out


# --- Linked rows ---------------------------------------------------------------


def _job_links(job_ids) -> dict:
    ids = list(job_ids) or [""]
    return {
        "job orders": len(job_ids),
        "operations": _scalar("SELECT count(*) FROM operations WHERE job_order_id IN :ids", ids=ids),
        "time records": _scalar(
            "SELECT count(*) FROM operation_time_logs t JOIN operations o ON o.id = t.operation_id "
            "WHERE o.job_order_id IN :ids",
            ids=ids,
        ),
        "helpers": _scalar(
            "SELECT count(*) FROM operation_helpers h JOIN operations o ON o.id = h.operation_id "
            "WHERE o.job_order_id IN :ids",
            ids=ids,
        ),
        "material lines": _scalar("SELECT count(*) FROM material_purchases WHERE job_order_id IN :ids", ids=ids),
        "deliveries received": _scalar(
            "SELECT count(*) FROM material_purchases WHERE job_order_id IN :ids AND date_received IS NOT NULL",
            ids=ids,
        ),
        "invoices": _scalar("SELECT count(*) FROM sales_invoices WHERE job_order_id IN :ids", ids=ids),
        "notifications": _scalar("SELECT count(*) FROM notification_logs WHERE job_order_id IN :ids", ids=ids),
        "staff alerts": _scalar("SELECT count(*) FROM staff_alerts WHERE job_order_id IN :ids", ids=ids),
        "schedule moves": _scalar("SELECT count(*) FROM schedule_moves WHERE job_order_id IN :ids", ids=ids),
        "machine downtimes": _scalar(
            "SELECT count(*) FROM machine_downtimes WHERE job_order_id IN :ids "
            "OR operation_id IN (SELECT id FROM operations WHERE job_order_id IN :ids)",
            ids=ids,
        ),
        "stock movements (kept, unlinked)": _scalar(
            "SELECT count(*) FROM tool_events WHERE job_order_id IN :ids", ids=ids
        ),
    }


def _order_links(order_ids) -> dict:
    ids = list(order_ids) or [""]
    return {
        "supplier orders": len(order_ids),
        "order lines": _scalar("SELECT count(*) FROM material_purchases WHERE supplier_order_id IN :ids", ids=ids),
        "deliveries received": _scalar(
            "SELECT count(*) FROM material_purchases WHERE supplier_order_id IN :ids AND date_received IS NOT NULL",
            ids=ids,
        ),
    }


def _like_any(column):
    return "(" + " OR ".join(f"{column} LIKE '%{t}%'" for t in SEED_TAGS) + ")"


def build_plan() -> Plan:
    app_clients = _created_in_app("Client")
    app_suppliers = _created_in_app("Supplier")
    clients = _classify_clients(app_clients)
    seed_client_ids = [c.id for c in clients if c.group == SEED]

    jobs_by_client = {}
    for jid, cid in _rows(
        "SELECT id, client_id FROM job_orders WHERE client_id IN :ids", ids=seed_client_ids or [""]
    ):
        jobs_by_client.setdefault(cid, []).append(jid)
    seed_job_ids = {j for js in jobs_by_client.values() for j in js}

    order_ids, orders_by_supplier = _seed_supplier_order_ids(seed_job_ids)
    suppliers = _classify_suppliers(app_suppliers, order_ids)
    seed_supplier_ids = {s.id for s in suppliers if s.group == SEED}

    for c in clients:
        if c.group == SEED:
            c.linked = _job_links(jobs_by_client.get(c.id, []))
    for s in suppliers:
        if s.group in (SEED, DUPLICATE):
            own_orders = [
                oid for (oid,) in _rows("SELECT id FROM supplier_orders WHERE supplier_id = :s", s=s.id)
            ]
            s.linked = {
                **_order_links(own_orders),
                "job orders naming it": _scalar("SELECT count(*) FROM job_orders WHERE supplier_id = :s", s=s.id),
                "lines without an order": _scalar(
                    "SELECT count(*) FROM material_purchases WHERE supplier_id = :s AND supplier_order_id IS NULL",
                    s=s.id,
                ),
            }
            if s.group == SEED:
                new = set(own_orders) - order_ids
                order_ids |= new
                if new:
                    orders_by_supplier[s.id] = orders_by_supplier.get(s.id, 0) + len(new)

    downtime_ids = [
        did
        for (did,) in _rows(
            f"SELECT id FROM machine_downtimes WHERE {_like_any('note')} "
            "OR job_order_id IN :jobs OR operation_id IN (SELECT id FROM operations WHERE job_order_id IN :jobs)",
            jobs=list(seed_job_ids) or [""],
        )
    ]

    real_client_ids = [c.id for c in clients if c.group != SEED]
    untouched = {
        "seed-tagged jobs on clients that are not SEED": _scalar(
            "SELECT count(*) FROM job_orders WHERE client_id IN :ids AND ("
            + " OR ".join(f"client_po_number LIKE '{t}-%'" for t in SEED_TAGS)
            + ")",
            ids=real_client_ids or [""],
        ),
        "seed-tagged calendar exceptions": _scalar(
            f"SELECT count(*) FROM work_calendar_exceptions WHERE {_like_any('note')}"
        ),
        "seed-tagged stock counts": _scalar(f"SELECT count(*) FROM stocktakes WHERE {_like_any('notes')}"),
        "seed-tagged stock movements": _scalar(f"SELECT count(*) FROM tool_events WHERE {_like_any('reason')}"),
        "seed suppliers' lines on other jobs": _scalar(
            "SELECT count(*) FROM material_purchases WHERE supplier_id IN :s AND job_order_id IS NOT NULL "
            "AND job_order_id NOT IN :jobs",
            s=list(seed_supplier_ids) or [""],
            jobs=list(seed_job_ids) or [""],
        ),
    }
    return Plan(
        clients=clients,
        suppliers=suppliers,
        seed_job_ids=sorted(seed_job_ids),
        seed_order_ids=sorted(order_ids),
        seed_downtime_ids=sorted(downtime_ids),
        seed_orders_by_supplier=orders_by_supplier,
        untouched=untouched,
    )


# --- Apply (option A) ----------------------------------------------------------


def _apply(plan: Plan) -> None:
    jobs = plan.seed_job_ids or [""]
    orders = plan.seed_order_ids or [""]
    _exec("DELETE FROM machine_downtimes WHERE id IN :ids", ids=plan.seed_downtime_ids or [""])
    _exec("UPDATE tool_events SET job_order_id = NULL WHERE job_order_id IN :ids", ids=jobs)
    _exec(
        "UPDATE tool_events SET material_purchase_id = NULL WHERE material_purchase_id IN "
        "(SELECT id FROM material_purchases WHERE job_order_id IN :jobs OR supplier_order_id IN :orders)",
        jobs=jobs,
        orders=orders,
    )
    for table in ("notification_logs", "sales_invoices", "staff_alerts", "schedule_moves"):
        _exec(f"DELETE FROM {table} WHERE job_order_id IN :ids", ids=jobs)
    _exec(
        "DELETE FROM operation_time_logs WHERE operation_id IN "
        "(SELECT id FROM operations WHERE job_order_id IN :ids)",
        ids=jobs,
    )
    _exec(
        "DELETE FROM operation_helpers WHERE operation_id IN "
        "(SELECT id FROM operations WHERE job_order_id IN :ids)",
        ids=jobs,
    )
    _exec("DELETE FROM material_purchases WHERE job_order_id IN :ids", ids=jobs)
    _exec("UPDATE job_orders SET material_delay_supplier_order_id = NULL WHERE material_delay_supplier_order_id IN :ids", ids=orders)
    _exec("DELETE FROM staff_alerts WHERE supplier_order_id IN :ids", ids=orders)
    _exec("DELETE FROM schedule_moves WHERE supplier_order_id IN :ids", ids=orders)
    _exec("DELETE FROM material_purchases WHERE supplier_order_id IN :ids", ids=orders)
    _exec("DELETE FROM supplier_orders WHERE id IN :ids", ids=orders)
    _exec("DELETE FROM operations WHERE job_order_id IN :ids", ids=jobs)
    _exec("DELETE FROM job_orders WHERE id IN :ids", ids=jobs)

    seed_clients = [c.id for c in plan.records("client", SEED)] or [""]
    _exec("DELETE FROM notification_logs WHERE client_id IN :ids", ids=seed_clients)
    _exec("DELETE FROM clients WHERE id IN :ids", ids=seed_clients)

    seed_suppliers = [s.id for s in plan.records("supplier", SEED)] or [""]
    _exec("UPDATE job_orders SET supplier_id = NULL WHERE supplier_id IN :ids", ids=seed_suppliers)
    _exec("UPDATE schedule_moves SET supplier_id = NULL WHERE supplier_id IN :ids", ids=seed_suppliers)
    _exec("DELETE FROM material_purchases WHERE supplier_id IN :ids AND job_order_id IS NULL AND supplier_order_id IS NULL", ids=seed_suppliers)
    _exec("DELETE FROM suppliers WHERE id IN :ids", ids=seed_suppliers)

    for dup in plan.records("supplier", DUPLICATE):
        target = dup.merge_into[0]
        for table in ("supplier_orders", "material_purchases", "job_orders", "schedule_moves"):
            _exec(f"UPDATE {table} SET supplier_id = :t WHERE supplier_id = :d", t=target, d=dup.id)
        _exec("DELETE FROM suppliers WHERE id = :d", d=dup.id)
    db.session.flush()


# --- Analytics snapshot ----------------------------------------------------------


def analytics_snapshot(today: date | None = None) -> dict:
    """The analytics numbers the cleanup can change, over all history."""
    from app.services import analytics_service, forecast_service
    from app.services.schedule_calendar import shop_now
    from app.services.supplier_reliability_service import supplier_reliability

    today = today or shop_now().date()
    first = _scalar("SELECT min(created_at) FROM job_orders")
    from_s = (first.date() if first else today).isoformat()
    to_s = today.isoformat()

    def fc(result):
        return {
            "fullMonths": result["monthsAvailable"],
            "method": result["method"],
            "forecast": result["forecast"],
            "mapePct": result["mapePct"],
            "mae": result["mae"],
        }

    delays = analytics_service.delays(from_s, to_s)
    causes = delays["causes"]
    workers = analytics_service.efficiency_by_worker(from_s, to_s, min_ops=1)["workers"]
    min_ops = analytics_service.DEFAULT_MIN_OPS
    return {
        "jobOrders": _scalar("SELECT count(*) FROM job_orders"),
        "salesForecast": fc(forecast_service.sales_forecast(today)),
        "demandForecast": fc(forecast_service.demand_forecast(today)),
        "delayHours": round(float(delays["totalDelayHours"] or 0), 1),
        "topCause": (causes[0]["label"], round(float(causes[0]["shareOfTotalPct"]))) if causes else None,
        "suppliers": {
            r["supplierName"]: (r["dueDeliveries"], r["score"], r["grade"])
            for r in supplier_reliability(today)
        },
        "finishedOperations": sum(w["operationCount"] for w in workers),
        "workersWithHistory": len(workers),
        "workersAtMinimum": sum(1 for w in workers if w["operationCount"] >= min_ops),
        "minimumOperations": min_ops,
    }


def run(apply: bool = False, today: date | None = None) -> Plan:
    """Build the plan and the analytics impact; with apply, delete and commit.
    Without apply everything is rolled back."""
    try:
        plan = build_plan()
        plan.before = analytics_snapshot(today)
        _apply(plan)
        db.session.expire_all()
        plan.after = analytics_snapshot(today)
    except Exception:
        db.session.rollback()
        raise
    if apply:
        db.session.commit()
    else:
        db.session.rollback()
    return plan


# --- Report ------------------------------------------------------------------------


def _fc_text(f):
    if not f["method"]:
        return f"Not enough history yet ({f['fullMonths']} full months)"
    error = f"MAPE {f['mapePct']}%" if f["mapePct"] is not None else f"MAE {f['mae']:,.1f}"
    return f"{f['fullMonths']} full months, {f['method']}, next {f['forecast']:,.0f} ({error})"


def report_lines(plan: Plan, applied: bool) -> list[str]:
    out = []
    verb = "Deleted" if applied else "Would delete"
    for kind, rows in (("CLIENTS", plan.clients), ("SUPPLIERS", plan.suppliers)):
        out.append(f"{kind} ({len(rows)})")
        for group in GROUPS:
            members = [r for r in rows if r.group == group]
            if not members:
                continue
            out.append(f"  {group} ({len(members)})")
            for r in members:
                extra = f" -> merge into {r.merge_into[1]!r}" if r.merge_into else ""
                out.append(f"    - {r.name}{extra}  [{r.reason}]")
                linked = {k: v for k, v in r.linked.items() if v}
                if linked:
                    out.append("        " + ", ".join(f"{v} {k}" for k, v in linked.items()))
        out.append("")

    out.append(f"{verb} (option A):")
    seed_clients = plan.records("client", SEED)
    totals = {}
    for c in seed_clients:
        for k, v in c.linked.items():
            totals[k] = totals.get(k, 0) + v
    out.append(f"  - {len(seed_clients)} seed clients")
    out.append("  - " + ", ".join(f"{v} {k}" for k, v in totals.items() if v) if totals else "  - no seed jobs")
    out.append(f"  - {len(plan.seed_order_ids)} seed supplier orders (seed-tagged or only seed-job lines)")
    names = {s.id: s.name for s in plan.suppliers}
    for sid, n in sorted(plan.seed_orders_by_supplier.items(), key=lambda kv: names.get(kv[0], "")):
        out.append(f"      {names.get(sid, sid)}: {n}")
    out.append(f"  - {len(plan.seed_downtime_ids)} machine downtimes (seed-tagged or on seed jobs)")
    out.append(f"  - {len(plan.records('supplier', SEED))} seed suppliers")
    out.append(f"  - {len(plan.records('supplier', DUPLICATE))} duplicate suppliers merged into their reference supplier")
    out.append("")
    out.append("Left alone (say if any of these should go too):")
    for k, v in plan.untouched.items():
        out.append(f"  - {k}: {v}")
    out.append("")

    if plan.before and plan.after:
        b, a = plan.before, plan.after
        out.append("Analytics impact (all history, before -> after):")
        out.append(f"  - Job orders: {b['jobOrders']} -> {a['jobOrders']}")
        out.append(f"  - Sales forecast: {_fc_text(b['salesForecast'])} -> {_fc_text(a['salesForecast'])}")
        out.append(f"  - Demand forecast: {_fc_text(b['demandForecast'])} -> {_fc_text(a['demandForecast'])}")
        top_b = f"{b['topCause'][0]} {b['topCause'][1]}%" if b["topCause"] else "none"
        top_a = f"{a['topCause'][0]} {a['topCause'][1]}%" if a["topCause"] else "none"
        out.append(f"  - Delay Pareto: {b['delayHours']} h (top: {top_b}) -> {a['delayHours']} h (top: {top_a})")
        out.append("  - Supplier scores (deliveries due, score, grade):")
        for name in sorted(set(b["suppliers"]) | set(a["suppliers"])):
            out.append(f"      {name}: {b['suppliers'].get(name, '-')} -> {a['suppliers'].get(name, 'removed')}")
        out.append(
            f"  - Worker performance: {b['finishedOperations']} finished operations, "
            f"{b['workersAtMinimum']} workers with >= {b['minimumOperations']} -> "
            f"{a['finishedOperations']} operations, {a['workersAtMinimum']} workers"
        )
    return out
