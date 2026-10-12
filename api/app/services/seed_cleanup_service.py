"""Find, and optionally remove, data made by the seed scripts.

Used by `flask cleanup-seed-data` (a dry run unless --apply). Every client and
supplier is put in one group:

- REAL: a supplier from the reference loader (by code, name or alias, or a
  retired reference supplier), or a record entered in the app (an audit-log
  CREATE by a user, or job orders / supplier orders that are not seed-tagged).
- SEED: made by a seed script. Clients: a name starting "HIST-SEED " or
  "TC-SEED ", a contact or email ending ".local", one of `flask seed`'s demo
  clients, or a name given with --also-clients. Job orders entered in the app
  on such a client go with it and are listed first. Suppliers: is_seed or the
  same markers, and not REAL.
- DUPLICATE: a supplier renamed "<name> (duplicate)" by the reference loader;
  it merges into the reference supplier that name or alias belongs to.
- UNSURE: anything else. Never changed.

--apply (option A) removes:
- SEED clients and suppliers with their job orders, operations, time logs,
  helpers, material lines, schedule moves, alerts, notifications and
  invoices; supplier orders that are seed-tagged or carry only seed-job
  lines; seed-tagged or seed-job machine downtimes.
- Seed-tagged stock counts and stock movements. Each consumable's quantity on
  hand drops by what those rows added after its latest real count, never
  below 0.
- Seed-tagged calendar entries, except "holiday / no work" entries, which are
  kept (and flagged when the date is not a Philippine holiday).
DUPLICATE suppliers have their references moved to the target and are then
deleted. Users, machines, operation types, the catalog, consumable items,
shop details and every REAL or UNSURE record are never changed. Running it
twice changes nothing the second time.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

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

EVENT_REASON = "coalesce(reason, '')"
STOCK_EVENT_SIGN = {"RECEIVE": 1, "RETURN": 1, "ISSUE": -1, "BORROW": -1}


@dataclass
class Record:
    kind: str  # "client" | "supplier"
    id: str
    name: str
    group: str
    reason: str
    merge_into: tuple[str, str] | None = None  # (id, name) for DUPLICATE
    linked: dict = field(default_factory=dict)
    notes: list = field(default_factory=list)


@dataclass
class Plan:
    clients: list[Record]
    suppliers: list[Record]
    seed_job_ids: list[str]
    seed_order_ids: list[str]
    seed_downtime_ids: list[str]
    seed_orders_by_supplier: dict
    seed_stocktake_ids: list[str]
    seed_stock_event_ids: list[str]
    calendar: list[dict]
    stock: list[dict]
    untouched: dict
    missing_names: list[str] = field(default_factory=list)
    database: str = ""
    before: dict | None = None
    after: dict | None = None

    def records(self, kind=None, group=None):
        rows = self.clients + self.suppliers
        return [
            r for r in rows if (kind is None or r.kind == kind) and (group is None or r.group == group)
        ]


def _stmt(sql, params):
    stmt = text(sql)
    expanding = [k for k, v in params.items() if isinstance(v, (list, tuple, set))]
    if expanding:
        stmt = stmt.bindparams(*(bindparam(k, expanding=True) for k in expanding))
        params = {k: (list(v) or [""] if k in expanding else v) for k, v in params.items()}
    return stmt, params


def _rows(sql, **params):
    return db.session.execute(*_stmt(sql, params)).all()


def _scalar(sql, **params):
    return _rows(sql, **params)[0][0]


def _exec(sql, **params):
    return db.session.execute(*_stmt(sql, params)).rowcount


def _tagged(value) -> bool:
    v = (value or "").strip()
    return any(v == t or v.startswith(f"{t} ") or v.startswith(f"{t}-") for t in SEED_TAGS)


def _seed_po(po) -> bool:
    return any((po or "").startswith(f"{t}-") for t in SEED_TAGS)


def _local(value) -> bool:
    return (value or "").strip().lower().endswith(SEED_EMAIL_SUFFIX)


def _like_any(column):
    return "(" + " OR ".join(f"{column} LIKE '%{t}%'" for t in SEED_TAGS) + ")"


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


# --- Philippine holidays ----------------------------------------------------------

FIXED_PH_HOLIDAYS = {
    (1, 1): "New Year's Day",
    (4, 9): "Araw ng Kagitingan",
    (5, 1): "Labor Day",
    (6, 12): "Independence Day",
    (8, 21): "Ninoy Aquino Day",
    (11, 1): "All Saints' Day",
    (11, 30): "Bonifacio Day",
    (12, 8): "Feast of the Immaculate Conception",
    (12, 24): "Christmas Eve",
    (12, 25): "Christmas Day",
    (12, 30): "Rizal Day",
    (12, 31): "Last day of the year",
}


def _easter(year: int) -> date:
    """Western Easter Sunday (anonymous Gregorian algorithm)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7  # noqa: E741
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return date(year, month, day + 1)


