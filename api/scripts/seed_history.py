"""
Seed realistic 12-month production and consumable stock history for analytics
and forecast demos.

Standalone — NOT part of `flask seed`. Explicitly invoke:

    cd api
    .\\.venv\\Scripts\\python.exe scripts\\seed_history.py
    .\\.venv\\Scripts\\python.exe scripts\\seed_history.py --wipe

LOCAL ONLY. Refuses non-localhost / non-5433 DATABASE_URL.

Tagged with HIST-SEED so runs are idempotent and --wipe removes only
records this script created. Never mutates pre-existing jobs/ops/users.
"""

from __future__ import annotations

import argparse
import math
import os
import random
import sys
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

# Ensure api/ is on sys.path when invoked as scripts/seed_history.py
API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

os.chdir(API_ROOT)

from dotenv import load_dotenv
from sqlalchemy import or_

load_dotenv(API_ROOT / ".env")

from app import create_app
from app.extensions import db
from app.models.client import Client
from app.models.job_order import (
    JobOrder,
    JobOrderStatus,
    JobPriority,
    JobType,
    PartCondition,
    default_material_status,
)
from app.models.machine import MachineType, MachineUnit
from app.models.material_purchase import MaterialPurchase
from app.models.operation import JobOperation, OperationStatus
from app.models.operation_time import (
    DowntimeCategory,
    MachineDowntime,
    OperationPauseReason,
    OperationTimeEvent,
    OperationTimeLog,
)
from app.models.notification import NotificationLog
from app.models.sales_invoice import SalesInvoice
from app.models.schedule_move import DelayKind, MaterialCause, ScheduleMove
from app.models.stocktake import Stocktake, StocktakeLine
from app.models.supplier import Supplier
from app.models.supplier_order import (
    SupplierOrder,
    SupplierOrderStatus,
    format_legacy_po_number,
    format_po_number,
)
from app.models.tool import Tool, ToolCategory
from app.models.tool_event import ToolEvent, ToolEventType
from app.models.user import User, UserRole
from app.models.worker_skill import (
    CalendarExceptionType,
    OperationType,
    WorkCalendarException,
    WorkerSkill,
)
from app.services.delay_analysis_service import ran_over_target
from app.services.job_order_service import _parse_datetime
from app.services.material_purchase_service import sync_job_material_from_purchases
from app.services.operation_service import recompute_variance
from app.services.schedule_calendar import next_shop_working_day, shop_local_to_utc, shop_now
from app.services.schedule_service import propose_schedule
from app.services.supplier_order_service import recompute_order_status

TAG = "HIST-SEED"
PO_PREFIX = f"{TAG}-"
JOB_TITLE_PREFIX = f"[{TAG}]"

# Uneven client mix (~half of jobs on two dominant manufacturing accounts).
# Names are prefixed with TAG so --wipe removes them via Client.name LIKE 'HIST-SEED%'.
CLIENT_PROFILES = [
    {
        "key": "tosoh",
        "display": "Tosoh Polyvin Corporation",
        "jobs": 14,
        "profile": "manufacturing",
    },
    {
        "key": "sidc",
        "display": "SIDC",
        "jobs": 12,
        "profile": "manufacturing",
    },
    {
        "key": "sanitary",
        "display": "Sanitary Care",
        "jobs": 8,
        "profile": "manufacturing",
    },
    {
        "key": "revery",
        "display": "Revery Construction",
        "jobs": 7,
        "profile": "construction",
    },
    {
        "key": "mmv",
        "display": "MMV Builders",
        "jobs": 5,
        "profile": "construction",
    },
    {
        "key": "aboitiz",
        "display": "Aboitiz",
        "jobs": 4,
        "profile": "mixed",
    },
]


def _client_seed_name(display: str) -> str:
    return f"{TAG} {display}"

# 12 complete months before the current one, 4-8 job orders each (by PO date),
# plus a couple in the current month. Client "jobs" above are relative weights.
HISTORY_MONTHS = 12
JOBS_PER_MONTH = (4, 8)
# Open backlog: jobs received in the last BACKLOG_DAYS are still open, due two
# to four weeks out; those started within BACKLOG_SCHEDULED_DAYS have not begun.
BACKLOG_JOBS = (8, 10)
BACKLOG_DAYS = 21
# The month the backlog starts in still finishes a few jobs received before it.
MIN_JOBS_BEFORE_BACKLOG = 3
# As the backlog builds, jobs received in the weeks before it wait longer to start
# (the full SLOWDOWN_WAIT from halfway through), so completions slip a month.
SLOWDOWN_DAYS = 42
SLOWDOWN_WAIT = (10, 16)
BACKLOG_SCHEDULED_DAYS = 5
BACKLOG_DUE_DAYS = (14, 28)
REWORK_RATE = 0.15

# Consumable counts every one to two weeks; deliveries when stock runs low.
STOCK_COUNT_GAPS = [7, 7, 7, 8, 10, 12, 14, 14]
STOCK_NOTE = f"{TAG} stock count"
DELIVERY_NOTE = f"{TAG} delivery"
JOB_ORDER_NOTE = f"{TAG} job materials"
RESTOCK_ORDER_NOTE = f"{TAG} consumable restock"
# Supplier names as set by `flask load-reference-data`.
RIC = "Railim Industrial Corporation"
STP = "STP Industrial Inc."
RTC = "Raitech Industrial Corporation"
# A former supplier, inactive now; its past orders stay in the history.
SENO = "Seno Metals"
# Consumable restocks rotate across the active suppliers (by code).
CONSUMABLE_SUPPLIER_CODES = ["RIC", "STP", "RTC"]
CONSUMABLE_ON_TIME = 0.88
RNG_SEED = 20260810


ROUTINGS = [
    ["BLANKING", "TEETH_CUTTING", "DRILLING", "KEYWAY", "HEAT_TREATMENT", "CHECKING"],
    ["BLANKING", "TURNING", "FACING", "THREADING", "CHECKING"],
    ["TURNING", "FACING", "SURFACE_GRINDING", "CHECKING"],
    ["TEETH_CUTTING", "SLOTTING", "DRILLING", "CHECKING"],
    ["BLANKING", "GROOVING", "KEYWAY", "HEAT_TREATMENT", "CHECKING"],
    ["SPLINE", "SURFACE_GRINDING", "CHECKING"],
    ["FACING", "DRILLING", "WELDING", "CHECKING"],
    ["TURNING", "THREADING", "CHECKING"],
    ["SLOTTING", "DRILLING", "KEYWAY"],
    ["BLANKING", "TURNING", "SURFACE_GRINDING", "HEAT_TREATMENT", "CHECKING"],
    # Fabrication: cutting on Laser #1, bending on Bending #1.
    ["LAYOUT", "CUTTING", "BENDING", "WELDING", "CHECKING"],
    ["CUTTING", "BENDING", "DRILLING", "CHECKING"],
]

# Open pipeline: Lathe/Milling dominate absolute hours; KEYWAY/SPLINE/DRILLING
# appear often enough that single-unit types become bottlenecks from modest load.
OPEN_PIPELINE_ROUTINGS = [
    # Milling-forward (most absolute hours land here via volume × unit count)
    ["TEETH_CUTTING", "SLOTTING", "GROOVING", "DRILLING", "CHECKING"],
    ["TEETH_CUTTING", "SLOTTING", "GROOVING", "KEYWAY", "CHECKING"],
    ["BLANKING", "TEETH_CUTTING", "SLOTTING", "GROOVING", "CHECKING"],
    ["TEETH_CUTTING", "SLOTTING", "DRILLING", "SPLINE", "CHECKING"],
    ["GROOVING", "SLOTTING", "TEETH_CUTTING", "SURFACE_GRINDING", "CHECKING"],
    ["BLANKING", "TEETH_CUTTING", "SLOTTING", "KEYWAY", "CHECKING"],
    ["TEETH_CUTTING", "SLOTTING", "GROOVING", "DRILLING", "KEYWAY"],
    # Lathe-forward (Blanking / Turning / Facing / Threading)
    ["BLANKING", "TURNING", "FACING", "THREADING", "CHECKING"],
    ["BLANKING", "TURNING", "FACING", "DRILLING", "CHECKING"],
    ["TURNING", "FACING", "THREADING", "KEYWAY", "CHECKING"],
    ["BLANKING", "TURNING", "KEYWAY", "DRILLING", "CHECKING"],
    ["TURNING", "FACING", "TEETH_CUTTING", "SLOTTING", "CHECKING"],
    ["BLANKING", "TURNING", "FACING", "SPLINE", "CHECKING"],
    ["BLANKING", "TURNING", "FACING", "THREADING", "DRILLING"],
    # Fabrication
    ["LAYOUT", "CUTTING", "BENDING", "FITTING", "CHECKING"],
]

JOB_TITLES = [
    "Drive sprocket batch",
    "Shaft blank machining",
    "Coupling modification",
    "Gear blank finish",
    "Bracket repair set",
    "Pulley fabrication",
    "Keyway retrofit",
    "Spindle facing lot",
    "Flange drilling run",
    "Idler gear set",
]

REWORK_REASONS = [
    "Dimensional out of tolerance",
    "Surface finish fail",
    "Thread gauge reject",
    "Keyway width undersize",
    "Heat-treat hardness fail",
]

DOWNTIME_REASONS = [
    ("Spindle bearing noise", DowntimeCategory.MECHANICAL_FAILURE),
    ("Coolant pump failure", DowntimeCategory.MECHANICAL_FAILURE),
    ("Toolchanger jam", DowntimeCategory.MECHANICAL_FAILURE),
    ("Preventive maintenance", DowntimeCategory.SCHEDULED_MAINTENANCE),
    ("Power trip — waiting electrician", DowntimeCategory.ELECTRICAL_FAULT),
]

# Fabrication purchase lines. Names stay fixed so purchasing analytics group them.
# (material_name, grade_or_spec, unit, unit cost PHP range, quantity choices, weight)
MATERIAL_CATALOG = [
    ("AISI 1045 round bar", "Medium carbon steel", "kg", (85, 110), [10, 15, 20, 25, 30, 45, 60], 35),
    ("AISI 4140 round bar", "Pre-hardened alloy steel", "kg", (165, 195), [8, 12, 15, 20, 25, 30, 40], 30),
    ("Aluminium 6061 plate", "6061-T6", "kg", (260, 320), [4, 6, 8, 10, 15], 13),
    ("SKD 11 tool steel", "Cold work die steel, annealed", "kg", (430, 520), [3, 5, 6, 8, 10, 12], 12),
    ("Engineering plastic rod", "POM (acetal)", "kg", (380, 470), [2, 3, 4, 5, 8], 10),
]
LINES_PER_JOB = ([1, 2, 3], [45, 35, 20])

# Weight for secondary lines, price factor, and target share of deliveries on
# time (counted per PO, as the reliability score does).
SUPPLIER_PROFILES = {
    STP: {"weight": 55, "price_factor": 1.00, "on_time": 0.85},
    RIC: {"weight": 30, "price_factor": 0.97, "on_time": 0.70},
    SENO: {"weight": 15, "price_factor": 1.08, "on_time": 0.60},
}
# Primary supplier per fabrication job, in rotation so each supplier gets
# enough deliveries for a reliability score.
PRIMARY_SUPPLIER_ROTATION = [RIC, SENO, STP, RIC, SENO, STP, RIC, SENO]

# Fabrication jobs whose materials arrived after the planned start.
LATE_MATERIAL_SHARE = 0.22
# Which supplier was late on those jobs: fixed proportions.
LATE_SUPPLIER_SHARES = {RIC: 0.50, SENO: 0.35, STP: 0.15}

