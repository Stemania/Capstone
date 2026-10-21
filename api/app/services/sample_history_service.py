"""Local sample transaction history.

``generate`` adds job orders, purchasing, shop-floor time, attendance and
inventory movements that reference the shop's existing people, machines,
clients, suppliers and catalog. It does not create or edit those master rows.

The only existing values it changes are consumable ``quantity_on_hand``.
Each of those is snapshotted in ``sample_records.detail`` and restored by
``remove``. Holiday rows it inserts are tracked the same way and deleted
by ``remove``. Tool-unit custody is left as it was: borrow and return are
new events only.

Dry run builds one transaction, returns the summary, and rolls it back.
"""

from __future__ import annotations

import math
import random
import uuid
from collections import defaultdict
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from sqlalchemy import event, func
from app.extensions import db
from app.models.attendance import AttendanceRecord
from app.models.audit_log import AuditLog
from app.models.client import Client
from app.models.job_order import (
    JobOrder,
    JobOrderStatus,
    JobPriority,
    JobType,
    MaterialStatus,
    PartCondition,
)
from app.models.machine import MachineType, MachineUnit
from app.models.material_catalog import MaterialCatalogItem
from app.models.material_purchase import MaterialPurchase
from app.models.notification import NotificationLog
from app.models.operation import JobOperation, OperationHelper, OperationStatus, ReworkReasonCategory
from app.models.operation_time import (
    DowntimeCategory,
    MachineDowntime,
    OperationPauseReason,
    OperationTimeEvent,
    OperationTimeLog,
)
from app.models.sales_invoice import SalesInvoice
from app.models.sample_record import SampleRecord
from app.models.schedule_move import DelayKind, MaterialCause, ScheduleMove
from app.models.shop_settings import ShopSettings
from app.models.staff_alert import StaffAlert
from app.models.supplier import Supplier
from app.models.supplier_order import SupplierOrder, SupplierOrderStatus, format_po_number
from app.models.tool import Tool, ToolCategory
from app.models.tool_event import ToolEvent, ToolEventType
from app.models.tool_type import ToolUnit, ToolUnitStatus
from app.models.user import User, UserRole, UserStatus
from app.models.worker_skill import (
    CalendarExceptionType,
    OperationType,
    WorkCalendarException,
    WorkerSchedule,
    WorkerSkill,
)
from app.services.audit_service import (
    _COLUMN_SNAPSHOT_MODELS,
    _after_delete,
    _after_insert,
    _after_update,
)
from app.services.schedule_calendar import (
    build_worker_working_windows,
    clear_calendar_cache,
    default_shop_schedule_by_dow,
    effective_windows_for_date,
    ensure_utc,
    intersect_intervals,
    load_calendar_exceptions,
    load_worker_schedule_maps_many,
    place_unbroken,
    shop_local_to_utc,
    utc_to_shop,
)

HOLIDAYS = (
    (date(2026, 4, 2), "Maundy Thursday"),
    (date(2026, 4, 3), "Good Friday"),
    (date(2026, 4, 9), "Araw ng Kagitingan"),
    (date(2026, 5, 1), "Labor Day"),
    (date(2026, 6, 12), "Independence Day"),
    (date(2026, 8, 21), "Ninoy Aquino Day"),
    (date(2026, 8, 31), "National Heroes Day"),
)

# Late share and extra calendar days, tuned so the reliability score lands
# near A / B / C when this history is most of the supplier's deliveries.
SUPPLIER_PROFILES = (
    {"late": 0.04, "extra": 1},
    {"late": 0.18, "extra": 2},
    {"late": 0.35, "extra": 2},
)

PARTS = (
    ("Drive shaft", "Turned and keyed shaft for a gearbox."),
    ("Bronze bushing", "Bored and faced bushing to the drawing."),
    ("Coupling hub", "Bored coupling hub with a keyseat."),
    ("Flange", "Faced flange, bolt circle drilled."),
    ("Mounting bracket", "Milled bracket with slotted holes."),
    ("Spur gear", "Cut spur gear, bore to fit."),
    ("Conveyor roller", "Turned roller with pressed-in ends."),
    ("Pin", "Hard-turned pin, ends chamfered."),
    ("Spacer", "Parted and faced spacer."),
    ("Pulley", "Turned pulley, groove to width."),
    ("Housing cover", "Milled cover, holes tapped."),
    ("Wear plate", "Ground wear plate to thickness."),
    ("Sleeve", "Bored sleeve for a running fit."),
    ("Adapter plate", "Drilled adapter between two flanges."),
    ("Keystock", "Milled key to width and height."),
    ("Collar", "Faced collar with a set-screw hole."),
    ("Guide rail", "Milled guide rail, ends squared."),
    ("Cam", "Milled cam profile."),
    ("Hub", "Turned hub, bore and face."),
    ("Base plate", "Milled base, holes drilled and tapped."),
)

PAUSE_WEIGHTS = (
    (OperationPauseReason.WAITING_MATERIAL, 0.42, "Waiting for material"),
    (OperationPauseReason.MACHINE_DOWN, 0.22, None),
    (OperationPauseReason.OTHER, 0.18, "Waiting for instruction"),
    (OperationPauseReason.WAITING_PRIOR_OPERATION, 0.10, "Waiting on the prior operation"),
    (OperationPauseReason.END_OF_SHIFT, 0.08, "Stopped at the end of the shift"),
)

REWORK_WEIGHTS = (
    (ReworkReasonCategory.DIMENSION_OUT_OF_TOLERANCE, 0.50, "Dimension out of tolerance"),
    (ReworkReasonCategory.SURFACE_FINISH, 0.20, "Surface finish below the drawing"),
    (ReworkReasonCategory.OPERATOR_ERROR, 0.15, "Setup error, recut required"),
    (ReworkReasonCategory.MACHINE_FAULT, 0.10, "Machine fault marked the part"),
    (ReworkReasonCategory.OTHER, 0.05, "Fit-up did not match the mating part"),
)

DOWNTIME_REASONS = (
    (DowntimeCategory.MECHANICAL_FAILURE, "Spindle drive stopped"),
    (DowntimeCategory.ELECTRICAL_FAULT, "Axis drive fault"),
    (DowntimeCategory.WAITING_FOR_PARTS, "Waiting on a replacement belt"),
    (DowntimeCategory.MECHANICAL_FAILURE, "Coolant pump failed"),
)

OPEN_FATES = (
    "draft",
    "draft",
    "waiting",
    "scheduled",
    "scheduled",
    "progress",
    "progress",
)

_AUDIT_MODELS = (
    JobOrder,
    JobOperation,
    User,
    Tool,
    OperationTimeLog,
    MachineDowntime,
    Client,
    NotificationLog,
    WorkCalendarException,
    *_COLUMN_SNAPSHOT_MODELS,
)

_ONUPDATE_COLUMNS = (
    JobOrder.__table__.c.updated_at,
    MaterialPurchase.__table__.c.updated_at,
    SupplierOrder.__table__.c.updated_at,
    AttendanceRecord.__table__.c.updated_at,
)


def assert_local_database():
    """Refuse anything that is not a database on this machine."""
    url = db.engine.url
    host = (url.host or "").lower()
    raw = str(url).lower()
    if host not in ("localhost", "127.0.0.1") or "neon" in host or "neon.tech" in raw:
        raise ValueError(
            "sample-history only runs on a local database (localhost). "
            f"Refusing host {host!r}."
        )


def generate(start, end, seed=42, apply=False):
    """Build sample history from ``start`` through ``end`` (inclusive).

    ``apply`` commits. Without it the transaction is rolled back after the
    summary is built. A second generate is refused while a ledger exists.
    """
    assert_local_database()
    start_d = _parse_day(start, "start")
    end_d = _parse_day(end, "end")
    if end_d < start_d:
        raise ValueError("end is before start")
    if db.session.query(SampleRecord.id).first() is not None:
        raise ValueError(
            "Sample history already exists. Run flask sample-history remove first."
        )

    frozen = _freeze_onupdate()
    try:
        with _quiet_audit():
            summary = _generate(start_d, end_d, int(seed))
            if apply:
                db.session.commit()
            else:
                db.session.rollback()
            summary["applied"] = bool(apply)
            return summary
    except Exception:
        db.session.rollback()
        raise
    finally:
        _thaw_onupdate(frozen)


def remove(apply=False):
    """Delete rows the generator created and restore snapshotted stock.

    Without ``apply`` the deletes run and then roll back, so the summary
    shows what would be removed.
    """
    assert_local_database()
    frozen = _freeze_onupdate()
    try:
        with _quiet_audit():
            summary = _remove()
            if apply:
                db.session.commit()
            else:
                db.session.rollback()
            summary["applied"] = bool(apply)
            return summary
    except Exception:
        db.session.rollback()
        raise
    finally:
        _thaw_onupdate(frozen)