def ph_holiday(on: date) -> str | None:
    """The Philippine holiday on a date: the fixed-date ones, Holy Week and
    National Heroes Day. Chinese New Year and the Eid holidays move each
    year by proclamation and are not included."""
    if (on.month, on.day) in FIXED_PH_HOLIDAYS:
        return FIXED_PH_HOLIDAYS[(on.month, on.day)]
    easter = _easter(on.year)
    holy = {
        easter - timedelta(days=3): "Maundy Thursday",
        easter - timedelta(days=2): "Good Friday",
        easter - timedelta(days=1): "Black Saturday",
    }
    if on in holy:
        return holy[on]
    if on.month == 8 and on.weekday() == 0 and (on + timedelta(days=7)).month == 9:
        return "National Heroes Day"
    return None


# --- Classification ----------------------------------------------------------


def _classify_clients(app_created, also_names) -> tuple[list[Record], list[str]]:
    jobs = {}
    for cid, jid, po, title, status, created in _rows(
        "SELECT client_id, id, client_po_number, title, status, created_at FROM job_orders ORDER BY created_at"
    ):
        jobs.setdefault(cid, []).append((jid, po, title, status, created))
    demo = {(n.lower(), c) for n, c in DEMO_CLIENTS}
    wanted = {n.strip() for n in also_names if n and n.strip()}
    found = set()
    out = []
    for cid, name, contact, email in _rows("SELECT id, name, contact, email FROM clients ORDER BY name"):
        app_jobs = [j for j in jobs.get(cid, []) if not _seed_po(j[1])]
        markers = []
        if _tagged(name):
            markers.append("seed name")
        if _local(contact) or _local(email):
            markers.append(".local contact")
        if ((name or "").strip().lower(), (contact or "").strip()) in demo:
            markers.append("`flask seed` demo client")
        if name in wanted:
            found.add(name)
            markers.append("named with --also-clients")
        if markers:
            rec = Record("client", cid, name, SEED, ", ".join(markers))
            for _jid, po, title, status, created in app_jobs:
                rec.notes.append(
                    f"entered in the app: {title!r} (PO {po or '-'}, {status}, {created:%Y-%m-%d})"
                )
            out.append(rec)
        elif cid in app_created:
            out.append(Record("client", cid, name, REAL, f"entered in the app by {app_created[cid]}"))
        elif app_jobs:
            out.append(Record("client", cid, name, REAL, f"{len(app_jobs)} job order(s) entered in the app"))
        else:
            out.append(Record("client", cid, name, UNSURE, "no seed markers and no app history"))
    return out, sorted(wanted - found)


def _seed_supplier_order_ids(seed_job_ids) -> tuple[set, dict]:
    """Supplier orders that are seed-tagged or carry only seed-job lines, and
    none that belong to other jobs. Also {supplier id: count}."""
    info = {}
    for oid, sid, notes, line_id, job_id in _rows(
        "SELECT o.id, o.supplier_id, o.notes, m.id, m.job_order_id "
        "FROM supplier_orders o LEFT JOIN material_purchases m ON m.supplier_order_id = o.id"
    ):
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
        if row["tagged"] or (row["seed"] > 0 and row["restock"] == 0):
            ids.add(oid)
            by_supplier[row["supplier"]] = by_supplier.get(row["supplier"], 0) + 1
    return ids, by_supplier