# Breakdowns, and other stoppages, for late-delivered jobs with no other recorded cause.
BREAKDOWN_REASONS = [
    ("Spindle bearing overheated", DowntimeCategory.MECHANICAL_FAILURE),
    ("Coolant pump failure", DowntimeCategory.MECHANICAL_FAILURE),
    ("Drive motor tripped", DowntimeCategory.ELECTRICAL_FAULT),
]
STOPPAGE_NOTES = [
    "Waiting for client drawing clarification",
    "Waiting for QC sign-off on first piece",
    "Fixture rework before continuing",
]


def _assert_local_db():
    url = os.getenv("DATABASE_URL", "")
    if "localhost" not in url and "127.0.0.1" not in url:
        raise SystemExit(
            f"Refusing to run: DATABASE_URL is not local.\n  got: {url or '(unset)'}"
        )
    if ":5433/" not in url and ":5433?" not in url:
        raise SystemExit(
            f"Refusing to run: expected local port 5433/bmsc.\n  got: {url}"
        )
    print(f"Using DATABASE_URL={url}")


def _hist_jobs_query():
    return JobOrder.query.filter(JobOrder.client_po_number.like(f"{PO_PREFIX}%"))


def _wipe_hist_artifacts(*, commit: bool = True) -> tuple[int, int, int]:
    """Remove HIST-SEED downtimes, calendar rows, and clients with no jobs left."""
    dts = MachineDowntime.query.filter(MachineDowntime.note.like(f"%{TAG}%")).all()
    for row in dts:
        db.session.delete(row)

    cal = WorkCalendarException.query.filter(
        WorkCalendarException.note.like(f"%{TAG}%")
    ).all()
    for row in cal:
        db.session.delete(row)

    clients = Client.query.filter(Client.name.like(f"{TAG}%")).all()
    deleted_clients = 0
    for c in clients:
        if JobOrder.query.filter_by(client_id=c.id).first():
            continue
        NotificationLog.query.filter_by(client_id=c.id).delete(synchronize_session=False)
        db.session.delete(c)
        deleted_clients += 1

    if commit:
        db.session.commit()
    return len(dts), len(cal), deleted_clients


def wipe_history():
    """Remove only HIST-SEED tagged records. Leaves everything else alone."""
    jobs = _hist_jobs_query().all()
    job_ids = [j.id for j in jobs]
    op_count = (
        JobOperation.query.filter(JobOperation.job_order_id.in_(job_ids)).count()
        if job_ids
        else 0
    )
    log_count = (
        OperationTimeLog.query.join(JobOperation)
        .filter(JobOperation.job_order_id.in_(job_ids))
        .count()
        if job_ids
        else 0
    )
    purchase_count = (
        MaterialPurchase.query.filter(MaterialPurchase.job_order_id.in_(job_ids)).count()
        if job_ids
        else 0
    )

    if job_ids:
        NotificationLog.query.filter(
            NotificationLog.job_order_id.in_(job_ids)
        ).delete(synchronize_session=False)
        ToolEvent.query.filter(ToolEvent.job_order_id.in_(job_ids)).update(
            {ToolEvent.job_order_id: None},
            synchronize_session=False,
        )
        ScheduleMove.query.filter(ScheduleMove.job_order_id.in_(job_ids)).delete(
            synchronize_session=False
        )
        invoices = SalesInvoice.query.filter(SalesInvoice.job_order_id.in_(job_ids)).all()
        for inv in invoices:
            print(f"Deleting invoice {inv.invoice_number} on a {TAG} job.")
            db.session.delete(inv)
        db.session.flush()

    # Job → operations → time_logs, and job → material purchases, cascade
    for job in jobs:
        db.session.delete(job)
    db.session.flush()

    counts_n, deliveries_n = _wipe_stock_history()
    orders_n = _wipe_seeded_orders()
    dts_n, cal_n, clients_n = _wipe_hist_artifacts(commit=True)
    print(
        f"Wiped: {len(jobs)} jobs, {op_count} operations, {log_count} time logs, "
        f"{purchase_count} purchase lines, {orders_n} supplier orders, "
        f"{dts_n} downtimes, {cal_n} calendar exceptions, {clients_n} clients, "
        f"{counts_n} stock counts, {deliveries_n} consumable deliveries."
    )


def _wipe_seeded_orders() -> int:
    """HIST-SEED supplier orders and their remaining (consumable restock) lines;
    job material lines already went with their jobs."""
    orders = SupplierOrder.query.filter(SupplierOrder.notes.like(f"{TAG}%")).all()
    ids = [o.id for o in orders]
    if ids:
        line_ids = [
            lid
            for (lid,) in db.session.query(MaterialPurchase.id)
            .filter(MaterialPurchase.supplier_order_id.in_(ids))
            .all()
        ]
        if line_ids:
            ToolEvent.query.filter(ToolEvent.material_purchase_id.in_(line_ids)).update(
                {ToolEvent.material_purchase_id: None}, synchronize_session=False
            )
            MaterialPurchase.query.filter(MaterialPurchase.id.in_(line_ids)).delete(
                synchronize_session=False
            )
        SupplierOrder.query.filter(SupplierOrder.id.in_(ids)).delete(synchronize_session=False)
        db.session.flush()
    return len(ids)


def _load_catalog():
    op_types = {ot.code: ot for ot in OperationType.query.filter_by(active=True).all()}
    machines = {mt.code: mt for mt in MachineType.query.all()}
    units_by_type = defaultdict(list)
    for u in MachineUnit.query.filter_by(active=True).all():
        mt = next((m for m in machines.values() if m.id == u.machine_type_id), None)
        if mt:
            units_by_type[mt.code].append(u)

    workers = (
        User.query.filter_by(role=UserRole.PRODUCTION_WORKER, active=True)
        .order_by(User.full_name)
        .all()
    )
    skills = WorkerSkill.query.all()
    worker_machine_codes = defaultdict(set)
    machine_workers = defaultdict(list)
    code_by_id = {mt.id: mt.code for mt in machines.values()}
    for sk in skills:
        code = code_by_id.get(sk.machine_type_id)
        if not code:
            continue
        worker_machine_codes[sk.worker_id].add(code)
        machine_workers[code].append(sk.worker_id)

    admin = User.query.filter_by(role=UserRole.ADMIN).first()
    office = User.query.filter_by(role=UserRole.OFFICE_STAFF).first()
    creator = office or admin
    if not creator:
        raise SystemExit("No Admin/Office user found. Run flask seed first.")

    return {
        "op_types": op_types,
        "machines": machines,
        "units_by_type": units_by_type,
        "workers": workers,
        "worker_ids": [w.id for w in workers],
        "worker_by_id": {w.id: w for w in workers},
        "worker_machine_codes": worker_machine_codes,
        "machine_workers": machine_workers,
        "creator": creator,
    }


def _assert_skill_coverage(catalog):
    """Stop if any machine type used by routings has no skilled worker."""
    machines = catalog["machines"]
    op_types = catalog["op_types"]
    machine_workers = catalog["machine_workers"]
    missing = []
    used_machine_codes = set()
    for route in list(ROUTINGS) + list(OPEN_PIPELINE_ROUTINGS):
        for code in route:
            ot = op_types[code]
            if not ot.default_machine_type_id:
                continue
            mt = next(
                (m for m in machines.values() if m.id == ot.default_machine_type_id),
                None,
            )
            if mt:
                used_machine_codes.add(mt.code)

    for code in sorted(used_machine_codes):
        if not machine_workers.get(code):
            missing.append(code)

    if missing:
        raise SystemExit(
            "Skill coverage too thin — no workers skilled for: "
            + ", ".join(missing)
            + "\nRefusing to assign unqualified workers. Add WorkerSkill rows and retry."
        )
    print(f"Skill coverage OK for machine types: {', '.join(sorted(used_machine_codes))}")


def _build_worker_tendencies(catalog, rng: random.Random):
    """
    Per-(worker, machine) multipliers so efficiency charts show real differences.
    <1 faster than estimate, >1 slower.
    """
    tendencies = {}
    # Named demo workers get strong, consistent biases.
    name_bias = {
        "Juan Dela Cruz": {"LATHE": 0.82, "MILLING": 0.95, "DRILLING": 0.90},
        "Ana Lopez": {"LATHE": 0.78, "DRILLING": 0.88},
        "Maria Santos": {"MILLING": 1.28, "GRINDING": 1.10},
        "Pedro Reyes": {"MILLING": 1.18, "GRINDING": 1.05},
        "Seed Worker 11": {"MILLING": 0.80},
        "Seed Worker 12": {"LATHE": 1.32},
        "Seed Worker 13": {"GRINDING": 0.85},
        "Seed Worker 14": {"SHAPER": 0.88, "MILLING": 1.12},
        "Seed Worker 07": {"SHAPER": 1.25, "GRINDING": 1.15},
        "Seed Worker 10": {"DRILLING": 0.84, "LATHE": 1.08},
    }
    for w in catalog["workers"]:
        biases = name_bias.get(w.full_name, {})
        for code in catalog["worker_machine_codes"].get(w.id, ()):
            if code in biases:
                tendencies[(w.id, code)] = biases[code]
            else:
                # Stable per-worker base with small machine jitter
                base = rng.uniform(0.88, 1.18)
                tendencies[(w.id, code)] = round(base, 3)
        # No-machine ops (heat treat / check / weld)
        tendencies[(w.id, None)] = round(rng.uniform(0.92, 1.08), 3)
    return tendencies


def _pick_worker(catalog, machine_code, rng: random.Random):
    if machine_code is None:
        return rng.choice(catalog["worker_ids"])
    candidates = catalog["machine_workers"].get(machine_code) or []
    if not candidates:
        return None
    return rng.choice(candidates)


def _pick_unit(catalog, machine_code, rng: random.Random):
    if not machine_code:
        return None
    units = catalog["units_by_type"].get(machine_code) or []
    if not units:
        return None
    return rng.choice(units)


def _sample_variance_bucket(rng: random.Random) -> float:
    """Target ratio of actual/estimate before worker tendency. ~25/45/30 split."""
    roll = rng.random()
    if roll < 0.25:
        return rng.uniform(0.70, 0.90)  # under
    if roll < 0.70:
        return rng.uniform(0.90, 1.10)  # near
    return rng.uniform(1.10, 1.45)  # over


def _working_days_between(start: date, end: date):
    """Mon–Sat inclusive."""
    days = []
    d = start
    while d <= end:
        if d.weekday() < 6:  # 0=Mon .. 5=Sat
            days.append(d)
        d += timedelta(days=1)
    return days


def _add_work_minutes(day: date, start_t: time, minutes: float, allow_ot: bool):
    """
    Advance shop-local clock by `minutes` of work, pausing overnight at 17:00
    (or 19:00 if OT). Returns list of (segment_start_utc, segment_end_utc) and
    whether an overnight END_OF_SHIFT pause was needed.
    """
    segments = []
    remaining = minutes
    cur_day = day
    cur_t = start_t
    used_overnight = False
    day_end = time(19, 0) if allow_ot else time(17, 0)
    day_start = time(8, 0)

    guard = 0
    while remaining > 0.5 and guard < 14:
        guard += 1
        # Skip Sunday
        while cur_day.weekday() == 6:
            cur_day += timedelta(days=1)
            cur_t = day_start

        end_limit = datetime.combine(cur_day, day_end)
        cur_dt = datetime.combine(cur_day, cur_t)
        if cur_dt >= end_limit:
            cur_day += timedelta(days=1)
            cur_t = day_start
            used_overnight = True
            continue

        available_min = (end_limit - cur_dt).total_seconds() / 60.0
        take = min(remaining, available_min)
        seg_end_dt = cur_dt + timedelta(minutes=take)
        segments.append(
            (
                shop_local_to_utc(cur_day, cur_t),
                shop_local_to_utc(seg_end_dt.date(), seg_end_dt.time()),
            )
        )
        remaining -= take
        if remaining > 0.5:
            cur_day = seg_end_dt.date() + timedelta(days=1)
            cur_t = day_start
            used_overnight = True
            # If we ended exactly at day_end same day, still overnight
        else:
            cur_t = seg_end_dt.time()
            cur_day = seg_end_dt.date()

    return segments, used_overnight