def format_summary(summary):
    """Lines for the flask command."""
    if "deleted" in summary:
        lines = ["Would delete:" if not summary.get("applied") else "Deleted:"]
        for table, count in sorted(summary["deleted"].items()):
            if count:
                lines.append(f"  {table}: {count}")
        lines.append(f"  stock quantities restored: {summary['restoredStock']}")
        lines.append(f"  ledger rows cleared: {summary['ledgerRows']}")
        return lines

    lines = [
        f"Jobs: {summary['jobs']}",
        "  by status: " + _fmt_counts(summary["jobsByStatus"]),
        "  by type: " + _fmt_counts(summary["jobsByType"]),
        "  by client: " + _fmt_counts(summary["jobsByClient"]),
        f"Operations: {summary['operations']} (rework {summary['rework']})",
        "Pauses: " + _fmt_counts(summary["pausesByReason"]),
        f"Breakdowns: {summary['breakdowns']}",
        f"Attendance rows: {summary['attendance']}",
        f"Purchase orders: {summary['purchaseOrders']}",
    ]
    for row in summary["posBySupplier"]:
        lines.append(
            f"  {row['name']}: {row['orders']} orders, "
            f"{row['onTimePct'] if row['onTimePct'] is not None else 'n/a'}% on time "
            f"({row['onTime']} on time, {row['late']} late, {row['open']} not yet due)"
        )
    lines.append(
        f"Consumable scans: {summary['consumableScans']}, "
        f"receives: {summary['consumableReceives']}, "
        f"corrections: {summary['corrections']}"
    )
    lines.append(
        f"Tool borrows: {summary['toolBorrows']}, returns: {summary['toolReturns']}, "
        f"borrows with no return event: {summary['toolUnitsOpenBorrow']}"
    )
    lines.append(
        "Tool unit status was not changed. A few borrow events have no return, "
        "but the units stay at their previous custody so existing rows are untouched."
    )
    if summary["holidaysAdded"]:
        lines.append("Holidays added: " + ", ".join(summary["holidaysAdded"]))
    else:
        lines.append("Holidays added: none (each date already had a calendar row)")
    if summary["holidaysAlreadyPresent"]:
        lines.append(
            "Holidays already on the calendar: "
            + ", ".join(summary["holidaysAlreadyPresent"])
        )
    lines.append(f"Stock snapshots: {summary['stockSnapshots']}")
    return lines


def _generate(start, end, seed):
    rng = random.Random(seed)
    before = _master_fingerprint()
    ledger = _Ledger()
    holidays_added, holidays_present = _ensure_holidays(ledger)
    db.session.flush()
    clear_calendar_cache()

    shop = _Shop.load(start, end)
    if not shop.workers:
        raise ValueError(
            "No production worker with a skill on an active machine. "
            "Disabled accounts are left out; invited workers are used as they are."
        )
    if not shop.clients:
        raise ValueError("No clients to attach job orders to.")
    if not shop.suppliers:
        raise ValueError("No active supplier with a PO code.")
    if not shop.catalog:
        raise ValueError("No active material catalog items.")
    if not shop.op_types:
        raise ValueError(
            "No in-house operation type with an active unit and a skilled worker."
        )
    if not shop.admins:
        raise ValueError("No active admin to record the history against.")
    if not shop.consumables:
        raise ValueError("No active consumable items.")

    shop.tune_efficiency(rng)
    plans = _plan_jobs(rng, shop, start, end)
    print(f"Scheduling {len(plans)} job orders...", flush=True)
    counters = _schedule_jobs(rng, shop, ledger, plans)
    _attendance(rng, shop, ledger, plans, counters)
    _consumables(rng, shop, ledger, counters)
    _tool_borrows(rng, shop, ledger, counters)
    _retarget_stock(rng, shop, ledger, counters)
    db.session.flush()
    after = _master_fingerprint()
    if before != after:
        raise RuntimeError(
            "Sample history changed a master row (people, clients, suppliers, "
            "machines, catalog, tool custody, skills, or shop settings). Rolled back."
        )
    _reject_notifications()
    return _summary(plans, counters, holidays_added, holidays_present, ledger)


def _plan_jobs(rng, shop, start, end):
    month_shift = {m: rng.uniform(-0.06, 0.10) for m in range(1, 13)}
    weeks = _weeks(shop.working_days)
    plans = []
    seq = 0
    for week in weeks:
        count = rng.randint(10, 14) if len(week) >= 5 else max(1, round(12 * len(week) / 6))
        for _ in range(count):
            seq += 1
            po = week[rng.randrange(len(week))]
            client = shop.clients[_weighted(rng, shop.client_weights)]
            kind = _job_type(rng)
            needs = _needs_material(rng, kind)
            part, blurb = PARTS[rng.randrange(len(PARTS))]
            size = f"{rng.choice((20, 35, 50, 80, 120))} mm"
            month_i = (po.year - start.year) * 12 + (po.month - start.month)
            raw = math.exp(rng.uniform(math.log(5000), math.log(250000)))
            amount = min(250000.0, max(5000.0, raw * (1 + 0.035 * month_i + month_shift[po.month])))
            due = shop.next_working(po + timedelta(days=rng.randint(7, 28)))
            plans.append(
                {
                    "seq": seq,
                    "po": po,
                    "due": due,
                    "client": client,
                    "kind": kind,
                    "needs": needs,
                    "title": f"{part}, {size}",
                    "description": f"{blurb} Size {size}.",
                    "qty": rng.randint(1, 12),
                    "amount": round(amount, 2),
                    "priority": _priority(rng),
                    "fate": "run",
                    "supplier_index": 0,
                }
            )
    plans.sort(key=lambda p: (p["po"], p["seq"]))
    if (end - start).days >= 28 and len(plans) >= len(OPEN_FATES):
        for plan, fate in zip(plans[-len(OPEN_FATES) :], OPEN_FATES):
            plan["fate"] = fate
        plans[-len(OPEN_FATES)].update(needs=True)  # first draft: to order
        plans[-len(OPEN_FATES) + 1].update(needs=False)
        plans[-len(OPEN_FATES) + 2].update(needs=True)  # waiting on a delivery
    for plan in plans:
        if plan["fate"] == "run" and rng.random() < 0.03:
            plan["fate"] = "cancelled"
    material_i = 0
    for plan in plans:
        if plan["needs"] and plan["fate"] != "cancelled":
            plan["supplier_index"] = material_i % len(shop.suppliers)
            material_i += 1
    return plans


def _schedule_jobs(rng, shop, ledger, plans):
    counters = _blank_counters()
    office = shop.office or shop.admins[0]
    admin = shop.admins[0]
    for index, plan in enumerate(plans, start=1):
        if index % 40 == 0:
            print(f"  {index}/{len(plans)}", flush=True)
        _one_job(rng, shop, ledger, plan, counters, admin, office)
    return counters