def _classify_suppliers(app_created, seed_order_ids) -> list[Record]:
    rows = _rows("SELECT id, name, code, is_seed, email FROM suppliers ORDER BY name")
    by_code = {code: (sid, name) for sid, name, code, _s, _e in rows if code}
    retired = {n.lower() for n in INACTIVE_SUPPLIERS}
    app_orders = dict(
        _rows(
            "SELECT supplier_id, count(*) FROM supplier_orders WHERE NOT (id IN :ids) GROUP BY supplier_id",
            ids=seed_order_ids,
        )
    )
    out = []
    for sid, name, code, is_seed, email in rows:
        if name.endswith(DUPLICATE_SUFFIX):
            spec = _reference_supplier(name[: -len(DUPLICATE_SUFFIX)])
            target = by_code.get(spec["code"]) if spec else None
            if target and target[0] != sid:
                out.append(
                    Record(
                        "supplier", sid, name, DUPLICATE,
                        f"renamed by the reference loader; same as {spec['code']}", merge_into=target,
                    )
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
                out.append(
                    Record("supplier", sid, name, UNSURE, f"seed flag, but {app_orders[sid]} supplier order(s) entered in the app")
                )
            else:
                out.append(Record("supplier", sid, name, SEED, "seed flag" if is_seed else "seed name or .local email"))
        elif app_orders.get(sid):
            out.append(Record("supplier", sid, name, REAL, f"{app_orders[sid]} supplier order(s) entered in the app"))
        else:
            out.append(Record("supplier", sid, name, UNSURE, "no seed markers and no app history"))
    return out


# --- Linked rows ---------------------------------------------------------------


def _job_links(job_ids) -> dict:
    ids = list(job_ids)
    ops = "SELECT id FROM operations WHERE job_order_id IN :ids"
    return {
        "job orders": len(ids),
        "operations": _scalar("SELECT count(*) FROM operations WHERE job_order_id IN :ids", ids=ids),
        "time records": _scalar(f"SELECT count(*) FROM operation_time_logs WHERE operation_id IN ({ops})", ids=ids),
        "helpers": _scalar(f"SELECT count(*) FROM operation_helpers WHERE operation_id IN ({ops})", ids=ids),
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
            f"SELECT count(*) FROM machine_downtimes WHERE job_order_id IN :ids OR operation_id IN ({ops})",
            ids=ids,
        ),
        "stock movements (kept, unlinked)": _scalar(
            f"SELECT count(*) FROM tool_events WHERE job_order_id IN :ids AND NOT {_like_any(EVENT_REASON)}",
            ids=ids,
        ),
    }


def _order_links(order_ids) -> dict:
    ids = list(order_ids)
    return {
        "supplier orders": len(ids),
        "order lines": _scalar("SELECT count(*) FROM material_purchases WHERE supplier_order_id IN :ids", ids=ids),
        "deliveries received": _scalar(
            "SELECT count(*) FROM material_purchases WHERE supplier_order_id IN :ids AND date_received IS NOT NULL",
            ids=ids,
        ),
    }


def _calendar_plan() -> list[dict]:
    out = []
    for cid, on, kind, start, end, note in _rows(
        f"SELECT id, date, type, start_time, end_time, note FROM work_calendar_exceptions "
        f"WHERE {_like_any('note')} ORDER BY date"
    ):
        holiday = ph_holiday(on)
        if kind == "HOLIDAY_NO_WORK":
            action = "keep" if holiday else "keep (check)"
            why = f"Philippine holiday: {holiday}" if holiday else "not a known Philippine holiday date"
        else:
            action = "delete"
            why = f"seed {kind.lower().replace('_', ' ')}"
            if holiday:
                why += f" (date is {holiday}, but the entry is not a holiday)"
        hours = f" {start:%H:%M}-{end:%H:%M}" if start and end else ""
        out.append({"id": cid, "date": on, "type": kind, "hours": hours, "note": note, "action": action, "why": why})
    return out