def _append_log(op, worker_id, event, event_at, reason=None, note=None):
    db.session.add(
        OperationTimeLog(
            operation_id=op.id,
            worker_id=worker_id,
            event=event,
            event_at=event_at,
            reason=reason,
            note=note,
        )
    )


def _seed_outsourced_op(job, seq, ot, job_status, n_ops, cursor_day, rng):
    """Outsourced work: sent out on cursor_day, back after the turnaround (late
    now and then). No worker, machine, target hours or time log."""
    turnaround = ot.default_turnaround_days or 3
    if job_status == JobOrderStatus.SCHEDULED:
        op_status = OperationStatus.PENDING
    elif job_status == JobOrderStatus.IN_PROGRESS:
        complete_through = max(1, n_ops // 3)
        if seq <= complete_through:
            op_status = OperationStatus.COMPLETED
        elif seq == complete_through + 1:
            op_status = OperationStatus.IN_PROGRESS
        else:
            op_status = OperationStatus.PENDING
    else:
        op_status = OperationStatus.COMPLETED

    op = JobOperation(
        job_order_id=job.id,
        sequence_no=seq,
        operation_name=ot.name,
        operation_type_id=ot.id,
        turnaround_days=turnaround,
        status=op_status,
        notes=TAG,
    )
    if op_status in (OperationStatus.COMPLETED, OperationStatus.IN_PROGRESS):
        op.sent_out_date = cursor_day
        op.sent_to = rng.choice(OUTSOURCE_SHOPS)
        op.actual_start = shop_local_to_utc(cursor_day, time(8, 0))
        op.scheduled_start = op.actual_start
        op.scheduled_end = op.actual_start + timedelta(days=turnaround)
    if op_status == OperationStatus.COMPLETED:
        late_days = rng.choice([0, 0, 0, 0, 1, 2])
        back = cursor_day + timedelta(days=turnaround + late_days)
        op.returned_date = back
        op.actual_end = shop_local_to_utc(back, time(17, 0))
        cursor_day = back + timedelta(days=1)
    db.session.add(op)
    db.session.flush()
    return op, cursor_day


OUTSOURCE_SHOPS = ["Metro Heat Treating", "Valenzuela Hardening Works", "Cavite Thermal Services"]


def _build_time_chain(
    op,
    worker_id,
    start_day: date,
    start_t: time,
    target_hours: float,
    rng: random.Random,
    complete: bool,
):
    """
    Write START / optional PAUSE+RESUME / COMPLETE logs whose worked intervals
    sum to approximately target_hours. Uses overnight END_OF_SHIFT when needed.
    """
    allow_ot = rng.random() < 0.08
    use_break = complete and target_hours >= 3.0 and rng.random() < 0.45
    minutes = max(20.0, target_hours * 60.0)

    if use_break:
        first = minutes * rng.uniform(0.35, 0.55)
        second = minutes - first
        segs1, _ = _add_work_minutes(start_day, start_t, first, allow_ot)
        if not segs1:
            return
        # START
        _append_log(op, worker_id, OperationTimeEvent.START, segs1[0][0])
        # Work first chunk; if overnight inside first chunk, emit END_OF_SHIFT pauses
        _emit_segments_with_shifts(op, worker_id, segs1, starting_event_done=True)

        # Mid-job BREAK after first chunk end
        pause_at = segs1[-1][1]
        break_mins = rng.choice([15, 20, 30, 45])
        resume_at = pause_at + timedelta(minutes=break_mins)
        _append_log(
            op,
            worker_id,
            OperationTimeEvent.PAUSE,
            pause_at,
            reason=OperationPauseReason.BREAK,
        )
        resume_shop = resume_at.astimezone(ZoneInfo("Asia/Manila"))
        segs2, _ = _add_work_minutes(
            resume_shop.date(),
            resume_shop.time().replace(microsecond=0),
            second,
            allow_ot,
        )
        if segs2:
            _append_log(op, worker_id, OperationTimeEvent.RESUME, segs2[0][0])
            last_end = _emit_segments_with_shifts(
                op, worker_id, segs2, starting_event_done=True
            )
        else:
            last_end = pause_at

        if complete and last_end:
            _append_log(op, worker_id, OperationTimeEvent.COMPLETE, last_end)
            op.actual_end = last_end
        op.actual_start = segs1[0][0]
        return

    segs, _ = _add_work_minutes(start_day, start_t, minutes, allow_ot)
    if not segs:
        return
    _append_log(op, worker_id, OperationTimeEvent.START, segs[0][0])
    op.actual_start = segs[0][0]
    last_end = _emit_segments_with_shifts(
        op, worker_id, segs, starting_event_done=True
    )
    if complete and last_end:
        _append_log(op, worker_id, OperationTimeEvent.COMPLETE, last_end)
        op.actual_end = last_end
    elif not complete and last_end and rng.random() < 0.4:
        # Leave in-progress paused overnight
        _append_log(
            op,
            worker_id,
            OperationTimeEvent.PAUSE,
            last_end,
            reason=OperationPauseReason.END_OF_SHIFT,
        )


def _emit_segments_with_shifts(op, worker_id, segments, starting_event_done=False):
    """
    Given contiguous worked segments separated by overnight gaps, emit
    PAUSE(END_OF_SHIFT)/RESUME between them. Assumes START already written
    for segments[0][0] when starting_event_done.
    Returns last segment end utc.
    """
    if not segments:
        return None
    last_end = segments[0][1]
    for i in range(1, len(segments)):
        # Close previous day
        _append_log(
            op,
            worker_id,
            OperationTimeEvent.PAUSE,
            segments[i - 1][1],
            reason=OperationPauseReason.END_OF_SHIFT,
            note=f"{TAG} overnight",
        )
        _append_log(
            op,
            worker_id,
            OperationTimeEvent.RESUME,
            segments[i][0],
        )
        last_end = segments[i][1]
    return last_end


def _ensure_clients():
    """Create or reuse the six HIST-SEED clients. Returns list aligned with CLIENT_PROFILES."""
    clients = []
    for profile in CLIENT_PROFILES:
        name = _client_seed_name(profile["display"])
        client = Client.query.filter_by(name=name).first()
        if not client:
            client = Client(name=name, contact=f"{profile['key']}@hist-seed.local")
            db.session.add(client)
            db.session.flush()
        clients.append(client)
    return clients


def _job_slots_for_clients(clients, rng: random.Random, total: int):
    """Shuffled list of (client, profile_meta) of length ``total``, split by the
    CLIENT_PROFILES weights."""
    weight_sum = sum(p["jobs"] for p in CLIENT_PROFILES)
    quotas = _quotas(total, {p["key"]: p["jobs"] / weight_sum for p in CLIENT_PROFILES})
    slots = []
    for client, profile in zip(clients, CLIENT_PROFILES):
        for _ in range(quotas[profile["key"]]):
            slots.append((client, profile))
    rng.shuffle(slots)
    return slots


def _next_month(d: date) -> date:
    return (d.replace(day=28) + timedelta(days=4)).replace(day=1)


def _history_months(today: date) -> list[date]:
    """First days of the HISTORY_MONTHS complete months before today's month."""
    m = today.replace(day=1)
    out = []
    for _ in range(HISTORY_MONTHS):
        m = (m - timedelta(days=1)).replace(day=1)
        out.append(m)
    return sorted(out)


def _monthly_job_counts(n: int, rng: random.Random) -> list[int]:
    """A seasonal swing plus noise, kept within JOBS_PER_MONTH."""
    lo, hi = JOBS_PER_MONTH
    phase = rng.uniform(0, 2 * math.pi)
    counts = []
    for i in range(n):
        level = (lo + hi) / 2 + 1.6 * math.sin(2 * math.pi * i / 12 + phase)
        level += rng.choice([-1, -1, 0, 0, 0, 1, 1, 2])
        counts.append(max(lo, min(hi, round(level))))
    return counts


def _job_dates(today: date, rng: random.Random):
    """[(po_date, job_day, open)] sorted by job_day, and the planned count per month.

    The last BACKLOG_DAYS hold the open backlog; a month that overlaps it counts
    those jobs toward its planned total, and jobs received in the SLOWDOWN_DAYS
    before it start progressively later. The first month starts mid-month:
    material orders can pull a fabrication job's PO date up to two weeks
    earlier, and that must stay in the same month.
    """
    months = _history_months(today)
    counts = _monthly_job_counts(len(months), rng)
    backlog_start = today - timedelta(days=BACKLOG_DAYS)
    backlog_days = _working_days_between(backlog_start, today - timedelta(days=1))
    backlog = rng.sample(backlog_days, min(len(backlog_days), rng.randint(*BACKLOG_JOBS)))
    in_month = defaultdict(int)
    for po in backlog:
        in_month[f"{po:%Y-%m}"] += 1

    dated = [(po, True) for po in backlog]
    planned = {}
    for i, (m, n) in enumerate(zip(months, counts)):
        key = f"{m:%Y-%m}"
        start = m.replace(day=16) if i == 0 else m
        end = min(_next_month(m), backlog_start) - timedelta(days=1)
        days = _working_days_between(start, end) if end >= start else []
        floor = MIN_JOBS_BEFORE_BACKLOG if in_month[key] else 0
        k = min(max(floor, n - in_month[key]), len(days))
        dated.extend((po, False) for po in rng.sample(days, k))
        planned[key] = max(n, k + in_month[key])
    if today.day > 1:
        planned[f"{today:%Y-%m}"] = in_month[f"{today:%Y-%m}"]

    rows = []
    for po, is_open in dated:
        # Backlog jobs start once material can arrive, so orders follow the PO.
        job_day = po + timedelta(days=rng.randint(*((6, 9) if is_open else (1, 3))))
        if not is_open:
            ramp = min(1.0, 2 * (1 - (backlog_start - po).days / SLOWDOWN_DAYS))
            if ramp > 0:
                job_day += timedelta(days=round(ramp * rng.uniform(*SLOWDOWN_WAIT)))
            job_day = min(job_day, today - timedelta(days=7))
        if job_day.weekday() == 6:
            job_day += timedelta(days=1)
        rows.append((po, min(job_day, today), is_open))
    rows.sort(key=lambda r: (r[1], r[0]))
    return rows, planned


def _job_type_mix_for_profile(profile_kind: str, rng: random.Random):
    """
    Construction → mostly FABRICATION.
    Manufacturing → MODIFICATION / REPAIR on client-supplied items.
    Mixed → balanced.
    Returns (job_type, part_condition).
    """
    roll = rng.random()
    if profile_kind == "construction":
        if roll < 0.90:
            return JobType.FABRICATION, PartCondition.RAW_MATERIAL
        if roll < 0.96:
            return JobType.MODIFICATION, PartCondition.CLIENT_SUPPLIED_ITEM
        return JobType.REPAIR, PartCondition.CLIENT_SUPPLIED_ITEM
    if profile_kind == "manufacturing":
        if roll < 0.40:
            return JobType.MODIFICATION, PartCondition.CLIENT_SUPPLIED_ITEM
        if roll < 0.60:
            return JobType.REPAIR, PartCondition.CLIENT_SUPPLIED_ITEM
        return JobType.FABRICATION, PartCondition.RAW_MATERIAL
    # mixed
    if roll < 0.65:
        return JobType.FABRICATION, PartCondition.RAW_MATERIAL
    if roll < 0.85:
        return JobType.MODIFICATION, PartCondition.CLIENT_SUPPLIED_ITEM
    return JobType.REPAIR, PartCondition.CLIENT_SUPPLIED_ITEM


def _amount_for_profile(profile_kind: str, rng: random.Random) -> Decimal:
    """Construction jobs skew larger; manufacturing mid-range; mixed between."""
    if profile_kind == "construction":
        # 40k–95k in 1k steps
        return Decimal(str(rng.randint(40, 95) * 1000))
    if profile_kind == "manufacturing":
        return Decimal(str(rng.randint(8, 55) * 1000))
    return Decimal(str(rng.randint(15, 70) * 1000))


def _load_suppliers() -> dict:
    """Material suppliers by name: RIC and STP from the reference loader, and
    Seno Metals (inactive, kept for its past orders), created if missing."""
    from app.seed.seed_data import _ensure_suppliers

    by_name = {s.name: s for s in _ensure_suppliers()}
    seno = Supplier.query.filter(db.func.lower(Supplier.name) == SENO.lower()).first()
    if seno is None:
        seno = Supplier(
            name=SENO,
            typical_lead_time_days=1,
            notes="One day after order",
            active=False,
            is_seed=True,
        )
        db.session.add(seno)
        db.session.flush()
    by_name[SENO] = seno
    return {name: by_name[name] for name in SUPPLIER_PROFILES}


def _pick_supplier_name(rng: random.Random) -> str:
    names = list(SUPPLIER_PROFILES)
    return rng.choices(names, weights=[SUPPLIER_PROFILES[n]["weight"] for n in names])[0]


def _pick_materials(rng: random.Random) -> list:
    k = rng.choices(*LINES_PER_JOB)[0]
    pool = list(MATERIAL_CATALOG)
    picks = []
    for _ in range(k):
        choice = rng.choices(pool, weights=[m[5] for m in pool])[0]
        picks.append(choice)
        pool.remove(choice)
    return picks


def _skip_sunday_back(d: date) -> date:
    return d - timedelta(days=1) if d.weekday() == 6 else d


def _add_purchase_lines(
    job,
    ops,
    suppliers: dict,
    today: date,
    rng: random.Random,
    primary: str,
) -> list:
    """
    One to three purchase lines for a fabrication job, mostly from ``primary``.
    Started jobs consume them at the first operation's start. Delivery dates are
    set afterwards by _shape_deliveries.
    """
    materials = _pick_materials(rng)
    line_suppliers = [primary] + [
        _pick_supplier_name(rng) if rng.random() < 0.25 else primary
        for _ in materials[1:]
    ]
    starts = [o.actual_start for o in ops if o.actual_start]
    first_start = min(starts) if starts else None
    if first_start:
        first_day = first_start.astimezone(ZoneInfo("Asia/Manila")).date()
        longest = max(suppliers[n].typical_lead_time_days or 1 for n in line_suppliers)
        order_day = first_day - timedelta(days=longest + rng.choice([0, 0, 1, 1, 2]))
    else:
        order_day = job.created_at.astimezone(ZoneInfo("Asia/Manila")).date()
    order_day = _skip_sunday_back(min(order_day, today))

    lines = []
    for (name, spec, unit, (lo, hi), qtys, _w), supplier_name in zip(materials, line_suppliers):
        factor = SUPPLIER_PROFILES[supplier_name]["price_factor"]
        cost = Decimal(str(round(rng.uniform(lo, hi) * factor, 2)))
        line = MaterialPurchase(
            material_name=name,
            grade_or_spec=spec,
            quantity=Decimal(str(rng.choice(qtys))),
            unit=unit,
            unit_cost=cost,
            supplier_id=suppliers[supplier_name].id,
            date_ordered=order_day,
            date_received=None,
            consumed_at=first_start,
        )
        job.material_purchases.append(line)
        lines.append(line)

    job.supplier_id = suppliers[primary].id
    db.session.flush()
    return lines


def _shop_day(dt) -> date:
    return dt.astimezone(ZoneInfo("Asia/Manila")).date()


def _quotas(total: int, shares: dict) -> dict:
    """Split ``total`` by ``shares`` with the largest-remainder method."""
    raw = {k: total * v for k, v in shares.items()}
    out = {k: int(v) for k, v in raw.items()}
    leftover = total - sum(out.values())
    for k in sorted(raw, key=lambda k: raw[k] - out[k], reverse=True)[:leftover]:
        out[k] += 1
    return out


def _pick_late_material_jobs(fab_jobs, first_start_by_job, suppliers, rng) -> dict:
    """Started fabrication jobs whose materials arrived after the planned start,
    with the late supplier assigned in LATE_SUPPLIER_SHARES proportions.
    Returns {job id: supplier name}."""
    started = [j for j in fab_jobs if first_start_by_job.get(j.id)]
    base = max(1, round(len(fab_jobs) * LATE_MATERIAL_SHARE))

    def split_error(n):
        q = _quotas(n, LATE_SUPPLIER_SHARES)
        return sum(abs(q[k] / n - s) for k, s in LATE_SUPPLIER_SHARES.items())

    total = min(
        len(started),
        min(range(max(1, base - 1), base + 2), key=lambda n: (split_error(n), abs(n - base))),
    )
    chosen = {}
    for name, k in _quotas(total, LATE_SUPPLIER_SHARES).items():
        sid = suppliers[name].id
        free = [j for j in started if j.id not in chosen]
        pool = [j for j in free if j.supplier_id == sid]
        pool += [j for j in free if j not in pool and any(p.supplier_id == sid for p in j.material_purchases)]
        pool += [j for j in free if j not in pool]
        if len(pool) > k:
            primary_pool = [j for j in pool if j.supplier_id == sid]
            pick = rng.sample(primary_pool, k) if len(primary_pool) >= k else pool[:k]
        else:
            pick = pool
        for job in pick:
            chosen[job.id] = name
    return chosen


def _apply_late_material(job, supplier, first_start, rng):
    """That supplier's lines arrived 3-8 days after the promised date, on or just
    before the first operation's start day. Returns (order day, arrival)."""
    group = [p for p in job.material_purchases if p.supplier_id == supplier.id]
    if not group:
        group = [job.material_purchases[0]]
        group[0].supplier_id = supplier.id
    stated = supplier.typical_lead_time_days or 1
    arrival = _shop_day(first_start) - timedelta(days=rng.choice([0, 0, 1]))
    if arrival.weekday() == 6:
        arrival -= timedelta(days=1)
    order_day = _skip_sunday_back(arrival - timedelta(days=stated + rng.randint(3, 8)))
    for p in group:
        p.date_ordered = order_day
        p.date_received = arrival
    return order_day, arrival


def _shape_deliveries(fab_jobs, first_start_by_job, suppliers, late_material, today, rng):
    """
    Set each (job, supplier) delivery on time or late so every supplier lands near
    its SUPPLIER_PROFILES on-time share. Each group becomes one PO, so reliability
    counts it once. Late-material deliveries already count late.

    Started jobs: every delivery lands on or before the first operation's start day
    (the start gate requires it). Not-started jobs: ordered on the job day; a
    delivery not promised yet stays on order, a late one is received by today.
    """
    by_id = {s.id: s for s in suppliers.values()}
    due = defaultdict(int)
    late = defaultdict(int)
    groups = []
    for job in fab_jobs:
        per_supplier = defaultdict(list)
        for p in job.material_purchases:
            per_supplier[p.supplier_id].append(p)
        for sid, lines in per_supplier.items():
            if late_material.get(job.id) == by_id[sid].name:
                due[sid] += 1
                late[sid] += 1
            else:
                groups.append((job, by_id[sid], lines))
    groups.sort(key=lambda g: (g[2][0].date_ordered, g[0].created_at))

    for job, supplier, lines in groups:
        stated = supplier.typical_lead_time_days or 1
        n = 1
        target_late = 1 - SUPPLIER_PROFILES[supplier.name]["on_time"]
        make_late = late[supplier.id] + n / 2 < target_late * (due[supplier.id] + n)
        first_start = first_start_by_job.get(job.id)
        if first_start:
            first_day = _shop_day(first_start)
            days_late = rng.randint(1, 3) if make_late else 0
            buffer_days = rng.choice([0, 0, 1, 1, 2])
            order_day = _skip_sunday_back(
                min(first_day - timedelta(days=stated + days_late + buffer_days), today)
            )
            if (order_day + timedelta(days=stated)).weekday() == 6:
                order_day = _skip_sunday_back(order_day - timedelta(days=1))
            promised = order_day + timedelta(days=stated)
            if make_late:
                received = promised + timedelta(days=days_late)
            else:
                received = promised - timedelta(days=rng.choice([0, 0, 0, 1]))
                received = max(received, order_day)
        else:
            order_day = lines[0].date_ordered
            promised = order_day + timedelta(days=stated)
            if promised >= today:
                for p in lines:
                    p.date_received = None
                continue
            if make_late:
                received = min(promised + timedelta(days=rng.randint(1, 3)), today)
            else:
                received = max(promised - timedelta(days=rng.choice([0, 0, 0, 1])), order_day)
        if received.weekday() == 6:
            step = 1 if received > promised and received - timedelta(days=1) <= promised else -1
            received += timedelta(days=step)
        if received <= order_day:
            received = order_day + timedelta(days=1)
            if received.weekday() == 6:
                received += timedelta(days=1)
        received = min(received, first_day if first_start else today)
        for p in lines:
            p.date_ordered = order_day
            p.date_received = received
        due[supplier.id] += n
        if received > promised:
            late[supplier.id] += n


def _finish_job_materials(job, suppliers):
    """Job dates and material status follow the final order and delivery dates."""
    lines = list(job.material_purchases)
    if not lines:
        return
    first_order = min(p.date_ordered for p in lines)
    order_created = shop_local_to_utc(first_order, time(7, 30))
    if job.created_at > order_created:
        job.created_at = order_created
    if job.po_date and job.po_date > first_order:
        job.po_date = first_order
    primary = next(s for s in suppliers.values() if s.id == job.supplier_id)
    primary_order = min(p.date_ordered for p in lines if p.supplier_id == primary.id) if any(
        p.supplier_id == primary.id for p in lines
    ) else first_order
    job.material_expected_date = primary_order + timedelta(
        days=primary.typical_lead_time_days or 1
    )
    db.session.flush()
    sync_job_material_from_purchases(job)


def _settle_purchases(fab_jobs, first_start_by_job, suppliers, today, rng) -> dict:
    """Late-material jobs, final delivery dates, and job material status.
    Returns {job id: late supplier name}."""
    late_material = _pick_late_material_jobs(fab_jobs, first_start_by_job, suppliers, rng)
    late_arrivals = {}
    for job in fab_jobs:
        name = late_material.get(job.id)
        if name:
            late_arrivals[job.id] = _apply_late_material(
                job, suppliers[name], first_start_by_job[job.id], rng
            )
    _shape_deliveries(fab_jobs, first_start_by_job, suppliers, late_material, today, rng)
    for job in fab_jobs:
        _finish_job_materials(job, suppliers)
        if job.id in late_arrivals:
            order_day, arrival = late_arrivals[job.id]
            _record_late_material(
                job, suppliers[late_material[job.id]], order_day, arrival,
                first_start_by_job[job.id],
            )
    return late_material


def _seeded_order(supplier, issued: date, creator, note: str) -> SupplierOrder:
    """An issued PO (numbered later by _number_seeded_orders)."""
    order = SupplierOrder(
        supplier_id=supplier.id,
        status=SupplierOrderStatus.ISSUED,
        date_issued=issued,
        expected_delivery_date=next_shop_working_day(
            issued + timedelta(days=supplier.typical_lead_time_days or 1)
        ),
        notes=note,
        prepared_by_id=creator.id,
        issued_by_id=creator.id,
        created_at=shop_local_to_utc(issued, time(8, 0)),
    )
    db.session.add(order)
    return order


def _create_job_material_orders(fab_jobs, suppliers, creator) -> int:
    """One PO per (job, supplier) delivery group, issued on its order day."""
    by_id = {s.id: s for s in suppliers.values()}
    n = 0
    for job in fab_jobs:
        per_supplier = defaultdict(list)
        for p in job.material_purchases:
            per_supplier[p.supplier_id].append(p)
        for sid, lines in per_supplier.items():
            issued = min(p.date_ordered for p in lines)
            order = _seeded_order(by_id[sid], issued, creator, JOB_ORDER_NOTE)
            _receive_whole(lines)
            for p in lines:
                p.date_ordered = issued
                p.supplier_order = order
            recompute_order_status(order)
            n += 1
        db.session.flush()
        sync_job_material_from_purchases(job)
    db.session.flush()
    return n


def _receive_whole(lines):
    """Deliveries arrive complete: every line on an order shares one received
    date (the last line's), or none while any line is still awaited."""
    received = [p.date_received for p in lines if p.date_received]
    if received and (len(received) == len(lines) or any(p.consumed_at for p in lines)):
        arrived = max(received)
        for p in lines:
            p.date_received = arrived
    else:
        for p in lines:
            p.date_received = None


def _number_seeded_orders() -> int:
    """PO numbers in issue-date order: supplier code + year + sequence per
    supplier per year (STP26000001), after any existing number. Seno Metals
    has no code, so its past orders keep the earlier shop-wide format."""
    orders = (
        SupplierOrder.query.filter(
            SupplierOrder.notes.like(f"{TAG}%"), SupplierOrder.po_seq.is_(None)
        )
        .order_by(SupplierOrder.date_issued, SupplierOrder.created_at)
        .all()
    )
    legacy_seq = (
        db.session.query(db.func.max(SupplierOrder.po_seq))
        .filter(SupplierOrder.po_year.is_(None))
        .scalar()
        or 0
    )
    next_seq = {}
    for order in orders:
        code = order.supplier.code if order.supplier else None
        if not code:
            legacy_seq += 1
            order.po_seq = legacy_seq
            order.po_number = format_legacy_po_number(legacy_seq)
            continue
        year = order.date_issued.year
        key = (order.supplier_id, year)
        if key not in next_seq:
            next_seq[key] = (
                db.session.query(db.func.max(SupplierOrder.po_seq))
                .filter(SupplierOrder.supplier_id == order.supplier_id, SupplierOrder.po_year == year)
                .scalar()
                or 0
            )
        next_seq[key] += 1
        order.po_seq = next_seq[key]
        order.po_year = year
        order.po_number = format_po_number(code, year, next_seq[key])
    db.session.flush()
    return len(orders)


def _longest_stretch(job, needs_unit: bool):
    """(op, start, end, worker id) of the longest worked stretch on the job's
    completed operations, or None."""
    best = None
    for op in job.operations:
        if op.status != OperationStatus.COMPLETED:
            continue
        if needs_unit and not op.machine_unit_id:
            continue
        logs = (
            OperationTimeLog.query.filter_by(operation_id=op.id)
            .order_by(OperationTimeLog.event_at)
            .all()
        )
        open_at = None
        for log in logs:
            if log.event in (OperationTimeEvent.START, OperationTimeEvent.RESUME):
                open_at = log.event_at
            elif log.event in (OperationTimeEvent.PAUSE, OperationTimeEvent.COMPLETE) and open_at:
                if best is None or log.event_at - open_at > best[2] - best[1]:
                    best = (op, open_at, log.event_at, logs[0].worker_id)
                open_at = None
    return best


def _can_explain_late(job, late_material) -> bool:
    """A late delivery on this job would have a cause: late material, redo,
    time over target, or a stretch long enough to place a stoppage."""
    if job.id in late_material:
        return True
    if any(o.rework_of_operation_id and o.status == OperationStatus.COMPLETED for o in job.operations):
        return True
    if ran_over_target(job.operations)[0] > 0:
        return True
    best = _longest_stretch(job, needs_unit=False)
    return best is not None and best[2] - best[1] >= timedelta(hours=1)


def _add_stoppage(job, breakdown: bool, reported_by_id, rng) -> str | None:
    """Pause one completed operation inside its longest worked stretch: a machine
    breakdown (with a downtime record linked to the job) or another stoppage.
    Returns the cause added, or None when no stretch is long enough."""
    best = _longest_stretch(job, needs_unit=breakdown)
    if best is None or best[2] - best[1] < timedelta(hours=1):
        return _add_stoppage(job, False, reported_by_id, rng) if breakdown else None

    op, seg_start, seg_end, worker_id = best
    length = seg_end - seg_start
    pause_at = (seg_start + length * 0.4).replace(second=0, microsecond=0)
    duration = min(max(length * 0.35, timedelta(minutes=30)), timedelta(hours=3))
    resume_at = pause_at + duration
    if breakdown:
        reason_text, category = rng.choice(BREAKDOWN_REASONS)
        _append_log(op, worker_id, OperationTimeEvent.PAUSE, pause_at,
                    reason=OperationPauseReason.MACHINE_DOWN, note=f"{TAG} {reason_text}")
        db.session.add(
            MachineDowntime(
                machine_unit_id=op.machine_unit_id,
                started_at=pause_at,
                ended_at=resume_at,
                category=category,
                reason=reason_text,
                reported_by_id=reported_by_id,
                job_order_id=job.id,
                operation_id=op.id,
                note=f"{TAG} breakdown during {op.operation_name}",
            )
        )
    else:
        _append_log(op, worker_id, OperationTimeEvent.PAUSE, pause_at,
                    reason=OperationPauseReason.OTHER, note=f"{TAG} {rng.choice(STOPPAGE_NOTES)}")
    _append_log(op, worker_id, OperationTimeEvent.RESUME, resume_at)
    db.session.flush()
    db.session.refresh(op)
    recompute_variance(op)
    return "breakdown" if breakdown else "pause"


def _record_late_material(job, supplier, order_day: date, arrived: date, first_start):
    """The job had been planned to start the day after the promised delivery;
    the late delivery pushed the first operation to after it arrived."""
    promised = order_day + timedelta(days=supplier.typical_lead_time_days or 1)
    planned_day = promised + timedelta(days=1)
    while planned_day.weekday() == 6:
        planned_day += timedelta(days=1)
    planned_start = shop_local_to_utc(planned_day, time(8, 0))
    if planned_start >= first_start or planned_day >= arrived:
        return
    reason = (
        f"Late delivery: first operation moved from {planned_day:%d %b %Y} 08:00 to "
        f"{first_start.astimezone(ZoneInfo('Asia/Manila')):%d %b %Y %H:%M} "
        f"(material from {supplier.name} promised {promised.isoformat()}, "
        f"arrived {arrived.isoformat()}) [{TAG}]"
    )
    moved_at = shop_local_to_utc(promised, time(17, 0))
    db.session.add(
        ScheduleMove(
            job_order_id=job.id,
            kind=DelayKind.MATERIAL,
            material_cause=MaterialCause.SUPPLIER_LATE,
            previous_start=planned_start,
            new_start=first_start,
            reason=reason,
            supplier_id=supplier.id,
            moved_at=moved_at,
        )
    )
    job.material_delay_original_start = planned_start
    job.material_delay_reason = reason
    job.material_delayed_at = moved_at
    job.delay_kind = DelayKind.MATERIAL


def _pick_open_pipeline_route(rng: random.Random) -> list:
    """Prefer milling- and lathe-heavy routes; keep KEYWAY/SPLINE/DRILLING common."""
    milling_heavy = [
        r
        for r in OPEN_PIPELINE_ROUTINGS
        if sum(1 for c in r if c in ("TEETH_CUTTING", "SLOTTING", "GROOVING")) >= 2
    ]
    lathe_heavy = [r for r in OPEN_PIPELINE_ROUTINGS if r not in milling_heavy]
    pool = milling_heavy if rng.random() < 0.60 else lathe_heavy
    route = list(rng.choice(pool or OPEN_PIPELINE_ROUTINGS))
    # Bottleneck steps: enough for high single-unit util, not the whole shop
    has_shaper = any(c in ("KEYWAY", "SPLINE") for c in route)
    has_drill = "DRILLING" in route
    insert_at = len(route) - 1 if route and route[-1] == "CHECKING" else len(route)
    if not has_shaper and rng.random() < 0.40:
        route.insert(insert_at, rng.choice(["KEYWAY", "SPLINE"]))
        insert_at += 1
    if not has_drill and rng.random() < 0.50:
        route.insert(insert_at, "DRILLING")
    # Extra milling pass on some lathe-led jobs (shop volume on the mill bank)
    milling_codes = ("TEETH_CUTTING", "SLOTTING", "GROOVING")
    milling_count = sum(1 for c in route if c in milling_codes)
    if milling_count < 2 and rng.random() < 0.45:
        route.insert(
            insert_at,
            rng.choice(["TEETH_CUTTING", "SLOTTING", "GROOVING"]),
        )
    return route


def _scale_open_pipeline_hours(open_jobs, machines, rng: random.Random):
    """
    Keep each op on its routing machine type; only scale remaining hours so
    Lathe/Milling carry the largest absolute load while single-unit types
    (SHAPER, DRILLING) reach high utilization from fewer ops.
    """
    # Per-op hour bands for work still to schedule (4-week horizon ~216h/unit).
    hour_bands = {
        "LATHE": (9, 13),
        "MILLING": (14, 18),
        "SHAPER": (12, 15),
        "DRILLING": (12, 15),
        "GRINDING": (5, 9),
    }
    id_to_code = {m.id: code for code, m in machines.items()}
    for job in open_jobs:
        for op in job.operations:
            if op.status not in (
                OperationStatus.PENDING,
                OperationStatus.IN_PROGRESS,
                OperationStatus.SCHEDULED,
            ):
                continue
            code = id_to_code.get(op.machine_type_id)
            lo, hi = hour_bands.get(code, (4, 8))
            op.estimated_hours = Decimal(str(rng.randint(lo, hi)))
            # Let propose_schedule pick the unit
            op.machine_unit_id = None


def _schedule_open_jobs(created_jobs, catalog, machines, rng: random.Random) -> dict:
    """
    Run propose_schedule on ASSIGNED / IN_PROGRESS jobs and persist windows.
    Returns counts for the seed summary.
    """
    open_jobs = [
        j
        for j in created_jobs
        if j.status in (JobOrderStatus.SCHEDULED, JobOrderStatus.IN_PROGRESS)
    ]
    # Work already under way is booked first, so later plans see its end.
    open_jobs.sort(
        key=lambda j: (
            not any(o.status == OperationStatus.IN_PROGRESS for o in j.operations),
            j.due_date,
            j.id,
        )
    )
    _scale_open_pipeline_hours(open_jobs, machines, rng)
    db.session.flush()

    scheduled_ops = 0
    failed_ops = 0
    for job in open_jobs:
        ops = sorted(job.operations, key=lambda o: o.sequence_no)
        # Ensure workers on every schedulable op before proposing
        for op in ops:
            if op.status == OperationStatus.COMPLETED:
                continue
            if op.assigned_worker_id:
                continue
            mt_code = None
            if op.machine_type_id:
                mt = next(
                    (m for m in machines.values() if m.id == op.machine_type_id),
                    None,
                )
                mt_code = mt.code if mt else None
            op.assigned_worker_id = _pick_worker(catalog, mt_code, rng)

        db.session.flush()
        result = propose_schedule(ops, job.due_date, exclude_job_id=job.id)
        by_id = {r["id"]: r for r in result.get("operations") or [] if r.get("id")}
        for op in ops:
            if op.status == OperationStatus.COMPLETED:
                continue
            row = by_id.get(op.id)
            if not row or not row.get("scheduled"):
                failed_ops += 1
                continue
            op.scheduled_start = _parse_datetime(row.get("scheduledStart"))
            op.scheduled_end = _parse_datetime(row.get("scheduledEnd"))
            if row.get("machineUnitId"):
                op.machine_unit_id = row["machineUnitId"]
            if op.status == OperationStatus.PENDING:
                op.status = OperationStatus.SCHEDULED
            scheduled_ops += 1
        # Flush so the next job's propose_schedule sees these bookings
        db.session.flush()

    return {
        "openJobs": len(open_jobs),
        "scheduledOps": scheduled_ops,
        "failedOps": failed_ops,
    }


def _status_for_day(job_day: date, today: date, is_open: bool) -> JobOrderStatus:
    """Backlog jobs are still open (the newest not started); the rest have finished."""
    if not is_open:
        return JobOrderStatus.COMPLETED
    if (today - job_day).days <= BACKLOG_SCHEDULED_DAYS:
        return JobOrderStatus.SCHEDULED
    return JobOrderStatus.IN_PROGRESS


def _round_to(value: float, step: float) -> float:
    return round(round(value / step) * step, 2)


def _stock_count_dates(window_start: date, today: date, rng: random.Random) -> list[date]:
    """Count days every one to two weeks back from a few days ago, skipping
    Sundays and days that already have a stocktake (one per day)."""
    taken = {s.counted_on for s in Stocktake.query.all()}
    dates = []
    d = today - timedelta(days=rng.randint(4, 9))
    while d >= window_start:
        if d.weekday() == 6:
            d -= timedelta(days=1)
        if d not in taken:
            dates.append(d)
        d -= timedelta(days=rng.choice(STOCK_COUNT_GAPS))
    return sorted(dates)


def _delivery_day(a: date, b: date, fraction: float) -> date | None:
    """A working day strictly between two count days, about ``fraction`` of the way."""
    days = _working_days_between(a + timedelta(days=1), b - timedelta(days=1))
    if not days:
        return None
    return days[min(len(days) - 1, max(0, int(fraction * len(days))))]


def _seed_stock_history(creator, window_start: date, today: date, rng: random.Random) -> dict:
    """
    Stock counts and deliveries for every consumable, worked backwards from its
    current quantity so the newest count equals what is on hand now:
    earlier count = later count + used - delivered. A delivery lands whenever
    the earlier count would sit above the item's usual ceiling. A few items get
    a delivery after the newest count, which raises quantity on hand as a real
    delivery does (--wipe takes it back off).
    """
    tools = Tool.query.filter_by(category=ToolCategory.CONSUMABLE).order_by(Tool.code).all()
    dates = _stock_count_dates(window_start, today, rng)
    if len(dates) < 2 or not tools:
        return {"counts": 0, "deliveries": 0, "afterLastCount": 0, "items": 0}

    counts = {}
    deliveries = defaultdict(list)  # tool id -> [(date, qty)]
    for tool in tools:
        final = float(tool.quantity_on_hand or 0)
        minimum = float(tool.minimum_stock or max(2.0, final / 4))
        step = 0.5 if (tool.unit or "").lower() in ("litre", "liter", "l", "kg") else 1.0
        daily = minimum * rng.uniform(0.05, 0.12)
        lot = max(step, _round_to(minimum * rng.uniform(3.5, 5.0), step))
        ceiling = max(final * 1.1, minimum + lot * rng.uniform(1.0, 1.2))
        row = [0.0] * len(dates)
        row[-1] = final
        for k in range(len(dates) - 1, 0, -1):
            a, b = dates[k - 1], dates[k]
            shop_days = len(_working_days_between(a + timedelta(days=1), b))
            season = 1 + 0.2 * math.sin(2 * math.pi * b.month / 12)
            used = max(0.0, _round_to(daily * shop_days * season * rng.uniform(0.6, 1.4), step))
            earlier = row[k] + used
            n = 0
            while earlier > ceiling:
                earlier -= lot
                n += 1
            for j in range(n):
                fraction = (earlier - 0.5 * minimum) / used if used else 0.5
                on = _delivery_day(a, b, min(0.85, max(0.1, fraction)) + j * 0.1)
                if on:
                    deliveries[tool.id].append((on, lot))
                else:
                    earlier += lot
            row[k - 1] = _round_to(earlier, step)
        counts[tool.id] = row

    after_last = 0
    last = dates[-1]
    for tool in tools:
        minimum = float(tool.minimum_stock or 2)
        row = counts[tool.id]
        if len(row) < 2:
            continue
        daily = max(0.0, (row[-2] - row[-1])) / max(
            1, len(_working_days_between(dates[-2] + timedelta(days=1), last))
        )
        days_since = len(_working_days_between(last + timedelta(days=1), today))
        low = row[-1] - daily * days_since < minimum * 1.5
        if rng.random() < (0.7 if low else 0.15):
            on = _delivery_day(last, today + timedelta(days=1), 0.5)
            if on:
                lot = max(1.0, _round_to(minimum * 4, 1.0))
                deliveries[tool.id].append((on, lot))
                tool.quantity_on_hand = Decimal(str(float(tool.quantity_on_hand or 0) + lot))
                after_last += 1

    for k, on in enumerate(dates):
        st = Stocktake(
            counted_on=on,
            counted_by_id=creator.id,
            notes=STOCK_NOTE,
            created_at=shop_local_to_utc(on, time(16, 30)),
        )
        db.session.add(st)
        db.session.flush()
        for tool in tools:
            row = counts[tool.id]
            if k == 0:
                system_qty = row[0]
            else:
                system_qty = row[k - 1] + sum(
                    q for d, q in deliveries[tool.id] if dates[k - 1] < d < on
                )
            db.session.add(
                StocktakeLine(
                    stocktake_id=st.id,
                    tool_id=tool.id,
                    previous_quantity=Decimal(str(round(system_qty, 2))),
                    counted_quantity=Decimal(str(row[k])),
                )
            )

    n_deliveries, n_orders = _receive_restock_orders(tools, deliveries, creator, rng)
    return {
        "counts": len(dates),
        "first": dates[0],
        "last": last,
        "deliveries": n_deliveries,
        "restockOrders": n_orders,
        "afterLastCount": after_last,
        "items": len(tools),
    }


def _consumable_suppliers() -> list:
    """The active suppliers consumables are restocked from (RIC, STP, RTC)."""
    from app.seed.seed_data import _ensure_suppliers

    by_code = {s.code: s for s in _ensure_suppliers()}
    return [by_code[c] for c in CONSUMABLE_SUPPLIER_CODES if c in by_code]


def _receive_restock_orders(tools, deliveries, creator, rng) -> tuple[int, int]:
    """Every consumable delivery arrives on a restock PO, one PO per delivery
    day from the next active supplier in turn, issued about its lead time
    before (a few arrive late). Each line's RECEIVE event is linked to it, as
    receiving through the PO does."""
    suppliers = _consumable_suppliers()
    on_time = CONSUMABLE_ON_TIME
    unit_costs = {t.id: Decimal(str(round(rng.uniform(25, 450), 2))) for t in tools}
    by_day = defaultdict(list)
    for tool in tools:
        for on, qty in deliveries[tool.id]:
            by_day[on].append((tool, qty))

    n_lines = 0
    late = 0
    for k, on in enumerate(sorted(by_day)):
        supplier = suppliers[k % len(suppliers)]
        lead = supplier.typical_lead_time_days or 1
        make_late = late + 0.5 < (1 - on_time) * (k + 1) and rng.random() < 0.5
        late += make_late
        if not make_late:
            issued = min(on - timedelta(days=lead - rng.choice([0, 0, 0, 1])), on - timedelta(days=1))
            if issued.weekday() == 6:
                issued += timedelta(days=1) if issued + timedelta(days=1) < on else timedelta(days=-1)
        else:
            issued = _skip_sunday_back(on - timedelta(days=lead + rng.randint(1, 3)))
        order = _seeded_order(supplier, issued, creator, RESTOCK_ORDER_NOTE)
        for tool, qty in by_day[on]:
            line = MaterialPurchase(
                tool_id=tool.id,
                material_name=tool.name,
                grade_or_spec=tool.size_spec,
                quantity=Decimal(str(qty)),
                unit=tool.unit,
                unit_cost=unit_costs[tool.id],
                supplier_id=supplier.id,
                date_ordered=issued,
                date_received=on,
            )
            line.supplier_order = order
            db.session.add(line)
            db.session.flush()
            db.session.add(
                ToolEvent(
                    tool_id=tool.id,
                    worker_id=creator.id,
                    type=ToolEventType.RECEIVE,
                    quantity=Decimal(str(qty)),
                    reason=DELIVERY_NOTE,
                    supplier=supplier.name,
                    received_on=on,
                    material_purchase_id=line.id,
                    created_at=shop_local_to_utc(on, time(10, 0)),
                )
            )
            n_lines += 1
        recompute_order_status(order)
    db.session.flush()
    return n_lines, len(by_day)


def _wipe_stock_history() -> tuple[int, int]:
    """Remove HIST-SEED counts and deliveries, taking deliveries made after the
    newest seeded count back off quantity on hand (unless a real count since
    has already reset it)."""
    seeded = Stocktake.query.filter(Stocktake.notes.like(f"{TAG}%")).all()
    events = ToolEvent.query.filter(
        ToolEvent.type == ToolEventType.RECEIVE,
        ToolEvent.reason.like(f"{TAG}%"),
    ).all()
    if seeded:
        last = max(s.counted_on for s in seeded)
        later_real = {
            ln.tool_id
            for st in Stocktake.query.filter(
                Stocktake.counted_on > last,
                or_(Stocktake.notes.is_(None), ~Stocktake.notes.like(f"{TAG}%")),
            ).all()
            for ln in st.lines
        }
        for ev in events:
            if ev.received_on and ev.received_on > last and ev.tool and ev.tool_id not in later_real:
                remaining = Decimal(str(ev.tool.quantity_on_hand or 0)) - Decimal(str(ev.quantity))
                ev.tool.quantity_on_hand = max(remaining, Decimal("0"))
    for ev in events:
        db.session.delete(ev)
    for st in seeded:
        db.session.delete(st)
    db.session.flush()
    return len(seeded), len(events)


def _ensure_fabrication_skills(catalog) -> bool:
    """Laser and Bending are new machine types; when nobody has the skill
    yet, give it to two production workers (seed placeholders first)."""
    added = False
    workers = sorted(
        catalog["workers"],
        key=lambda w: (not (w.full_name or "").startswith("Seed Worker"), w.full_name or ""),
    )
    for code in ("LASER", "BENDING"):
        mt = catalog["machines"].get(code)
        if mt is None or catalog["machine_workers"].get(code):
            continue
        offset = 0 if code == "LASER" else 2
        for w in workers[offset : offset + 2]:
            db.session.add(
                WorkerSkill(worker_id=w.id, machine_type_id=mt.id, proficiency=3, is_primary=False)
            )
            print(f"Skill added: {w.full_name} on {mt.name}")
            added = True
    db.session.flush()
    return added


def seed_history():
    from app.services.reference_data_service import load_reference_data

    rng = random.Random(RNG_SEED)
    load_reference_data(commit=False)
    catalog = _load_catalog()
    if _ensure_fabrication_skills(catalog):
        catalog = _load_catalog()
    _assert_skill_coverage(catalog)
    tendencies = _build_worker_tendencies(catalog, rng)
    clients = _ensure_clients()
    creator = catalog["creator"]
    op_types = catalog["op_types"]
    machines = catalog["machines"]

    today = shop_now().date()
    window_start = _history_months(today)[0]
    workdays = _working_days_between(window_start, today)
    if not workdays:
        raise SystemExit("No working days in history window.")

    job_dates, planned_by_month = _job_dates(today, rng)
    client_slots = _job_slots_for_clients(clients, rng, len(job_dates))

    # A few OT calendar exceptions (tagged) so late finishes are "legitimate"
    ot_days = rng.sample(workdays, k=min(12, len(workdays)))
    for d in ot_days:
        existing = WorkCalendarException.query.filter_by(
            date=d, type=CalendarExceptionType.OVERTIME
        ).first()
        if existing:
            continue
        db.session.add(
            WorkCalendarException(
                date=d,
                type=CalendarExceptionType.OVERTIME,
                start_time=time(17, 0),
                end_time=time(19, 0),
                note=f"{TAG} OT window",
            )
        )

    created_jobs = []
    created_ops = []
    created_purchases = []
    # Separate stream so purchase lines don't shift the existing job/op history.
    purchase_rng = random.Random(RNG_SEED + 1)
    late_rng = random.Random(RNG_SEED + 2)
    suppliers = _load_suppliers()
    first_start_by_job = {}
    rework_count = 0
    variance_ops = 0
    unit_rr = defaultdict(int)

    for idx, (po_date, job_day, is_open) in enumerate(job_dates):
        client, client_profile = client_slots[idx]
        status = _status_for_day(job_day, today, is_open)
        if status == JobOrderStatus.COMPLETED:
            route = rng.choice(ROUTINGS)
            n_ops = rng.randint(2, min(5, len(route)))
            route = route[:n_ops]
        else:
            # Full open-pipeline routes so Lathe/Milling volume is visible
            route = _pick_open_pipeline_route(rng)
            n_ops = len(route)

        job_type, part_cond = _job_type_mix_for_profile(
            client_profile["profile"], rng
        )
        if "CUTTING" in route:
            job_type, part_cond = JobType.FABRICATION, PartCondition.RAW_MATERIAL
        title = f"{JOB_TITLE_PREFIX} {rng.choice(JOB_TITLES)} #{idx + 1:02d}"
        po = f"{PO_PREFIX}{job_day.strftime('%Y%m%d')}-{idx + 1:03d}"

        job = JobOrder(
            client_id=client.id,
            title=title,
            description=(
                f"{TAG} synthetic history for analytics. "
                f"Client={client_profile['display']}. Routing: {' -> '.join(route)}"
            ),
            due_date=(
                today + timedelta(days=rng.randint(*BACKLOG_DUE_DAYS))
                if is_open
                else job_day + timedelta(days=rng.randint(3, 14))
            ),
            client_po_number=po,
            po_date=po_date,
            status=status,
            priority=rng.choice(
                [JobPriority.HIGH, JobPriority.MODERATE, JobPriority.MODERATE, JobPriority.LOW]
            ),
            job_type=job_type,
            part_condition=part_cond,
            material_status=default_material_status(job_type),
            quantity=Decimal(str(rng.choice([1, 2, 4, 6, 12]))),
            unit_of_measure=rng.choice(["pcs", "lot", "set"]),
            amount=_amount_for_profile(client_profile["profile"], rng),
            raw_materials=[],
            created_by_id=creator.id,
            created_at=shop_local_to_utc(job_day, time(7, 30)),
        )
        db.session.add(job)
        db.session.flush()
        created_jobs.append(job)

        # Cursor for sequencing ops across days
        cursor_day = job_day
        ops_for_job = []

        for seq, ot_code in enumerate(route, start=1):
            ot = op_types[ot_code]
            if ot.is_outsourced:
                op, cursor_day = _seed_outsourced_op(
                    job, seq, ot, status, n_ops, cursor_day, rng
                )
                created_ops.append(op)
                ops_for_job.append(op)
                continue
            mt = None
            mt_code = None
            if ot.default_machine_type_id:
                mt = next(
                    (m for m in machines.values() if m.id == ot.default_machine_type_id),
                    None,
                )
                mt_code = mt.code if mt else None

            worker_id = _pick_worker(catalog, mt_code, rng)
            if mt_code and worker_id is None:
                raise SystemExit(f"No skilled worker for {mt_code} (should have been caught).")

            units = catalog["units_by_type"].get(mt_code) or []
            unit = None
            if units:
                unit = units[unit_rr[mt_code] % len(units)]
                unit_rr[mt_code] += 1

            est = Decimal(str(rng.randint(1, 8)))
            bucket = _sample_variance_bucket(rng)
            tendency = tendencies.get((worker_id, mt_code), 1.0)
            target_ratio = max(0.55, min(1.70, bucket * tendency))
            target_hours = float(est) * target_ratio

            start_t = time(rng.choice([8, 8, 9, 9, 10]), rng.choice([0, 15, 30, 45]))

            if status == JobOrderStatus.SCHEDULED:
                op_status = OperationStatus.PENDING
            elif status == JobOrderStatus.IN_PROGRESS:
                # Leave most of the route still to run (capacity forecast demo)
                complete_through = max(1, n_ops // 3)
                if seq <= complete_through:
                    op_status = OperationStatus.COMPLETED
                elif seq == complete_through + 1:
                    op_status = (
                        OperationStatus.IN_PROGRESS
                        if rng.random() < 0.7
                        else OperationStatus.PENDING
                    )
                else:
                    op_status = OperationStatus.PENDING
            else:
                op_status = OperationStatus.COMPLETED

            op = JobOperation(
                job_order_id=job.id,
                sequence_no=seq,
                operation_name=ot.name,
                operation_type_id=ot.id,
                machine_type_id=mt.id if mt else None,
                machine_unit_id=unit.id if unit else None,
                assigned_worker_id=worker_id,
                estimated_hours=est,
                status=op_status,
                notes=TAG,
            )

            db.session.add(op)
            db.session.flush()
            created_ops.append(op)
            ops_for_job.append(op)

            if op_status == OperationStatus.COMPLETED:
                _build_time_chain(
                    op,
                    worker_id,
                    cursor_day,
                    start_t,
                    target_hours,
                    rng,
                    complete=True,
                )
                db.session.flush()
                db.session.refresh(op)
                recompute_variance(op)
                if op.variance_pct is not None:
                    variance_ops += 1
                if op.actual_end:
                    end_shop = op.actual_end.astimezone(ZoneInfo("Asia/Manila"))
                    cursor_day = end_shop.date()
                    if end_shop.hour >= 15:
                        cursor_day += timedelta(days=1)
                else:
                    cursor_day += timedelta(days=1)
            elif op_status == OperationStatus.IN_PROGRESS:
                partial = max(0.5, target_hours * rng.uniform(0.3, 0.6))
                _build_time_chain(
                    op,
                    worker_id,
                    cursor_day,
                    start_t,
                    partial,
                    rng,
                    complete=False,
                )

        # Some completed jobs: rework one completed op (original stays COMPLETED);
        # the follow-on is remachined (COMPLETED, shorter) before the job finishes.
        if status == JobOrderStatus.COMPLETED and rng.random() < REWORK_RATE:
            candidates = [
                o
                for o in ops_for_job
                if o.status == OperationStatus.COMPLETED and not o.turnaround_days
            ]
            if candidates:
                original = rng.choice(candidates)
                reason = rng.choice(REWORK_REASONS)
                original.rework_reason = reason

                mt_code = None
                if original.machine_type_id:
                    mt = next(
                        (
                            m
                            for m in machines.values()
                            if m.id == original.machine_type_id
                        ),
                        None,
                    )
                    mt_code = mt.code if mt else None

                worker_id = _pick_worker(catalog, mt_code, rng)
                unit = _pick_unit(catalog, mt_code, rng)

                follow = JobOperation(
                    job_order_id=job.id,
                    sequence_no=max(o.sequence_no for o in ops_for_job) + 1,
                    operation_name=original.operation_name,
                    operation_type_id=original.operation_type_id,
                    machine_type_id=original.machine_type_id,
                    machine_unit_id=unit.id if unit else None,
                    assigned_worker_id=worker_id,
                    estimated_hours=original.estimated_hours,
                    status=OperationStatus.COMPLETED,
                    rework_of_operation_id=original.id,
                    rework_reason=reason,
                    notes=f"{TAG} rework",
                )
                db.session.add(follow)
                db.session.flush()
                created_ops.append(follow)
                ops_for_job.append(follow)
                rework_count += 1

                # Remachine: typically shorter than the original estimate
                est_h = float(original.estimated_hours or 2)
                rework_hours = max(0.5, est_h * rng.uniform(0.25, 0.55))
                rework_day = cursor_day
                if original.actual_end:
                    end_shop = original.actual_end.astimezone(ZoneInfo("Asia/Manila"))
                    rework_day = end_shop.date() + timedelta(days=rng.randint(0, 2))
                start_t = time(rng.choice([8, 9, 10]), rng.choice([0, 15, 30]))
                _build_time_chain(
                    follow,
                    worker_id,
                    rework_day,
                    start_t,
                    rework_hours,
                    rng,
                    complete=True,
                )
                db.session.flush()
                db.session.refresh(follow)
                recompute_variance(follow)
                if follow.variance_pct is not None:
                    variance_ops += 1

        if job_type == JobType.FABRICATION:
            primary = PRIMARY_SUPPLIER_ROTATION[
                len(first_start_by_job) % len(PRIMARY_SUPPLIER_ROTATION)
            ]
            starts = [o.actual_start for o in ops_for_job if o.actual_start]
            first_start_by_job[job.id] = min(starts) if starts else None
            created_purchases.extend(
                _add_purchase_lines(job, ops_for_job, suppliers, today, purchase_rng, primary)
            )

    fab_jobs = [j for j in created_jobs if j.job_type == JobType.FABRICATION]
    late_material = _settle_purchases(fab_jobs, first_start_by_job, suppliers, today, late_rng)
    job_orders_n = _create_job_material_orders(fab_jobs, suppliers, creator)

    # Explicit on-time / late mix for completed jobs (~22% late)
    completed_for_due = [
        j for j in created_jobs if j.status == JobOrderStatus.COMPLETED
    ]
    if completed_for_due:
        n_late = max(1, int(round(len(completed_for_due) * 0.22)))
        explainable = [j for j in completed_for_due if _can_explain_late(j, late_material)]
        late_jobs = set(rng.sample(explainable, min(n_late, len(explainable))))
        slight_n = max(1, len(late_jobs) // 2)
        slight_jobs = set(rng.sample(list(late_jobs), min(slight_n, len(late_jobs))))
        for job in completed_for_due:
            ends = [
                o.actual_end
                for o in job.operations
                if o.actual_end and o.status == OperationStatus.COMPLETED
            ]
            if not ends:
                continue
            completed_at = max(ends).astimezone(ZoneInfo("Asia/Manila")).date()
            if job in slight_jobs:
                job.due_date = completed_at - timedelta(days=rng.randint(1, 2))
            elif job in late_jobs:
                job.due_date = completed_at - timedelta(days=rng.randint(7, 14))
            else:
                job.due_date = completed_at + timedelta(days=rng.randint(0, 7))

        # Completed at least two days ago: delivered that day or the next (on-time
        # jobs never past their required date), so the Delays tab can list late ones.
        delivery_rng = random.Random(RNG_SEED + 3)
        for job in completed_for_due:
            ends = [o.actual_end for o in job.operations if o.actual_end]
            if not ends:
                continue
            completed_at = max(ends).astimezone(ZoneInfo("Asia/Manila")).date()
            if completed_at > today - timedelta(days=2):
                continue
            delivered = completed_at + timedelta(days=delivery_rng.choice([0, 0, 1]))
            if delivered.weekday() == 6:
                delivered += timedelta(days=1)
            if job not in late_jobs:
                delivered = min(delivered, job.due_date)
            delivered = max(delivered, completed_at)
            job.delivered_at = shop_local_to_utc(min(delivered, today), time(15, 0))
            job.status = JobOrderStatus.DELIVERED

        # Every job delivered late has a recorded cause: late material, redo, a
        # breakdown or other stoppage during one of its operations, or else hours
        # worked beyond target.
        stoppage_rng = random.Random(RNG_SEED + 4)
        added = 0
        for job in completed_for_due:
            if not job.delivered_at or _shop_day(job.delivered_at) <= job.due_date:
                continue
            if job.id in late_material:
                continue
            if any(
                o.rework_of_operation_id and o.status == OperationStatus.COMPLETED
                for o in job.operations
            ):
                continue
            if _add_stoppage(job, added % 2 == 0, creator.id, stoppage_rng):
                added += 1
            elif ran_over_target(job.operations)[0] <= 0:
                print(f"WARNING: no cause recorded for late job {job.client_po_number}")

    # Schedule open pipeline via live propose_schedule (capacity forecast demo)
    schedule_stats = _schedule_open_jobs(created_jobs, catalog, machines, rng)

    # Machine downtimes: handful closed + 1–2 open
    all_units = [u for units in catalog["units_by_type"].values() for u in units]
    if all_units:
        for i in range(6):
            unit = rng.choice(all_units)
            d = rng.choice(workdays)
            start = shop_local_to_utc(d, time(rng.choice([9, 10, 13]), 0))
            ended = start + timedelta(hours=rng.choice([2, 3, 4, 6]))
            reason, category = rng.choice(DOWNTIME_REASONS)
            db.session.add(
                MachineDowntime(
                    machine_unit_id=unit.id,
                    started_at=start,
                    ended_at=ended,
                    category=category,
                    reason=reason,
                    reported_by_id=creator.id,
                    note=f"{TAG} closed downtime #{i + 1}",
                )
            )
        # Open downtimes (1–2), prefer units not already open. Never on the only
        # unit of a machine type: that would block every job needing it.
        open_count = 0
        shuffled = [
            u
            for units in catalog["units_by_type"].values()
            if len(units) > 1
            for u in units
        ]
        rng.shuffle(shuffled)
        for unit in shuffled:
            if open_count >= 2:
                break
            existing_open = MachineDowntime.query.filter_by(
                machine_unit_id=unit.id, ended_at=None
            ).first()
            if existing_open:
                continue
            start = shop_local_to_utc(today - timedelta(days=rng.randint(0, 2)), time(8, 30))
            reason, category = rng.choice(DOWNTIME_REASONS)
            db.session.add(
                MachineDowntime(
                    machine_unit_id=unit.id,
                    started_at=start,
                    ended_at=None,
                    category=category,
                    reason=reason,
                    reported_by_id=creator.id,
                    note=f"{TAG} open downtime",
                )
            )
            open_count += 1

    stock_stats = _seed_stock_history(creator, window_start, today, random.Random(RNG_SEED + 5))
    numbered_n = _number_seeded_orders()

    db.session.commit()

    # Summary stats
    hist_ops = (
        JobOperation.query.join(JobOrder)
        .filter(JobOrder.client_po_number.like(f"{PO_PREFIX}%"))
        .all()
    )
    with_var = [o for o in hist_ops if o.variance_pct is not None]
    under = sum(1 for o in with_var if float(o.variance_pct) < -10)
    near = sum(1 for o in with_var if -10 <= float(o.variance_pct) <= 10)
    over = sum(1 for o in with_var if float(o.variance_pct) > 10)
    reworks = sum(1 for o in hist_ops if o.rework_of_operation_id)
    dts = MachineDowntime.query.filter(MachineDowntime.note.like(f"%{TAG}%")).count()
    open_dts = MachineDowntime.query.filter(
        MachineDowntime.note.like(f"%{TAG}%"),
        MachineDowntime.ended_at.is_(None),
    ).count()

    print("\n=== HIST-SEED summary ===")
    print(f"Date range:          {window_start.isoformat()} -> {today.isoformat()}")
    print(f"Jobs created:        {len(created_jobs)}")
    received = defaultdict(int)
    for j in created_jobs:
        received[f"{j.po_date:%Y-%m}"] += 1
    print(
        "Jobs by PO month:    "
        + ", ".join(f"{k} {received[k]} (planned {planned_by_month.get(k, '-')})" for k in sorted(received))
    )
    if stock_stats["counts"]:
        print(
            f"Stock counts:        {stock_stats['counts']} ({stock_stats['first']} -> "
            f"{stock_stats['last']}) for {stock_stats['items']} consumables, "
            f"{stock_stats['deliveries']} deliveries on {stock_stats['restockOrders']} restock POs "
            f"({stock_stats['afterLastCount']} after the last count)"
        )
    print(
        f"Supplier orders:     {numbered_n} numbered POs "
        f"({job_orders_n} job materials, {numbered_n - job_orders_n} consumable restock)"
    )
    print(f"Operations created:  {len(created_ops)}")
    print(f"With variance data:  {len(with_var)}")
    print(f"Rework follow-ons:   {reworks}")
    print(f"Downtimes:           {dts} ({open_dts} open)")
    fab_jobs = [j for j in created_jobs if j.job_type == JobType.FABRICATION]
    print(
        f"Purchase lines:      {len(created_purchases)} on {len(fab_jobs)} fabrication jobs "
        f"({sum(1 for p in created_purchases if p.date_received is None)} still on order, "
        f"{sum(1 for p in created_purchases if p.consumed_at)} consumed)"
    )
    late_moves = (
        ScheduleMove.query.filter(
            ScheduleMove.job_order_id.in_([j.id for j in fab_jobs]),
            ScheduleMove.kind == DelayKind.MATERIAL,
        ).all()
        if fab_jobs
        else []
    )
    by_sup = defaultdict(int)
    for m in late_moves:
        by_sup[m.supplier.name if m.supplier else "?"] += 1
    print(
        f"Late materials:      {len(late_moves)} of {len(fab_jobs)} fabrication jobs "
        f"(MATERIAL moves: {', '.join(f'{k} {v}' for k, v in sorted(by_sup.items()))})"
    )
    for name, supplier in suppliers.items():
        rows = [p for p in created_purchases if p.supplier_id == supplier.id]
        leads = [(p.date_received - p.date_ordered).days for p in rows if p.date_received]
        stated = supplier.typical_lead_time_days
        late = sum(1 for d in leads if stated is not None and d > stated)
        avg = f"{sum(leads) / len(leads):.1f}d" if leads else "-"
        print(
            f"  {name:<12} lines={len(rows):3d}  stated={stated}d  "
            f"avg actual={avg}  late={late}/{len(leads)}"
        )
    if with_var:
        pcts = [float(o.variance_pct) for o in with_var]
        print(
            f"variance_pct dist:   under(<-10%): {under} ({under / len(with_var):.0%}), "
            f"near(+/-10%): {near} ({near / len(with_var):.0%}), "
            f"over(>10%): {over} ({over / len(with_var):.0%})"
        )
        print(
            f"variance_pct range:  min={min(pcts):.1f}%  "
            f"median={sorted(pcts)[len(pcts) // 2]:.1f}%  max={max(pcts):.1f}%"
        )
    print("Idempotent tag:      client_po_number / notes / downtime note / client name = HIST-SEED")
    print(
        f"Open jobs scheduled: {schedule_stats['openJobs']} jobs, "
        f"{schedule_stats['scheduledOps']} ops placed, "
        f"{schedule_stats['failedOps']} failed"
    )
    # Client mix for revenue analytics
    from sqlalchemy import func as sa_func

    client_rows = (
        db.session.query(
            Client.name,
            sa_func.count(JobOrder.id),
            sa_func.coalesce(sa_func.sum(JobOrder.amount), 0),
        )
        .join(JobOrder, JobOrder.client_id == Client.id)
        .filter(JobOrder.client_po_number.like(f"{PO_PREFIX}%"))
        .group_by(Client.name)
        .order_by(sa_func.sum(JobOrder.amount).desc())
        .all()
    )
    print("Clients:")
    for name, n, revenue in client_rows:
        print(f"  {n:2d} jobs  revenue={float(revenue):,.0f}  {name}")

    # Capacity demo: projected load next 4 weeks (mirrors demand/capacity math)
    horizon_from = today
    horizon_to = today + timedelta(days=27)
    h_start = shop_local_to_utc(horizon_from, time(0, 0))
    h_end = shop_local_to_utc(horizon_to, time(23, 59))
    avail_days = sum(
        1
        for i in range((horizon_to - horizon_from).days + 1)
        if (horizon_from + timedelta(days=i)).weekday() < 6
    )
    from app.services.schedule_calendar import shop_available_hours

    avail_per_unit = shop_available_hours(horizon_from, horizon_to)
    open_scheduled = (
        JobOperation.query.join(JobOrder)
        .filter(
            JobOrder.client_po_number.like(f"{PO_PREFIX}%"),
            JobOrder.status.notin_((JobOrderStatus.COMPLETED, JobOrderStatus.DELIVERED)),
            JobOperation.scheduled_start.isnot(None),
            JobOperation.scheduled_end.isnot(None),
            JobOperation.scheduled_start < h_end,
            JobOperation.scheduled_end > h_start,
            JobOperation.status != OperationStatus.COMPLETED,
        )
        .all()
    )
    load_by_type = defaultdict(float)
    for op in open_scheduled:
        if op.machine_type_id:
            load_by_type[op.machine_type_id] += float(op.estimated_hours or 0)
    print(f"Capacity horizon:    {horizon_from} -> {horizon_to} ({avail_days} workdays, {avail_per_unit:.0f}h/unit)")
    print("projectedLoadPct by machine type:")
    for code in sorted(machines.keys()):
        mt = machines[code]
        n_units = len(catalog["units_by_type"].get(code) or [])
        avail = avail_per_unit * n_units
        load = load_by_type.get(mt.id, 0.0)
        pct = (load / avail * 100.0) if avail else 0.0
        flag = "  ABOVE80" if pct >= 80 else ""
        print(
            f"  {code:10s}  units={n_units}  load={load:6.1f}h  "
            f"avail={avail:7.1f}h  projectedLoadPct={pct:5.1f}%{flag}"
        )

def main():
    parser = argparse.ArgumentParser(description="Seed HIST-SEED analytics history (local only).")
    parser.add_argument(
        "--wipe",
        action="store_true",
        help="Remove only HIST-SEED tagged records and exit (or combine with seed).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Wipe existing HIST-SEED data then reseed.",
    )
    args = parser.parse_args()

    _assert_local_db()
    app = create_app()
    with app.app_context():
        if args.wipe and not args.force:
            wipe_history()
            return

        existing = _hist_jobs_query().count()
        if existing and not args.force:
            print(
                f"Already seeded ({existing} HIST-SEED jobs). "
                "Re-run with --wipe to remove, or --force to wipe+reseed."
            )
            return

        if existing and args.force:
            wipe_history()

        seed_history()


if __name__ == "__main__":
    main()