def _one_job(rng, shop, ledger, plan, counters, admin, office):
    encode = shop_local_to_utc(plan["po"], time(8, 30))
    fate = plan["fate"]
    kind = plan["kind"]
    condition = (
        PartCondition.RAW_MATERIAL
        if kind == JobType.FABRICATION
        else PartCondition.CLIENT_SUPPLIED_ITEM
    )
    material_status = MaterialStatus.NOT_REQUIRED
    if plan["needs"] and fate == "draft":
        material_status = MaterialStatus.TO_ORDER
    elif plan["needs"] and fate == "waiting":
        material_status = MaterialStatus.ORDERED
    elif plan["needs"] and fate != "cancelled":
        material_status = MaterialStatus.RECEIVED

    status = {
        "draft": JobOrderStatus.DRAFT,
        "cancelled": JobOrderStatus.CANCELLED,
        "progress": JobOrderStatus.IN_PROGRESS,
        "run": JobOrderStatus.DELIVERED,
        "scheduled": JobOrderStatus.SCHEDULED,
        "waiting": JobOrderStatus.SCHEDULED,
    }[fate]

    raw_materials = []
    catalog = None
    if plan["needs"] and fate != "cancelled":
        catalog = shop.catalog[rng.randrange(len(shop.catalog))]
        raw_materials = [
            {
                "id": _new_id(rng),
                "name": catalog.name,
                "grade": _grade(catalog, rng),
                "quantity": float(plan["qty"]),
                "unit": catalog.default_unit,
            }
        ]

    job = JobOrder(
        id=_new_id(rng),
        client_id=plan["client"].id,
        title=plan["title"],
        description=plan["description"],
        due_date=plan["due"],
        client_po_number=f"PO-{plan['po'].year}-{plan['seq']:04d}",
        po_date=plan["po"],
        status=status,
        priority=plan["priority"],
        job_type=kind,
        part_condition=condition,
        quantity=Decimal(plan["qty"]),
        unit_of_measure="pcs",
        amount=Decimal(str(plan["amount"])),
        raw_materials=raw_materials,
        material_status=material_status,
        created_by_id=admin.id,
        at_risk_alerted=False,
        created_at=encode,
        updated_at=encode,
    )
    if fate == "cancelled":
        reason, note = rng.choice(
            (
                ("CLIENT_CANCELLED", "Client withdrew the order"),
                ("DUPLICATE_OR_ENCODING_ERROR", "Duplicate of another order"),
                ("OTHER", "Order stopped before release"),
            )
        )
        job.cancelled_at = encode + timedelta(hours=3)
        job.cancelled_by_id = admin.id
        job.cancel_reason = reason
        job.cancel_note = note
        job.updated_at = job.cancelled_at
    ledger.add(job, encode)
    _audit(ledger, rng, admin, "CREATE", "JobOrder", job.id, encode, {"status": "DRAFT"})
    counters["jobs"] += 1
    counters["by_status"][status.value] += 1
    counters["by_type"][kind.value] += 1
    counters["by_client"][plan["client"].name] += 1
    if len(counters["titles"]) < 8:
        counters["titles"].append(plan["title"])

    if fate in ("cancelled", "draft"):
        return

    purchase = _purchase_for_job(rng, shop, ledger, plan, job, catalog, office, counters)
    not_before, previous_start, late = _ready_at(shop, plan, purchase)
    if fate == "progress":
        anchor = shop.working_days[-4] if len(shop.working_days) >= 4 else plan["po"]
        not_before = max(not_before, shop_local_to_utc(anchor, time(8, 0)))
        if purchase and purchase["received"] and purchase["received"] > anchor:
            not_before = shop_local_to_utc(purchase["received"], time(8, 0))
    elif fate in ("scheduled", "waiting"):
        not_before = max(not_before, shop_local_to_utc(shop.next_working(shop.end + timedelta(days=1)), time(8, 0)))

    horizon = shop.history_end if fate == "run" else shop.future_end
    ops = _place_operations(
        rng, shop, ledger, job, plan, not_before, horizon, admin, counters, fate
    )
    if not ops:
        raise RuntimeError(f"Could not schedule {job.title} ({plan['po'].isoformat()}).")

    first = ops[0]
    job.released_at = min(encode + timedelta(hours=2), first["start"] - timedelta(minutes=30))
    if job.released_at < encode:
        job.released_at = encode
    _audit(
        ledger, rng, admin, "UPDATE", "JobOrder", job.id, job.released_at, {"status": "SCHEDULED"}
    )

    if late and previous_start and first["start"] > previous_start and fate == "run":
        move = ScheduleMove(
            id=_new_id(rng),
            job_order_id=job.id,
            kind=DelayKind.MATERIAL,
            previous_start=previous_start,
            new_start=first["start"],
            reason="Supplier delivered after the promised date",
            supplier_order_id=purchase["order"].id if purchase else None,
            supplier_id=purchase["supplier"].id if purchase else None,
            material_cause=MaterialCause.SUPPLIER_LATE,
            moved_at=first["start"],
            moved_by_id=admin.id,
        )
        ledger.add(move, first["start"])
        job.material_delay_original_start = previous_start
        job.material_delay_reason = move.reason
        job.material_delay_supplier_order_id = move.supplier_order_id
        job.material_delayed_at = first["start"]
        job.delay_kind = DelayKind.MATERIAL
        counters["material_moves"] += 1

    if purchase and purchase["received"] and fate != "waiting":
        job.material_received_date = purchase["received"]
        job.material_expected_date = purchase["expected"]
        job.supplier_id = purchase["supplier"].id
        job.supplier_reference = purchase["order"].po_number
        if first.get("actual_start"):
            purchase["line"].consumed_at = first["actual_start"]
    elif purchase and fate == "waiting":
        job.material_expected_date = purchase["expected"]
        job.supplier_id = purchase["supplier"].id
        job.supplier_reference = purchase["order"].po_number

    finished = [op for op in ops if op["actual_end"] is not None]
    if fate == "run" and finished and all(op["actual_end"] for op in ops):
        last_end = max(op["actual_end"] for op in ops)
        last_day = utc_to_shop(last_end).date()
        if last_day >= shop.end - timedelta(days=1):
            job.status = JobOrderStatus.COMPLETED
            job.updated_at = last_end
            counters["by_status"][JobOrderStatus.DELIVERED.value] -= 1
            counters["by_status"][JobOrderStatus.COMPLETED.value] += 1
        else:
            delivered = shop.next_working(last_day + timedelta(days=1))
            job.delivered_at = shop_local_to_utc(delivered, time(9, 0))
            job.updated_at = job.delivered_at
            _audit(
                ledger,
                rng,
                admin,
                "UPDATE",
                "JobOrder",
                job.id,
                job.delivered_at,
                {"status": "DELIVERED"},
            )
    elif fate == "progress":
        job.updated_at = ops[-1]["start"]
    else:
        job.updated_at = job.released_at


def _purchase_for_job(rng, shop, ledger, plan, job, catalog, office, counters):
    if not plan["needs"] or plan["fate"] in ("cancelled", "draft") or catalog is None:
        return None
    supplier = shop.suppliers[plan["supplier_index"]]
    profile = SUPPLIER_PROFILES[min(plan["supplier_index"], len(SUPPLIER_PROFILES) - 1)]
    issue = plan["po"]
    lead = supplier.typical_lead_time_days or 7
    lead = min(30, max(1, int(lead)))
    expected = shop.next_working(issue + timedelta(days=lead))
    late = rng.random() < profile["late"]
    if plan["fate"] == "waiting":
        issue = shop.working_days[-2] if len(shop.working_days) >= 2 else plan["po"]
        expected = shop.next_working(shop.end + timedelta(days=6))
        received = None
        late = False
        status = SupplierOrderStatus.ISSUED
    elif plan["fate"] == "scheduled":
        received = shop.working_on_or_before(shop.end - timedelta(days=1))
        if received < issue:
            received = issue
        expected = min(expected, received)
        late = False
        status = SupplierOrderStatus.RECEIVED
    else:
        received = expected
        if late:
            received = shop.next_working(expected + timedelta(days=profile["extra"]))
        status = SupplierOrderStatus.RECEIVED

    issued_at = shop_local_to_utc(issue, time(9, 0))
    year = issue.year
    seq = shop.next_po_seq(supplier.id, year)
    order = SupplierOrder(
        id=_new_id(rng),
        po_seq=seq,
        po_year=year,
        po_number=format_po_number(supplier.code, year, seq),
        supplier_id=supplier.id,
        status=status,
        date_issued=issue,
        expected_delivery_date=expected,
        original_expected_delivery_date=expected,
        received_date=received,
        terms_of_payment="PDC",
        delivery_mode="DELIVERY",
        prepared_by_id=office.id,
        issued_by_id=office.id,
        printed_at=issued_at + timedelta(minutes=20),
        printed_by_id=office.id,
        print_count=1,
        created_at=issued_at,
        updated_at=issued_at if received is None else shop_local_to_utc(received, time(11, 0)),
    )
    ledger.add(order, issued_at)
    _audit(ledger, rng, office, "CREATE", "SupplierOrder", order.id, issued_at, {"po": order.po_number})
    grade = (job.raw_materials or [{}])[0].get("grade")
    line = MaterialPurchase(
        id=_new_id(rng),
        job_order_id=job.id,
        material_catalog_id=catalog.id,
        planned_material_id=(job.raw_materials or [{}])[0].get("id"),
        material_name=catalog.name,
        grade_or_spec=grade,
        size_spec=plan["title"].split(", ", 1)[-1],
        quantity=Decimal(str(max(plan["qty"], 1))),
        unit=catalog.default_unit or "pcs",
        unit_cost=Decimal(str(rng.randrange(80, 1800))),
        supplier_id=supplier.id,
        supplier_order_id=order.id,
        date_ordered=issue,
        date_received=received,
        created_at=issued_at,
        updated_at=order.updated_at,
    )
    ledger.add(line, issued_at)
    bucket = counters["suppliers"][supplier.id]
    bucket["name"] = supplier.name
    bucket["orders"] += 1
    if received is None:
        bucket["open"] += 1
    elif received <= expected:
        bucket["on_time"] += 1
    else:
        bucket["late"] += 1
    counters["purchase_orders"] += 1
    return {
        "order": order,
        "line": line,
        "supplier": supplier,
        "expected": expected,
        "received": received,
        "late": late and received is not None and received > expected,
    }


def _ready_at(shop, plan, purchase):
    ready = shop.next_working(plan["po"])
    previous = None
    late = False
    if purchase and purchase["received"]:
        ready = max(ready, purchase["received"])
        if purchase["late"]:
            previous = shop_local_to_utc(purchase["expected"], time(8, 0))
            late = True
    elif purchase and purchase["received"] is None:
        ready = purchase["expected"]
    return shop_local_to_utc(ready, time(8, 0)), previous, late