def _stock_plan(stocktake_ids, event_ids) -> list[dict]:
    """Per consumable: on hand now and after the seed stock rows go.

    The seed rows' effect after the latest real count is taken off: a count
    added (counted - previous), a delivery added its quantity. A real count
    after them already replaced their effect.
    """
    real_last = dict(
        _rows(
            "SELECT l.tool_id, max(s.counted_on) FROM stocktake_lines l JOIN stocktakes s ON s.id = l.stocktake_id "
            "WHERE NOT (s.id IN :ids) GROUP BY l.tool_id",
            ids=stocktake_ids,
        )
    )
    effect, rows_per_tool, unsigned = {}, {}, {}
    for tool_id, on, delta in _rows(
        "SELECT l.tool_id, s.counted_on, l.counted_quantity - l.previous_quantity "
        "FROM stocktake_lines l JOIN stocktakes s ON s.id = l.stocktake_id WHERE s.id IN :ids",
        ids=stocktake_ids,
    ):
        rows_per_tool[tool_id] = rows_per_tool.get(tool_id, 0) + 1
        if real_last.get(tool_id) is None or on > real_last[tool_id]:
            effect[tool_id] = effect.get(tool_id, Decimal(0)) + Decimal(delta)
    for tool_id, kind, qty, received, created in _rows(
        "SELECT tool_id, type, quantity, received_on, created_at FROM tool_events WHERE id IN :ids",
        ids=event_ids,
    ):
        if tool_id is None:
            continue
        rows_per_tool[tool_id] = rows_per_tool.get(tool_id, 0) + 1
        on = received or created.date()
        if real_last.get(tool_id) is not None and on <= real_last[tool_id]:
            continue
        sign = STOCK_EVENT_SIGN.get(kind)
        if sign is None:
            unsigned[tool_id] = unsigned.get(tool_id, 0) + 1
            continue
        effect[tool_id] = effect.get(tool_id, Decimal(0)) + sign * Decimal(qty)
    out = []
    for tid, name, code, unit, size, on_hand in _rows(
        "SELECT id, name, code, unit, size_spec, quantity_on_hand FROM tools "
        "WHERE category = 'CONSUMABLE' ORDER BY name, code"
    ):
        now = Decimal(on_hand or 0)
        raw = now - effect.get(tid, Decimal(0))
        after = max(raw, Decimal(0))
        notes = []
        if raw < 0:
            notes.append(f"would be {raw:g}; set to 0")
        if unsigned.get(tid):
            notes.append(f"{unsigned[tid]} seed adjustment(s) without a direction left in")
        if real_last.get(tid):
            notes.append(f"last real count {real_last[tid]:%Y-%m-%d}")
        elif rows_per_tool.get(tid):
            notes.append("no real count")
        out.append(
            {
                "id": tid, "name": name, "code": code, "unit": unit, "size": size,
                "now": now, "after": after, "seedRows": rows_per_tool.get(tid, 0), "notes": notes,
            }
        )
    return out


def build_plan(also_clients=()) -> Plan:
    from app.utils.db_url import mask_database_url

    app_clients = _created_in_app("Client")
    app_suppliers = _created_in_app("Supplier")
    clients, missing = _classify_clients(app_clients, also_clients)
    seed_client_ids = [c.id for c in clients if c.group == SEED]

    jobs_by_client = {}
    for jid, cid in _rows("SELECT id, client_id FROM job_orders WHERE client_id IN :ids", ids=seed_client_ids):
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
            own = [oid for (oid,) in _rows("SELECT id FROM supplier_orders WHERE supplier_id = :s", s=s.id)]
            s.linked = {
                **_order_links(own),
                "job orders naming it": _scalar("SELECT count(*) FROM job_orders WHERE supplier_id = :s", s=s.id),
                "lines without an order": _scalar(
                    "SELECT count(*) FROM material_purchases WHERE supplier_id = :s AND supplier_order_id IS NULL",
                    s=s.id,
                ),
            }
            if s.group == SEED:
                new = set(own) - order_ids
                order_ids |= new
                if new:
                    orders_by_supplier[s.id] = orders_by_supplier.get(s.id, 0) + len(new)

    downtime_ids = [
        did
        for (did,) in _rows(
            f"SELECT id FROM machine_downtimes WHERE {_like_any('note')} "
            "OR job_order_id IN :jobs OR operation_id IN (SELECT id FROM operations WHERE job_order_id IN :jobs)",
            jobs=seed_job_ids,
        )
    ]
    stocktake_ids = [sid for (sid,) in _rows(f"SELECT id FROM stocktakes WHERE {_like_any('notes')}")]
    event_ids = [eid for (eid,) in _rows(f"SELECT id FROM tool_events WHERE {_like_any('reason')}")]

    non_seed_clients = [c.id for c in clients if c.group != SEED]
    untouched = {
        "seed-tagged jobs on clients that are not SEED": _scalar(
            "SELECT count(*) FROM job_orders WHERE client_id IN :ids AND ("
            + " OR ".join(f"client_po_number LIKE '{t}-%'" for t in SEED_TAGS)
            + ")",
            ids=non_seed_clients,
        ),
        "seed suppliers' lines on other jobs": _scalar(
            "SELECT count(*) FROM material_purchases WHERE supplier_id IN :s AND job_order_id IS NOT NULL "
            "AND NOT (job_order_id IN :jobs)",
            s=seed_supplier_ids,
            jobs=seed_job_ids,
        ),
    }
    return Plan(
        clients=clients,
        suppliers=suppliers,
        seed_job_ids=sorted(seed_job_ids),
        seed_order_ids=sorted(order_ids),
        seed_downtime_ids=sorted(downtime_ids),
        seed_orders_by_supplier=orders_by_supplier,
        seed_stocktake_ids=stocktake_ids,
        seed_stock_event_ids=event_ids,
        calendar=_calendar_plan(),
        stock=_stock_plan(stocktake_ids, event_ids),
        untouched=untouched,
        missing_names=missing,
        database=mask_database_url(str(db.engine.url)),
    )