def _place_operations(rng, shop, ledger, job, plan, not_before, horizon, admin, counters, fate):
    count = _op_count(rng)
    if fate == "progress":
        count = max(2, count)
    hours_each = shop.hours_per_op * rng.uniform(0.75, 1.25)
    placed = []
    cursor = not_before
    seq = {"n": 1}

    def take_seq():
        n = seq["n"]
        seq["n"] += 1
        return n

    for step in range(1, count + 1):
        op_type = shop.op_types[rng.randrange(len(shop.op_types))]
        estimated = max(0.75, min(6.0, hours_each))
        is_last = step == count
        in_progress = fate == "progress" and is_last
        pause = fate == "run" and not in_progress and rng.random() < 0.28
        result = _place_one(
            rng,
            shop,
            ledger,
            job,
            op_type,
            take_seq(),
            estimated,
            cursor,
            horizon,
            admin,
            counters,
            in_progress=in_progress,
            pause=pause,
            rework_of=None,
            take_seq=take_seq,
        )
        if result is None and horizon == shop.history_end:
            result = _place_one(
                rng,
                shop,
                ledger,
                job,
                op_type,
                seq["n"] - 1,
                max(0.75, estimated / 2),
                cursor,
                shop.future_end,
                admin,
                counters,
                in_progress=in_progress,
                pause=False,
                rework_of=None,
                take_seq=take_seq,
            )
        if result is None:
            return []
        placed.append(result)
        cursor = result["end"]
        if (
            not in_progress
            and result["actual_end"] is not None
            and rng.random() < 0.04
        ):
            redo = _place_one(
                rng,
                shop,
                ledger,
                job,
                op_type,
                take_seq(),
                max(0.75, estimated * 0.5),
                result["actual_end"],
                shop.future_end,
                admin,
                counters,
                in_progress=False,
                pause=False,
                rework_of=result,
                take_seq=take_seq,
            )
            if redo is not None:
                placed.append(redo)
                cursor = redo["end"]
        _remember_work(shop, result)
    return placed


def _place_one(
    rng,
    shop,
    ledger,
    job,
    op_type,
    seq_no,
    estimated,
    not_before,
    horizon,
    admin,
    counters,
    *,
    in_progress,
    pause,
    rework_of,
    take_seq,
):
    pairs = shop.pairs.get(op_type.default_machine_type_id) or []
    if not pairs:
        return None
    pause_len = 1.5 if pause else 0.0
    lead = pairs[0][1]
    if rework_of is not None:
        lead = rework_of["worker"]
        pairs = [(rework_of["unit"], lead)] + [p for p in pairs if p[1].id != lead.id]
    else:
        preferred = [p for p in pairs if p[0].default_operator_id == p[1].id]
        rest = [p for p in pairs if p not in preferred]
        if rest:
            cut = rng.randrange(len(rest))
            rest = rest[cut:] + rest[:cut]
        pairs = preferred + rest

    duration_hours = estimated
    worker = pairs[0][1]
    eff = shop.efficiency.get(worker.id, 1.0)
    noise = rng.uniform(0.92, 1.08)
    worked = max(0.75, estimated * eff * noise)
    if pause_len:
        duration_hours = worked + pause_len
    else:
        duration_hours = worked if not in_progress else estimated

    start = end = unit = worker = None
    for unit_try, worker_try in pairs[:8]:
        windows = shop.windows[worker_try.id]
        busy = shop.worker_busy[worker_try.id] + shop.unit_busy[unit_try.id]
        start, end, _ = place_unbroken(
            windows,
            busy,
            timedelta(hours=duration_hours),
            not_before,
            horizon,
        )
        if start is not None:
            unit, worker = unit_try, worker_try
            break
        start = end = None
    if start is None:
        return None

    worked_hours = worked if not in_progress else None
    actual_start = start
    actual_end = None if in_progress else end
    status = OperationStatus.IN_PROGRESS if in_progress else OperationStatus.COMPLETED
    if rework_of is None and in_progress is False and actual_end and utc_to_shop(start).date() > shop.end and job.status == JobOrderStatus.DELIVERED:
        status = OperationStatus.COMPLETED

    category = None
    reason_text = None
    if rework_of is not None:
        category, reason_text = _pick_rework(rng)
        status = OperationStatus.COMPLETED

    # Released-but-not-started operations (scheduled / waiting).
    if job.status == JobOrderStatus.SCHEDULED:
        status = OperationStatus.SCHEDULED
        actual_start = None
        actual_end = None
        worked_hours = None

    op = JobOperation(
        id=_new_id(rng),
        job_order_id=job.id,
        sequence_no=seq_no if rework_of is None else seq_no,
        operation_name=op_type.name,
        operation_type_id=op_type.id,
        machine_type_id=op_type.default_machine_type_id,
        machine_unit_id=unit.id,
        assigned_worker_id=worker.id,
        estimated_hours=Decimal(f"{estimated:.2f}"),
        scheduled_start=start,
        scheduled_end=end,
        actual_start=actual_start,
        actual_end=actual_end,
        status=status,
        rework_of_operation_id=rework_of["op"].id if rework_of else None,
        rework_reason=reason_text,
        rework_reason_category=category,
    )
    if worked_hours is not None and status == OperationStatus.COMPLETED:
        act = Decimal(f"{worked_hours:.4f}")
        est = op.estimated_hours
        op.actual_worked_hours = act
        op.variance_hours = act - est
        op.variance_pct = (op.variance_hours / est) * Decimal(100)
    ledger.add(op, start)
    _audit(ledger, rng, admin, "CREATE", "JobOperation", op.id, start, {"sequence": seq_no})
    shop.book(worker.id, unit.id, start, end)
    counters["operations"] += 1
    if rework_of is not None:
        counters["rework"] += 1

    helper = _maybe_helper(rng, shop, op, worker, start, end, ledger)
    if status == OperationStatus.COMPLETED and actual_start and actual_end:
        _time_logs(
            rng,
            shop,
            ledger,
            op,
            worker,
            actual_start,
            actual_end,
            pause_len,
            counters,
            admin,
            take_seq,
        )
    elif status == OperationStatus.IN_PROGRESS and actual_start:
        _log(ledger, rng, op, worker, OperationTimeEvent.START, actual_start, None, None)

    return {
        "op": op,
        "start": start,
        "end": end,
        "actual_start": actual_start,
        "actual_end": actual_end,
        "worker": worker,
        "unit": unit,
        "helper": helper,
        "rework": rework_of is not None,
    }


def _time_logs(rng, shop, ledger, op, worker, start, end, pause_len, counters, admin, take_seq):
    _log(ledger, rng, op, worker, OperationTimeEvent.START, start, None, None)
    if pause_len:
        pause_at = start + timedelta(minutes=20)
        resume_at = pause_at + timedelta(hours=pause_len)
        same_day = utc_to_shop(pause_at).date() == utc_to_shop(resume_at).date()
        if same_day and resume_at < end and utc_to_shop(start).hour <= 11:
            reason, note = _pick_pause(rng)
            _log(ledger, rng, op, worker, OperationTimeEvent.PAUSE, pause_at, reason, note)
            _log(ledger, rng, op, worker, OperationTimeEvent.RESUME, resume_at, None, None)
            counters["pauses"][reason.value] += 1
            if reason == OperationPauseReason.MACHINE_DOWN:
                _downtime(rng, shop, ledger, op, worker, pause_at, resume_at, counters, admin, take_seq)
    _log(ledger, rng, op, worker, OperationTimeEvent.COMPLETE, end, None, None)


def _downtime(rng, shop, ledger, op, worker, started, ended, counters, admin, take_seq):
    category, reason = DOWNTIME_REASONS[rng.randrange(len(DOWNTIME_REASONS))]
    row = MachineDowntime(
        id=_new_id(rng),
        machine_unit_id=op.machine_unit_id,
        started_at=started,
        ended_at=ended,
        category=category,
        reason=reason,
        reported_by_id=worker.id,
        job_order_id=op.job_order_id,
        operation_id=op.id,
        expected_repair_date=utc_to_shop(ended).date(),
        created_at=started,
    )
    ledger.add(row, started)
    shop.unit_busy[op.machine_unit_id].append((ensure_utc(started), ensure_utc(ended)))
    counters["breakdowns"] += 1
    others = [
        unit
        for unit in shop.units_by_type.get(op.machine_type_id, [])
        if unit.id != op.machine_unit_id
    ]
    if not others or rng.random() > 0.4:
        return
    other = others[rng.randrange(len(others))]
    skilled = [pair for pair in shop.pairs.get(op.machine_type_id, []) if pair[0].id == other.id]
    if not skilled:
        return
    unit, person = skilled[0]
    start, end, _ = place_unbroken(
        shop.windows[person.id],
        shop.worker_busy[person.id] + shop.unit_busy[unit.id],
        timedelta(hours=1),
        ended,
        shop.future_end,
    )
    if start is None:
        return
    follow = JobOperation(
        id=_new_id(rng),
        job_order_id=op.job_order_id,
        sequence_no=take_seq(),
        operation_name=op.operation_name,
        operation_type_id=op.operation_type_id,
        machine_type_id=op.machine_type_id,
        machine_unit_id=unit.id,
        assigned_worker_id=person.id,
        estimated_hours=Decimal("1.00"),
        scheduled_start=start,
        scheduled_end=end,
        actual_start=start,
        actual_end=end,
        actual_worked_hours=Decimal("1.0000"),
        variance_hours=Decimal("0"),
        variance_pct=Decimal("0"),
        status=OperationStatus.COMPLETED,
        notes="Continued on another unit after the stoppage",
    )
    ledger.add(follow, start)
    shop.book(person.id, unit.id, start, end)
    _log(ledger, rng, follow, person, OperationTimeEvent.START, start, None, None)
    _log(ledger, rng, follow, person, OperationTimeEvent.COMPLETE, end, None, None)
    counters["operations"] += 1
    counters["reassignments"] += 1
    _remember_work(
        shop,
        {
            "op": follow,
            "actual_start": start,
            "actual_end": end,
            "worker": person,
            "start": start,
            "end": end,
        },
    )