# --- Apply (option A) ----------------------------------------------------------


def _apply(plan: Plan) -> None:
    jobs = plan.seed_job_ids
    orders = plan.seed_order_ids
    ops = "SELECT id FROM operations WHERE job_order_id IN :ids"
    _exec("DELETE FROM machine_downtimes WHERE id IN :ids", ids=plan.seed_downtime_ids)
    _exec("DELETE FROM tool_events WHERE id IN :ids", ids=plan.seed_stock_event_ids)
    _exec("DELETE FROM stocktake_lines WHERE stocktake_id IN :ids", ids=plan.seed_stocktake_ids)
    _exec("DELETE FROM stocktakes WHERE id IN :ids", ids=plan.seed_stocktake_ids)
    for row in plan.stock:
        if row["after"] != row["now"]:
            _exec("UPDATE tools SET quantity_on_hand = :q WHERE id = :id", q=row["after"], id=row["id"])
    _exec(
        "DELETE FROM work_calendar_exceptions WHERE id IN :ids",
        ids=[c["id"] for c in plan.calendar if c["action"] == "delete"],
    )

    _exec("UPDATE tool_events SET job_order_id = NULL WHERE job_order_id IN :ids", ids=jobs)
    _exec(
        "UPDATE tool_events SET material_purchase_id = NULL WHERE material_purchase_id IN "
        "(SELECT id FROM material_purchases WHERE job_order_id IN :jobs OR supplier_order_id IN :orders)",
        jobs=jobs,
        orders=orders,
    )
    for table in ("notification_logs", "sales_invoices", "staff_alerts", "schedule_moves"):
        _exec(f"DELETE FROM {table} WHERE job_order_id IN :ids", ids=jobs)
    _exec(f"DELETE FROM operation_time_logs WHERE operation_id IN ({ops})", ids=jobs)
    _exec(f"DELETE FROM operation_helpers WHERE operation_id IN ({ops})", ids=jobs)
    _exec(f"UPDATE machine_downtimes SET operation_id = NULL WHERE operation_id IN ({ops})", ids=jobs)
    _exec("UPDATE machine_downtimes SET job_order_id = NULL WHERE job_order_id IN :ids", ids=jobs)
    _exec("DELETE FROM material_purchases WHERE job_order_id IN :ids", ids=jobs)
    _exec(
        "UPDATE job_orders SET material_delay_supplier_order_id = NULL WHERE material_delay_supplier_order_id IN :ids",
        ids=orders,
    )
    _exec("DELETE FROM staff_alerts WHERE supplier_order_id IN :ids", ids=orders)
    _exec("DELETE FROM schedule_moves WHERE supplier_order_id IN :ids", ids=orders)
    _exec("DELETE FROM material_purchases WHERE supplier_order_id IN :ids", ids=orders)
    _exec("DELETE FROM supplier_orders WHERE id IN :ids", ids=orders)
    _exec("UPDATE operations SET rework_of_operation_id = NULL WHERE job_order_id IN :ids", ids=jobs)
    _exec("DELETE FROM operations WHERE job_order_id IN :ids", ids=jobs)
    _exec("DELETE FROM job_orders WHERE id IN :ids", ids=jobs)

    seed_clients = [c.id for c in plan.records("client", SEED)]
    _exec("DELETE FROM notification_logs WHERE client_id IN :ids", ids=seed_clients)
    _exec("DELETE FROM sales_invoices WHERE client_id IN :ids", ids=seed_clients)
    _exec("DELETE FROM clients WHERE id IN :ids", ids=seed_clients)

    seed_suppliers = [s.id for s in plan.records("supplier", SEED)]
    _exec("UPDATE job_orders SET supplier_id = NULL WHERE supplier_id IN :ids", ids=seed_suppliers)
    _exec("UPDATE schedule_moves SET supplier_id = NULL WHERE supplier_id IN :ids", ids=seed_suppliers)
    _exec(
        "DELETE FROM material_purchases WHERE supplier_id IN :ids AND job_order_id IS NULL AND supplier_order_id IS NULL",
        ids=seed_suppliers,
    )
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
    stock = forecast_service.consumable_run_out(today)["items"]
    statuses = {}
    for item in stock:
        statuses[item["status"]] = statuses.get(item["status"], 0) + 1
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
        "workersAtMinimum": sum(1 for w in workers if w["operationCount"] >= analytics_service.DEFAULT_MIN_OPS),
        "minimumOperations": analytics_service.DEFAULT_MIN_OPS,
        "stockStatuses": dict(sorted(statuses.items())),
    }