def _maybe_helper(rng, shop, op, lead, start, end, ledger):
    if rng.random() > 0.25:
        return None
    others = [w for w in shop.workers if w.id != lead.id]
    rng.shuffle(others)
    span = (ensure_utc(start), ensure_utc(end))
    for person in others[:4]:
        if not shop.worker_works(person.id, utc_to_shop(start).date()):
            continue
        if any(b[0] < span[1] and span[0] < b[1] for b in shop.worker_busy[person.id]):
            continue
        helper = OperationHelper(operation_id=op.id, worker_id=person.id, position=1)
        db.session.add(helper)
        ledger.note("operation_helpers", op.id, start, None)
        shop.worker_busy[person.id].append((ensure_utc(start), ensure_utc(end)))
        return person
    return None


def _remember_work(shop, result):
    start = result.get("actual_start") or result["start"]
    end = result.get("actual_end") or result["end"]
    if start is None:
        return
    day = utc_to_shop(start).date()
    last = utc_to_shop(end).date() if end is not None else shop.end
    worker = result["worker"]
    while day <= last and (day - utc_to_shop(start).date()).days < 12:
        if shop.is_working(day):
            shop.day_work[day].append((worker.id, result["op"].id, result["op"].job_order_id))
        day += timedelta(days=1)


def _attendance(rng, shop, ledger, plans, counters):
    busy_weeks = defaultdict(int)
    for plan in plans:
        busy_weeks[plan["po"].isocalendar()[:2]] += 1
    existing = {
        (worker_id, work_date)
        for worker_id, work_date in db.session.query(
            AttendanceRecord.worker_id, AttendanceRecord.work_date
        )
        .filter(
            AttendanceRecord.work_date >= shop.start,
            AttendanceRecord.work_date <= shop.end,
        )
        .all()
    }
    admin = shop.admins[0]
    for person in shop.workers:
        for day in shop.working_days:
            if not shop.worker_works(person.id, day):
                continue
            if (person.id, day) in existing:
                continue
            if rng.random() < 0.03:
                counters["absences"] += 1
                continue
            overtime = busy_weeks[day.isocalendar()[:2]] >= 13 and rng.random() < 0.2
            clock_in = shop_local_to_utc(day, time(8, rng.randint(0, 12)))
            clock_out = shop_local_to_utc(day, time(19 if overtime else 17, rng.randint(0, 15)))
            row = AttendanceRecord(
                id=_new_id(rng),
                worker_id=person.id,
                work_date=day,
                clock_in=clock_in,
                clock_out=clock_out,
                note="Overtime" if overtime else None,
                recorded_by_id=admin.id,
                created_at=clock_out,
                updated_at=clock_out,
            )
            ledger.add(row, clock_out)
            counters["attendance"] += 1


def _consumables(rng, shop, ledger, counters):
    office = shop.office or shop.admins[0]
    names = sorted(shop.consumables, key=lambda t: t.name.lower())
    estimated = set()
    if len(names) >= 6:
        estimated = {t.id for t in names[-2:]}
    elif len(names) >= 4:
        estimated = {names[-1].id}
    cutoff_days = [d for d in shop.working_days if d <= shop.end][-8:]
    cutoff = cutoff_days[0] if cutoff_days else shop.end
    qty = {t.id: Decimal(str(t.quantity_on_hand or 0)) for t in shop.consumables}
    inbound = []
    supplier_cycle = 0

    def receive_due(day):
        still = []
        for due, tool, amount, order, line in inbound:
            if due > day:
                still.append((due, tool, amount, order, line))
                continue
            _apply_receive(rng, shop, ledger, tool, amount, order, line, due, office, qty, counters)
        inbound[:] = still

    for day in shop.working_days:
        receive_due(day)
        for tool in names:
            if tool.id in estimated and day < cutoff:
                continue
            rate = _usage_rate(tool.name)
            if rate == "low" and day.toordinal() % 3 != 0:
                scans = 1 if rng.random() < 0.35 else 0
            elif rate == "high":
                scans = rng.randint(3, 5)
            else:
                scans = rng.randint(1, 2)
            for n in range(scans):
                if qty[tool.id] < 1:
                    break
                _snapshot_stock(ledger, tool, shop_local_to_utc(day, time(9, 0)))
                qty[tool.id] -= 1
                tool.quantity_on_hand = qty[tool.id]
                when = shop_local_to_utc(day, time(9, min(59, n * 7)))
                link = shop.day_work.get(day) or []
                worker_id = shop.workers[n % len(shop.workers)].id
                op_id = job_id = None
                if link:
                    worker_id, op_id, job_id = link[n % len(link)]
                event = ToolEvent(
                    id=_new_id(rng),
                    tool_id=tool.id,
                    worker_id=worker_id,
                    type=ToolEventType.SCAN,
                    quantity=Decimal("1"),
                    stock_delta=Decimal("-1"),
                    job_order_id=job_id,
                    operation_id=op_id,
                    created_at=when,
                )
                ledger.add(event, when)
                counters["scans"] += 1
            reorder_at = Decimal(12 if rate == "high" else 6)
            if qty[tool.id] <= reorder_at and not any(t.id == tool.id for _, t, *_ in inbound):
                supplier = shop.suppliers[supplier_cycle % len(shop.suppliers)]
                supplier_cycle += 1
                amount = Decimal(48 if rate == "high" else 24)
                order, line, due = _stock_po(
                    rng, shop, ledger, tool, supplier, day, amount, office, counters
                )
                inbound.append((due, tool, amount, order, line))
    receive_due(shop.end + timedelta(days=1))
    # A few mid-history corrections, then the closing counts replace on-hand.
    for tool in names[: min(3, len(names))]:
        if qty[tool.id] < 2:
            continue
        delta = Decimal(rng.choice((-2, -1, 1)))
        if qty[tool.id] + delta < 0:
            continue
        _snapshot_stock(ledger, tool, shop_local_to_utc(shop.end, time(15, 0)))
        qty[tool.id] += delta
        tool.quantity_on_hand = qty[tool.id]
        _correction(rng, ledger, tool, office, delta, "Cycle count", shop_local_to_utc(shop.end, time(15, 0)), counters)
    shop.closing_qty = qty
    shop.estimated_ids = estimated


def _stock_po(rng, shop, ledger, tool, supplier, day, amount, office, counters):
    lead = min(21, max(2, int(supplier.typical_lead_time_days or 7)))
    profile = SUPPLIER_PROFILES[min(shop.suppliers.index(supplier), len(SUPPLIER_PROFILES) - 1)]
    expected = shop.next_working(day + timedelta(days=lead))
    late = rng.random() < profile["late"]
    received = shop.next_working(expected + timedelta(days=profile["extra"])) if late else expected
    if received > shop.end:
        received = shop.end if shop.is_working(shop.end) else shop.working_on_or_before(shop.end)
        late = received > expected
    year = day.year
    seq = shop.next_po_seq(supplier.id, year)
    issued_at = shop_local_to_utc(day, time(10, 0))
    order = SupplierOrder(
        id=_new_id(rng),
        po_seq=seq,
        po_year=year,
        po_number=format_po_number(supplier.code, year, seq),
        supplier_id=supplier.id,
        status=SupplierOrderStatus.RECEIVED,
        date_issued=day,
        expected_delivery_date=expected,
        original_expected_delivery_date=expected,
        received_date=received,
        terms_of_payment="PDC",
        delivery_mode="DELIVERY",
        prepared_by_id=office.id,
        issued_by_id=office.id,
        printed_at=issued_at,
        printed_by_id=office.id,
        print_count=1,
        created_at=issued_at,
        updated_at=shop_local_to_utc(received, time(11, 0)),
    )
    ledger.add(order, issued_at)
    cost = tool.unit_cost if tool.unit_cost is not None else Decimal(str(rng.randrange(15, 400)))
    line = MaterialPurchase(
        id=_new_id(rng),
        tool_id=tool.id,
        material_name=tool.name,
        grade_or_spec=tool.size_spec,
        size_spec=tool.size_spec,
        quantity=amount,
        unit=tool.unit or "pcs",
        unit_cost=Decimal(str(cost)),
        supplier_id=supplier.id,
        supplier_order_id=order.id,
        date_ordered=day,
        date_received=received,
        created_at=issued_at,
        updated_at=order.updated_at,
    )
    ledger.add(line, issued_at)
    bucket = counters["suppliers"][supplier.id]
    bucket["name"] = supplier.name
    bucket["orders"] += 1
    if received <= expected:
        bucket["on_time"] += 1
    else:
        bucket["late"] += 1
    counters["purchase_orders"] += 1
    return order, line, received