def run(apply: bool = False, today: date | None = None, also_clients=()) -> Plan:
    """Build the plan and the analytics impact; with apply, delete and commit.
    Without apply everything is rolled back."""
    try:
        plan = build_plan(also_clients)
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


def _qty(v: Decimal) -> str:
    return f"{v.normalize():f}" if v == v.to_integral() else f"{v:.2f}"


def report_lines(plan: Plan, applied: bool) -> list[str]:
    out = [f"Database: {plan.database}", ""]
    verb = "Deleted" if applied else "Would delete"
    for name in plan.missing_names:
        out.append(f"--also-clients {name!r}: no client has exactly this name; nothing done for it.")
    if plan.missing_names:
        out.append("")
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
                for note in r.notes:
                    out.append(f"        ! {note}")
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
    if any(totals.values()):
        out.append("  - " + ", ".join(f"{v} {k}" for k, v in totals.items() if v))
    out.append(f"  - {len(plan.seed_order_ids)} seed supplier orders (seed-tagged or only seed-job lines)")
    names = {s.id: s.name for s in plan.suppliers}
    for sid, n in sorted(plan.seed_orders_by_supplier.items(), key=lambda kv: names.get(kv[0], "")):
        out.append(f"      {names.get(sid, sid)}: {n}")
    out.append(f"  - {len(plan.seed_downtime_ids)} machine downtimes (seed-tagged or on seed jobs)")
    out.append(f"  - {len(plan.seed_stocktake_ids)} seed stock counts, {len(plan.seed_stock_event_ids)} seed stock movements")
    deleted_cal = [c for c in plan.calendar if c["action"] == "delete"]
    out.append(f"  - {len(deleted_cal)} seed calendar entries")
    out.append(f"  - {len(plan.records('supplier', SEED))} seed suppliers")
    out.append(f"  - {len(plan.records('supplier', DUPLICATE))} duplicate suppliers merged into their reference supplier")
    out.append("")

    out.append(f"Seed calendar entries ({len(plan.calendar)}):")
    for c in plan.calendar or []:
        out.append(f"  - {c['date']:%a %Y-%m-%d} {c['type']}{c['hours']}  {c['action'].upper()}  [{c['why']}]")
    if not plan.calendar:
        out.append("  - none")
    out.append("")

    changed = [s for s in plan.stock if s["seedRows"]]
    out.append(f"Consumables on hand after the seed stock rows go ({len(plan.stock)} items; recount afterwards):")
    for s in plan.stock:
        label = s["name"] + (f" {s['size']}" if s["size"] else "") + f" ({s['code']})"
        change = f"{_qty(s['now'])} -> {_qty(s['after'])} {s['unit']}"
        notes = f"  [{'; '.join(s['notes'])}]" if s["notes"] else ""
        mark = "" if s["seedRows"] else "  (no seed rows)"
        out.append(f"  - {label}: {change}{notes}{mark}")
    out.append(f"  {len(changed)} items had seed stock rows.")
    out.append("")

    out.append("Left alone:")
    for k, v in plan.untouched.items():
        out.append(f"  - {k}: {v}")
    kept = [c for c in plan.calendar if c["action"] != "delete"]
    out.append(f"  - seed-tagged holiday entries kept: {len(kept)}")
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
        out.append(f"  - Consumable status: {b['stockStatuses']} -> {a['stockStatuses']}")
    return out