def _apply_receive(rng, shop, ledger, tool, amount, order, line, day, office, qty, counters):
    when = shop_local_to_utc(day, time(11, 0))
    _snapshot_stock(ledger, tool, when)
    qty[tool.id] = qty.get(tool.id, Decimal("0")) + amount
    tool.quantity_on_hand = qty[tool.id]
    event = ToolEvent(
        id=_new_id(rng),
        tool_id=tool.id,
        worker_id=office.id,
        type=ToolEventType.RECEIVE,
        quantity=amount,
        stock_delta=amount,
        supplier=_supplier_name(order.supplier_id),
        received_on=day,
        material_purchase_id=line.id,
        created_at=when,
    )
    ledger.add(event, when)
    counters["receives"] += 1


def _retarget_stock(rng, shop, ledger, counters):
    from app.services.forecast_service import stock_snapshot_for_tools

    db.session.flush()
    tools = sorted(shop.consumables, key=lambda t: t.name.lower())
    if not tools:
        return
    snap = stock_snapshot_for_tools(tools, today=shop.end)
    office = shop.office or shop.admins[0]
    when = shop_local_to_utc(shop.end, time(16, 0))
    for index, tool in enumerate(tools):
        info = snap.get(tool.id) or {}
        adu = info.get("adu")
        rop = info.get("reorderPoint")
        band = index % 10
        target_kind = "now" if band == 0 else "soon" if band in (1, 2) else "ok"
        target = _target_qty(adu, rop, target_kind)
        current = Decimal(str(tool.quantity_on_hand or 0))
        delta = target - current
        if delta == 0:
            continue
        _snapshot_stock(ledger, tool, when)
        tool.quantity_on_hand = target
        _correction(rng, ledger, tool, office, delta, "Cycle count", when, counters)


def _tool_borrows(rng, shop, ledger, counters):
    units = [
        unit
        for unit in ToolUnit.query.order_by(ToolUnit.asset_code).all()
        if unit.status == ToolUnitStatus.AVAILABLE
    ]
    if not units or not shop.working_days:
        return
    last_day = shop.working_days[-1]
    leave_out = {unit.id for unit in units[:3]}
    for day in shop.working_days:
        for index, unit in enumerate(units):
            if rng.random() < 0.08 and not (day == last_day and unit.id in leave_out):
                continue
            person = shop.workers[(index + day.toordinal()) % len(shop.workers)]
            borrow_at = shop_local_to_utc(day, time(8, 10))
            borrow = ToolEvent(
                id=_new_id(rng),
                tool_unit_id=unit.id,
                worker_id=person.id,
                type=ToolEventType.BORROW,
                quantity=Decimal("1"),
                created_at=borrow_at,
            )
            ledger.add(borrow, borrow_at)
            counters["borrows"] += 1
            if day == last_day and unit.id in leave_out:
                counters["open_borrows"] += 1
                continue
            return_at = shop_local_to_utc(day, time(16, 40))
            returned = ToolEvent(
                id=_new_id(rng),
                tool_unit_id=unit.id,
                worker_id=person.id,
                type=ToolEventType.RETURN,
                quantity=Decimal("1"),
                created_at=return_at,
            )
            ledger.add(returned, return_at)
            counters["returns"] += 1


def _ensure_holidays(ledger):
    added = []
    present = []
    existing = {
        row.date: row
        for row in WorkCalendarException.query.filter(
            WorkCalendarException.date.in_([d for d, _ in HOLIDAYS])
        ).all()
    }
    for day, name in HOLIDAYS:
        if day in existing:
            present.append(day.isoformat())
            continue
        when = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
        row = WorkCalendarException(
            id=str(uuid.uuid5(uuid.NAMESPACE_OID, f"sample-holiday-{day.isoformat()}")),
            date=day,
            type=CalendarExceptionType.HOLIDAY_NO_WORK,
            note=name,
        )
        ledger.add(row, when)
        added.append(day.isoformat())
    return added, present


def _remove():
    rows = SampleRecord.query.order_by(SampleRecord.id).all()
    snapshots = []
    created = defaultdict(list)
    for row in rows:
        detail = row.detail or {}
        if detail.get("role") == "stock_snapshot":
            snapshots.append((row.record_id, str(detail.get("quantityOnHand"))))
        else:
            created[row.table_name].append(row.record_id)
    unknown = set(created) - set(_DELETE_ORDER) - {"operation_helpers"}
    if unknown:
        raise RuntimeError("Ledger has tables remove does not know: " + ", ".join(sorted(unknown)))

    deleted = {}
    helper_ids = created.get("operation_helpers") or []
    deleted["operation_helpers"] = 0
    for chunk in _chunks(helper_ids):
        deleted["operation_helpers"] += (
            OperationHelper.query.filter(OperationHelper.operation_id.in_(chunk)).delete(
                synchronize_session=False
            )
            or 0
        )
    for table in _DELETE_ORDER:
        ids = created.get(table) or []
        deleted[table] = _delete_ids(table, ids) if ids else 0

    restored = 0
    for record_id, qty in snapshots:
        tool = db.session.get(Tool, record_id)
        if tool is None:
            continue
        tool.quantity_on_hand = Decimal(qty)
        restored += 1
    ledger_rows = len(rows)
    SampleRecord.query.delete(synchronize_session=False)
    return {"deleted": deleted, "restoredStock": restored, "ledgerRows": ledger_rows}


_DELETE_ORDER = (
    "operation_time_logs",
    "schedule_moves",
    "tool_events",
    "machine_downtimes",
    "audit_logs",
    "notification_logs",
    "sales_invoices",
    "staff_alerts",
    "material_purchases",
    "supplier_orders",
    "operations",
    "attendance_records",
    "job_orders",
    "work_calendar_exceptions",
)

_DELETE_MODELS = {
    "operation_time_logs": OperationTimeLog,
    "schedule_moves": ScheduleMove,
    "tool_events": ToolEvent,
    "machine_downtimes": MachineDowntime,
    "audit_logs": AuditLog,
    "notification_logs": NotificationLog,
    "sales_invoices": SalesInvoice,
    "staff_alerts": StaffAlert,
    "material_purchases": MaterialPurchase,
    "supplier_orders": SupplierOrder,
    "operations": JobOperation,
    "attendance_records": AttendanceRecord,
    "job_orders": JobOrder,
    "work_calendar_exceptions": WorkCalendarException,
}


class _Shop:
    def __init__(self, start, end):
        self.start = start
        self.end = end
        self.history_end = shop_local_to_utc(end, time(17, 0))
        self.future_end = shop_local_to_utc(end + timedelta(days=21), time(17, 0))
        self.clients = []
        self.client_weights = []
        self.suppliers = []
        self.catalog = []
        self.workers = []
        self.admins = []
        self.office = None
        self.op_types = []
        self.pairs = {}
        self.units_by_type = {}
        self.windows = {}
        self.worker_schedules = {}
        self.worker_busy = defaultdict(list)
        self.unit_busy = defaultdict(list)
        self.efficiency = {}
        self.working_days = []
        self.exceptions = {}
        self.shop_schedule = default_shop_schedule_by_dow()
        self.day_work = defaultdict(list)
        self.consumables = []
        self.hours_per_op = 2.0
        self._po_next = {}
        self.closing_qty = {}
        self.estimated_ids = set()

    @classmethod
    def load(cls, start, end):
        shop = cls(start, end)
        shop.clients = Client.query.order_by(Client.name, Client.id).all()
        weights = [0.40, 0.28, 0.20, 0.12]
        raw = [weights[i] if i < len(weights) else 0.05 for i in range(len(shop.clients))]
        total = sum(raw) or 1
        shop.client_weights = [w / total for w in raw]
        shop.suppliers = [
            s
            for s in Supplier.query.filter_by(active=True).order_by(Supplier.name, Supplier.id).all()
            if s.code
        ]
        shop.catalog = (
            MaterialCatalogItem.query.filter_by(active=True).order_by(MaterialCatalogItem.name).all()
        )
        shop.admins = (
            User.query.filter_by(role=UserRole.ADMIN, status=UserStatus.ACTIVE, active=True)
            .order_by(User.id)
            .all()
        )
        office = (
            User.query.filter_by(role=UserRole.OFFICE_STAFF, status=UserStatus.ACTIVE, active=True)
            .order_by(User.id)
            .first()
        )
        shop.office = office
        # Invited employees are the shop's crew until they activate an account.
        # Their rows are not changed.
        workers = (
            User.query.filter(
                User.role == UserRole.PRODUCTION_WORKER,
                User.status != UserStatus.DISABLED,
            )
            .order_by(User.id)
            .all()
        )
        skills = defaultdict(set)
        for row in WorkerSkill.query.all():
            skills[row.worker_id].add(row.machine_type_id)
        units = (
            MachineUnit.query.filter_by(active=True).order_by(MachineUnit.label).all()
        )
        shop.units_by_type = defaultdict(list)
        for unit in units:
            shop.units_by_type[unit.machine_type_id].append(unit)
        worker_ids = {w.id for w in workers}
        op_types = (
            OperationType.query.filter_by(active=True, is_outsourced=False)
            .order_by(OperationType.code)
            .all()
        )
        usable = []
        for op_type in op_types:
            type_id = op_type.default_machine_type_id
            if not type_id or not shop.units_by_type.get(type_id):
                continue
            skilled = [w for w in workers if type_id in skills.get(w.id, ())]
            if not skilled:
                continue
            usable.append(op_type)
            pairs = []
            for unit in shop.units_by_type[type_id]:
                preferred = [w for w in skilled if w.id == unit.default_operator_id]
                others = [w for w in skilled if w.id != unit.default_operator_id]
                for person in preferred + others:
                    pairs.append((unit, person))
            shop.pairs[type_id] = pairs
        shop.op_types = usable
        used_workers = []
        seen = set()
        for pairs in shop.pairs.values():
            for _unit, person in pairs:
                if person.id not in seen:
                    seen.add(person.id)
                    used_workers.append(person)
        shop.workers = used_workers or [w for w in workers if w.id in worker_ids and skills.get(w.id)]
        span_start = start - timedelta(days=2)
        span_end = end + timedelta(days=21)
        shop.exceptions = load_calendar_exceptions(span_start, span_end)
        schedules = load_worker_schedule_maps_many([w.id for w in shop.workers])
        shop_windows = build_worker_working_windows(
            shop.shop_schedule,
            shop.exceptions,
            shop_local_to_utc(span_start, time(0, 0)),
            shop.future_end,
        )
        for person in shop.workers:
            sched = schedules.get(person.id) or {}
            shop.worker_schedules[person.id] = sched
            source = sched if _has_hours(sched) else shop.shop_schedule
            windows = build_worker_working_windows(
                source,
                shop.exceptions,
                shop_local_to_utc(span_start, time(0, 0)),
                shop.future_end,
            )
            shop.windows[person.id] = intersect_intervals(windows, shop_windows) or windows
        shop.working_days = [d for d in _daterange(start, end) if shop.is_working(d)]
        shop._load_busy(span_start)
        shop._load_po_seqs()
        shop.consumables = (
            Tool.query.filter_by(category=ToolCategory.CONSUMABLE, active=True)
            .order_by(Tool.name)
            .all()
        )
        capacity = max(1, len(shop.workers)) * 7.5 * max(1, len(shop.working_days))
        weeks = max(1, len({d.isocalendar()[:2] for d in shop.working_days}))
        ops = weeks * 12 * 2.2
        shop.hours_per_op = min(3.5, max(1.0, (capacity * 0.42) / ops))
        eff_rng = random.Random(len(shop.workers) * 1009 + start.toordinal())
        # Efficiency is stable per worker id but still depends on the run seed
        # via the caller. Re-seeded below in generate — set a placeholder first.
        for person in shop.workers:
            shop.efficiency[person.id] = 0.85 + eff_rng.random() * 0.40
        return shop

    def tune_efficiency(self, rng):
        for person in self.workers:
            self.efficiency[person.id] = rng.uniform(0.85, 1.25)

    def is_working(self, day):
        return bool(effective_windows_for_date(day, self.shop_schedule, self.exceptions))

    def worker_works(self, worker_id, day):
        sched = self.worker_schedules.get(worker_id) or {}
        source = sched if _has_hours(sched) else self.shop_schedule
        return bool(effective_windows_for_date(day, source, self.exceptions))

    def next_working(self, day):
        for _ in range(40):
            if self.is_working(day):
                return day
            day += timedelta(days=1)
        return day

    def working_on_or_before(self, day):
        for _ in range(40):
            if self.is_working(day):
                return day
            day -= timedelta(days=1)
        return day

    def book(self, worker_id, unit_id, start, end):
        span = (ensure_utc(start), ensure_utc(end))
        self.worker_busy[worker_id].append(span)
        if unit_id:
            self.unit_busy[unit_id].append(span)

    def next_po_seq(self, supplier_id, year):
        key = (supplier_id, year)
        seq = self._po_next.get(key, 1)
        self._po_next[key] = seq + 1
        return seq

    def _load_po_seqs(self):
        rows = (
            db.session.query(
                SupplierOrder.supplier_id,
                SupplierOrder.po_year,
                func.max(SupplierOrder.po_seq),
            )
            .filter(SupplierOrder.po_year.isnot(None))
            .group_by(SupplierOrder.supplier_id, SupplierOrder.po_year)
            .all()
        )
        self._po_next = {(sid, year): int(mx or 0) + 1 for sid, year, mx in rows}

    def _load_busy(self, span_start):
        start_utc = shop_local_to_utc(span_start, time(0, 0))
        rows = (
            db.session.query(
                JobOperation.assigned_worker_id,
                JobOperation.machine_unit_id,
                JobOperation.scheduled_start,
                JobOperation.scheduled_end,
            )
            .filter(
                JobOperation.scheduled_start.isnot(None),
                JobOperation.scheduled_end.isnot(None),
                JobOperation.scheduled_end > start_utc,
                JobOperation.scheduled_start < self.future_end,
            )
            .all()
        )
        for worker_id, unit_id, start, end in rows:
            if worker_id:
                self.worker_busy[worker_id].append((ensure_utc(start), ensure_utc(end)))
            if unit_id:
                self.unit_busy[unit_id].append((ensure_utc(start), ensure_utc(end)))
        helpers = (
            db.session.query(
                OperationHelper.worker_id,
                JobOperation.scheduled_start,
                JobOperation.scheduled_end,
            )
            .join(JobOperation, JobOperation.id == OperationHelper.operation_id)
            .filter(
                JobOperation.scheduled_start.isnot(None),
                JobOperation.scheduled_end.isnot(None),
                JobOperation.scheduled_end > start_utc,
            )
            .all()
        )
        for worker_id, start, end in helpers:
            self.worker_busy[worker_id].append((ensure_utc(start), ensure_utc(end)))
        downs = MachineDowntime.query.filter(
            MachineDowntime.started_at < self.future_end,
            db.or_(
                MachineDowntime.ended_at.is_(None),
                MachineDowntime.ended_at > start_utc,
            ),
        ).all()
        for row in downs:
            end = row.ended_at or self.future_end
            self.unit_busy[row.machine_unit_id].append((ensure_utc(row.started_at), ensure_utc(end)))


class _Ledger:
    def __init__(self):
        self.snapshots = 0

    def add(self, obj, when):
        _stamp(obj, when)
        db.session.add(obj)
        self.note(obj.__tablename__, obj.id, when, None)

    def note(self, table, record_id, when, detail):
        db.session.add(
            SampleRecord(
                table_name=table,
                record_id=str(record_id),
                created_at=when,
                detail=detail,
            )
        )


def _snapshot_stock(ledger, tool, when):
    exists = (
        SampleRecord.query.filter_by(table_name="tools", record_id=tool.id).first()
        if False
        else None
    )
    # In-memory guard: one snapshot per tool, the quantity before our first change.
    seen = getattr(ledger, "_seen_tools", None)
    if seen is None:
        ledger._seen_tools = seen = set()
    if tool.id in seen:
        return
    seen.add(tool.id)
    ledger.note(
        "tools",
        tool.id,
        when,
        {"role": "stock_snapshot", "quantityOnHand": str(tool.quantity_on_hand or 0)},
    )
    ledger.snapshots += 1


def _correction(rng, ledger, tool, user, delta, reason, when, counters):
    event = ToolEvent(
        id=_new_id(rng),
        tool_id=tool.id,
        worker_id=user.id,
        type=ToolEventType.CORRECTION,
        quantity=abs(delta),
        stock_delta=delta,
        reason=reason,
        created_at=when,
    )
    ledger.add(event, when)
    counters["corrections"] += 1


def _log(ledger, rng, op, worker, kind, when, reason, note):
    row = OperationTimeLog(
        id=_new_id(rng),
        operation_id=op.id,
        worker_id=worker.id,
        event=kind,
        event_at=when,
        reason=reason,
        note=note,
        created_at=when,
    )
    ledger.add(row, when)


def _audit(ledger, rng, user, action, entity_type, entity_id, when, after):
    row = AuditLog(
        id=_new_id(rng),
        user_id=user.id,
        user_role=user.role.value if user.role else None,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        after_json=after,
        created_at=when,
    )
    ledger.add(row, when)


def _summary(plans, counters, holidays_added, holidays_present, ledger):
    pos = []
    for bucket in counters["suppliers"].values():
        decided = bucket["on_time"] + bucket["late"]
        pos.append(
            {
                "name": bucket["name"],
                "orders": bucket["orders"],
                "onTime": bucket["on_time"],
                "late": bucket["late"],
                "open": bucket["open"],
                "onTimePct": round(bucket["on_time"] / decided * 100, 1) if decided else None,
            }
        )
    pos.sort(key=lambda r: r["name"].lower())
    return {
        "jobs": counters["jobs"],
        "jobsByStatus": dict(counters["by_status"]),
        "jobsByType": dict(counters["by_type"]),
        "jobsByClient": dict(counters["by_client"]),
        "operations": counters["operations"],
        "rework": counters["rework"],
        "pausesByReason": dict(counters["pauses"]),
        "breakdowns": counters["breakdowns"],
        "reassignments": counters["reassignments"],
        "attendance": counters["attendance"],
        "absences": counters["absences"],
        "purchaseOrders": counters["purchase_orders"],
        "posBySupplier": pos,
        "consumableScans": counters["scans"],
        "consumableReceives": counters["receives"],
        "corrections": counters["corrections"],
        "toolBorrows": counters["borrows"],
        "toolReturns": counters["returns"],
        "toolUnitsOpenBorrow": counters["open_borrows"],
        "holidaysAdded": holidays_added,
        "holidaysAlreadyPresent": holidays_present,
        "stockSnapshots": ledger.snapshots,
        "firstTitles": list(counters["titles"]),
        "materialMoves": counters["material_moves"],
    }


def _blank_counters():
    return {
        "jobs": 0,
        "by_status": defaultdict(int),
        "by_type": defaultdict(int),
        "by_client": defaultdict(int),
        "operations": 0,
        "rework": 0,
        "pauses": defaultdict(int),
        "breakdowns": 0,
        "reassignments": 0,
        "attendance": 0,
        "absences": 0,
        "purchase_orders": 0,
        "suppliers": defaultdict(lambda: {"name": "", "orders": 0, "on_time": 0, "late": 0, "open": 0}),
        "scans": 0,
        "receives": 0,
        "corrections": 0,
        "borrows": 0,
        "returns": 0,
        "open_borrows": 0,
        "titles": [],
        "material_moves": 0,
    }


def _master_fingerprint():
    def rows(query, *cols):
        return tuple(tuple(getattr(obj, col) for col in cols) for obj in query.all())

    settings = db.session.get(ShopSettings, 1)
    setting_key = None
    if settings is not None:
        setting_key = (
            str(settings.break_start),
            str(settings.break_end),
            settings.reorder_soon_working_days,
        )
    return (
        rows(Client.query.order_by(Client.id), "id", "name", "email", "notify_by_email"),
        rows(User.query.order_by(User.id), "id", "full_name", "role", "status", "active"),
        rows(
            Supplier.query.order_by(Supplier.id),
            "id",
            "name",
            "code",
            "typical_lead_time_days",
            "active",
        ),
        rows(MachineType.query.order_by(MachineType.id), "id", "code", "name"),
        rows(
            MachineUnit.query.order_by(MachineUnit.id),
            "id",
            "label",
            "active",
            "default_operator_id",
        ),
        rows(MaterialCatalogItem.query.order_by(MaterialCatalogItem.id), "id", "name", "active"),
        rows(Tool.query.order_by(Tool.id), "id", "name", "code", "unit_cost", "minimum_stock", "active"),
        tuple(
            (u.id, u.status, u.current_holder_id, u.held_since, u.asset_code)
            for u in ToolUnit.query.order_by(ToolUnit.id).all()
        ),
        rows(
            WorkerSkill.query.order_by(WorkerSkill.id),
            "id",
            "worker_id",
            "machine_type_id",
            "proficiency",
        ),
        tuple(
            (s.worker_id, s.day_of_week, s.is_working, str(s.start_time), str(s.end_time))
            for s in WorkerSchedule.query.order_by(WorkerSchedule.id).all()
        ),
        setting_key,
    )


def _reject_notifications():
    # Sample clients are not given email consent, and this command never
    # calls the mailer. A log row would mean something else sent one.
    if NotificationLog.query.filter(NotificationLog.id.isnot(None)).count():
        # Existing logs from before this run are fine. Only rows we just
        # added would be pending in the session without a ledger note.
        pending = [
            obj
            for obj in db.session.new
            if isinstance(obj, NotificationLog)
        ]
        if pending:
            raise RuntimeError("Sample history tried to write a notification log.")


def _delete_ids(table, ids):
    model = _DELETE_MODELS[table]
    total = 0
    if table == "operations":
        for chunk in _chunks(ids):
            total += (
                model.query.filter(
                    model.id.in_(chunk),
                    model.rework_of_operation_id.isnot(None),
                ).delete(synchronize_session=False)
                or 0
            )
    for chunk in _chunks(ids):
        total += model.query.filter(model.id.in_(chunk)).delete(synchronize_session=False) or 0
    return total


def _chunks(ids, size=400):
    for index in range(0, len(ids), size):
        yield ids[index : index + size]


def _stamp(obj, when):
    if getattr(obj, "created_at", None) is None and hasattr(obj, "created_at"):
        obj.created_at = when
    if hasattr(obj, "updated_at") and obj.updated_at is None:
        obj.updated_at = when


def _new_id(rng) -> str:
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def _parse_day(value, name):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:
        raise ValueError(f"{name} must be YYYY-MM-DD") from exc


def _daterange(start, end):
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


def _weeks(days):
    buckets = []
    current = []
    key = None
    for day in days:
        iso = day.isocalendar()[:2]
        if key is None:
            key = iso
        elif iso != key:
            buckets.append(current)
            current = []
            key = iso
        current.append(day)
    if current:
        buckets.append(current)
    return buckets


def _weighted(rng, weights):
    roll = rng.random()
    acc = 0.0
    for index, weight in enumerate(weights):
        acc += weight
        if roll <= acc:
            return index
    return len(weights) - 1


def _job_type(rng):
    roll = rng.random()
    if roll < 0.55:
        return JobType.FABRICATION
    if roll < 0.80:
        return JobType.MODIFICATION
    return JobType.REPAIR


def _needs_material(rng, kind):
    if kind == JobType.FABRICATION:
        return rng.random() < 0.95
    if kind == JobType.MODIFICATION:
        return rng.random() < 0.25
    return rng.random() < 0.08


def _priority(rng):
    roll = rng.random()
    if roll < 0.20:
        return JobPriority.HIGH
    if roll < 0.90:
        return JobPriority.MODERATE
    return JobPriority.LOW


def _op_count(rng):
    roll = rng.random()
    if roll < 0.20:
        return 1
    if roll < 0.60:
        return 2
    if roll < 0.85:
        return 3
    return 4


def _pick_pause(rng):
    roll = rng.random()
    acc = 0.0
    for reason, weight, note in PAUSE_WEIGHTS:
        acc += weight
        if roll <= acc:
            if reason == OperationPauseReason.OTHER and rng.random() < 0.5:
                note = "Hold for a rework check"
            return reason, note
    reason, _weight, note = PAUSE_WEIGHTS[0]
    return reason, note


def _pick_rework(rng):
    roll = rng.random()
    acc = 0.0
    for category, weight, text in REWORK_WEIGHTS:
        acc += weight
        if roll <= acc:
            return category, text
    return REWORK_WEIGHTS[0][0], REWORK_WEIGHTS[0][2]


def _grade(item, rng):
    grades = list(item.grades or [])
    if not grades:
        return "Commercial"
    grade = grades[rng.randrange(len(grades))]
    if isinstance(grade, dict):
        grade = grade.get("name") or grade.get("grade") or "Commercial"
    return str(grade)[:255]


def _usage_rate(name):
    text = (name or "").lower()
    if any(word in text for word in ("disc", "disk", "wheel", "cutting", "grinding")):
        return "high"
    if any(word in text for word in ("tap", "insert")):
        return "low"
    return "mid"


def _target_qty(adu, rop, kind):
    adu_n = float(adu or 0)
    rop_n = float(rop or 0)
    if kind == "now":
        qty = max(0.0, math.floor(rop_n) - (0 if rop_n > math.floor(rop_n) else 1))
        if rop_n <= 0:
            qty = 0
    elif kind == "soon":
        qty = rop_n + max(adu_n * 4, 1)
    else:
        qty = rop_n + max(adu_n * 20, 8)
    return Decimal(str(round(qty, 2)))


def _has_hours(schedule):
    return any(
        row and row.is_working and row.start_time and row.end_time for row in (schedule or {}).values()
    )


def _fmt_counts(counts):
    if not counts:
        return "none"
    return ", ".join(f"{key} {value}" for key, value in sorted(counts.items()))


def _freeze_onupdate():
    saved = [(col, col.onupdate) for col in _ONUPDATE_COLUMNS]
    for col, _previous in saved:
        col.onupdate = None
    return saved


def _thaw_onupdate(saved):
    for col, previous in saved:
        col.onupdate = previous


@contextmanager
def _quiet_audit():
    """The global listeners would stamp audit rows with 'now' and leave them
    out of the ledger. Job audits are written explicitly at the event time."""
    hooks = (
        ("after_insert", _after_insert),
        ("after_update", _after_update),
        ("after_delete", _after_delete),
    )
    removed = []
    for model in _AUDIT_MODELS:
        for name, fn in hooks:
            if event.contains(model, name, fn):
                event.remove(model, name, fn)
                removed.append((model, name, fn))
    try:
        yield
    finally:
        for model, name, fn in removed:
            if not event.contains(model, name, fn):
                event.listen(model, name, fn)


def _supplier_name(supplier_id):
    row = db.session.get(Supplier, supplier_id)
    return row.name if row is not None else "Supplier"
