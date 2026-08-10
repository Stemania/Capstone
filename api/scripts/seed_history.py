"""
Seed realistic 8-week production history for analytics demos.

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

load_dotenv(API_ROOT / ".env")

from app import create_app
from app.extensions import db
from app.models.client import Client
from app.models.job_order import (
    JobOrder,
    JobOrderStatus,
    JobPriority,
    JobType,
    MaterialSource,
    PartCondition,
)
from app.models.machine import MachineType, MachineUnit
from app.models.operation import JobOperation, OperationStatus
from app.models.operation_time import (
    MachineDowntime,
    OperationPauseReason,
    OperationTimeEvent,
    OperationTimeLog,
)
from app.models.user import User, UserRole
from app.models.worker_skill import (
    CalendarExceptionType,
    OperationType,
    WorkCalendarException,
    WorkerSkill,
)
from app.services.job_order_service import _parse_datetime
from app.services.operation_service import recompute_variance
from app.services.schedule_calendar import shop_local_to_utc, shop_now
from app.services.schedule_service import propose_schedule

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

# ~50 jobs / 8 weeks ≈ 6.25/week
TARGET_JOBS = 50
HISTORY_WEEKS = 8
REWORK_RATE = 0.15
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
    "Spindle bearing noise",
    "Coolant pump failure",
    "Toolchanger jam",
    "Preventive maintenance",
    "Power trip — waiting electrician",
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

    # Job → operations → time_logs cascade
    for job in jobs:
        db.session.delete(job)
    db.session.flush()

    dts = MachineDowntime.query.filter(MachineDowntime.note.like(f"%{TAG}%")).all()
    for row in dts:
        db.session.delete(row)

    cal = WorkCalendarException.query.filter(
        WorkCalendarException.note.like(f"%{TAG}%")
    ).all()
    for row in cal:
        db.session.delete(row)

    clients = Client.query.filter(Client.name.like(f"{TAG}%")).all()
    for c in clients:
        db.session.delete(c)

    db.session.commit()
    print(
        f"Wiped: {len(jobs)} jobs, {op_count} operations, {log_count} time logs, "
        f"{len(dts)} downtimes, {len(cal)} calendar exceptions, {len(clients)} clients."
    )


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


def _job_slots_for_clients(clients, rng: random.Random):
    """Build a shuffled list of (client, profile_meta) length TARGET_JOBS."""
    assert sum(p["jobs"] for p in CLIENT_PROFILES) == TARGET_JOBS
    slots = []
    for client, profile in zip(clients, CLIENT_PROFILES):
        for _ in range(profile["jobs"]):
            slots.append((client, profile))
    rng.shuffle(slots)
    return slots


def _job_type_mix_for_profile(profile_kind: str, rng: random.Random):
    """
    Construction → mostly FABRICATION / shop-procured.
    Manufacturing → MODIFICATION / REPAIR on client-supplied items.
    Mixed → balanced.
    """
    roll = rng.random()
    if profile_kind == "construction":
        if roll < 0.82:
            return (
                JobType.FABRICATION,
                MaterialSource.SHOP_PROCURED,
                PartCondition.RAW_MATERIAL,
            )
        if roll < 0.92:
            return (
                JobType.MODIFICATION,
                MaterialSource.CLIENT_SUPPLIED,
                PartCondition.CLIENT_SUPPLIED_ITEM,
            )
        return (
            JobType.REPAIR,
            MaterialSource.CLIENT_SUPPLIED,
            PartCondition.CLIENT_SUPPLIED_ITEM,
        )
    if profile_kind == "manufacturing":
        if roll < 0.55:
            return (
                JobType.MODIFICATION,
                MaterialSource.CLIENT_SUPPLIED,
                PartCondition.CLIENT_SUPPLIED_ITEM,
            )
        if roll < 0.85:
            return (
                JobType.REPAIR,
                MaterialSource.CLIENT_SUPPLIED,
                PartCondition.CLIENT_SUPPLIED_ITEM,
            )
        return (
            JobType.FABRICATION,
            MaterialSource.SHOP_PROCURED,
            PartCondition.RAW_MATERIAL,
        )
    # mixed
    if roll < 0.45:
        return (
            JobType.FABRICATION,
            MaterialSource.SHOP_PROCURED,
            PartCondition.RAW_MATERIAL,
        )
    if roll < 0.75:
        return (
            JobType.MODIFICATION,
            MaterialSource.CLIENT_SUPPLIED,
            PartCondition.CLIENT_SUPPLIED_ITEM,
        )
    return (
        JobType.REPAIR,
        MaterialSource.CLIENT_SUPPLIED,
        PartCondition.CLIENT_SUPPLIED_ITEM,
    )


def _amount_for_profile(profile_kind: str, rng: random.Random) -> Decimal:
    """Construction jobs skew larger; manufacturing mid-range; mixed between."""
    if profile_kind == "construction":
        # 40k–95k in 1k steps
        return Decimal(str(rng.randint(40, 95) * 1000))
    if profile_kind == "manufacturing":
        return Decimal(str(rng.randint(8, 55) * 1000))
    return Decimal(str(rng.randint(15, 70) * 1000))


def _sample_raw_materials(rng: random.Random, material_source: MaterialSource) -> list:
    """Shop-procured jobs get bill-of-materials lines; client-supplied often empty."""
    if material_source == MaterialSource.CLIENT_SUPPLIED and rng.random() < 0.55:
        return []
    pool = [
        ("Mild steel plate", "pcs"),
        ("Mild steel round bar", "pcs"),
        ("Stainless steel 304", "pcs"),
        ("Cast iron blank", "pcs"),
        ("Bronze bushing stock", "pcs"),
        ("Welding electrode E6013", "kg"),
        ("Cutting fluid", "L"),
    ]
    n = rng.randint(1, 3)
    picks = rng.sample(pool, min(n, len(pool)))
    return [
        {
            "name": name,
            "quantity": rng.choice([1, 2, 3, 4, 6, 8, 10, 12]),
            "unit": unit,
        }
        for name, unit in picks
    ]


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
        if j.status in (JobOrderStatus.ASSIGNED, JobOrderStatus.IN_PROGRESS)
    ]
    open_jobs.sort(key=lambda j: (j.due_date, j.id))
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


def _status_for_index(i: int, total: int) -> JobOrderStatus:
    # Larger open pipeline so Lathe/Milling absolute hours are visible in the
    # 4-week capacity window (~10 ASSIGNED + ~14 IN_PROGRESS).
    if i >= total - 10:
        return JobOrderStatus.ASSIGNED
    if i >= total - 24:
        return JobOrderStatus.IN_PROGRESS
    return JobOrderStatus.COMPLETED


def seed_history():
    rng = random.Random(RNG_SEED)
    catalog = _load_catalog()
    _assert_skill_coverage(catalog)
    tendencies = _build_worker_tendencies(catalog, rng)
    clients = _ensure_clients()
    client_slots = _job_slots_for_clients(clients, rng)
    creator = catalog["creator"]
    op_types = catalog["op_types"]
    machines = catalog["machines"]

    today = shop_now().date()
    window_start = today - timedelta(weeks=HISTORY_WEEKS)
    workdays = _working_days_between(window_start, today)
    if not workdays:
        raise SystemExit("No working days in history window.")

    # ~6 jobs/week: allow multiple jobs on the same day (shop volume).
    job_days = []
    for i in range(TARGET_JOBS):
        # Spread evenly across the window with light jitter
        idx = int(i * (len(workdays) - 1) / max(TARGET_JOBS - 1, 1))
        jitter = rng.randint(-1, 1) if len(workdays) > 3 else 0
        idx = max(0, min(len(workdays) - 1, idx + jitter))
        job_days.append(workdays[idx])
    job_days.sort()

    # A few OT calendar exceptions (tagged) so late finishes are "legitimate"
    ot_days = rng.sample(workdays, k=min(5, len(workdays)))
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
    rework_count = 0
    variance_ops = 0
    pending_rework_budget = 2

    unit_rr = defaultdict(int)

    for idx, job_day in enumerate(job_days):
        client, client_profile = client_slots[idx]
        status = _status_for_index(idx, TARGET_JOBS)
        if status == JobOrderStatus.COMPLETED:
            route = rng.choice(ROUTINGS)
            n_ops = rng.randint(2, min(5, len(route)))
            route = route[:n_ops]
        else:
            # Full open-pipeline routes so Lathe/Milling volume is visible
            route = _pick_open_pipeline_route(rng)
            n_ops = len(route)

        job_type, material, part_cond = _job_type_mix_for_profile(
            client_profile["profile"], rng
        )
        title = f"{JOB_TITLE_PREFIX} {rng.choice(JOB_TITLES)} #{idx + 1:02d}"
        po = f"{PO_PREFIX}{job_day.strftime('%Y%m%d')}-{idx + 1:03d}"

        job = JobOrder(
            client_id=client.id,
            title=title,
            description=(
                f"{TAG} synthetic history for analytics. "
                f"Client={client_profile['display']}. Routing: {' -> '.join(route)}"
            ),
            due_date=job_day + timedelta(days=rng.randint(3, 14)),
            client_po_number=po,
            po_date=job_day - timedelta(days=rng.randint(1, 5)),
            status=status,
            priority=rng.choice(
                [JobPriority.HIGH, JobPriority.MODERATE, JobPriority.MODERATE, JobPriority.LOW]
            ),
            job_type=job_type,
            material_source=material,
            part_condition=part_cond,
            quantity=Decimal(str(rng.choice([1, 2, 4, 6, 12]))),
            unit_of_measure=rng.choice(["pcs", "lot", "set"]),
            amount=_amount_for_profile(client_profile["profile"], rng),
            raw_materials=_sample_raw_materials(rng, material),
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

            if status == JobOrderStatus.ASSIGNED:
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

        # ~8% of completed jobs: rework one completed op (original stays COMPLETED).
        # Most follow-ons are remachined (COMPLETED, shorter); leave a couple PENDING.
        if status == JobOrderStatus.COMPLETED and rng.random() < REWORK_RATE:
            candidates = [
                o for o in ops_for_job if o.status == OperationStatus.COMPLETED
            ]
            if candidates:
                original = rng.choice(candidates)
                reason = rng.choice(REWORK_REASONS)
                original.rework_reason = reason

                leave_pending = (
                    pending_rework_budget > 0
                    and rework_count >= 2
                    and rng.random() < 0.55
                )
                if leave_pending:
                    pending_rework_budget -= 1

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
                    machine_unit_id=unit.id if unit and not leave_pending else None,
                    assigned_worker_id=worker_id if not leave_pending else None,
                    estimated_hours=original.estimated_hours,
                    status=(
                        OperationStatus.PENDING
                        if leave_pending
                        else OperationStatus.COMPLETED
                    ),
                    rework_of_operation_id=original.id,
                    rework_reason=reason,
                    notes=f"{TAG} rework",
                )
                db.session.add(follow)
                db.session.flush()
                created_ops.append(follow)
                ops_for_job.append(follow)
                rework_count += 1

                if leave_pending:
                    job.status = JobOrderStatus.IN_PROGRESS
                else:
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
                    job.status = JobOrderStatus.COMPLETED

    # Explicit on-time / late mix for completed jobs (~22% late)
    completed_for_due = [
        j for j in created_jobs if j.status == JobOrderStatus.COMPLETED
    ]
    if completed_for_due:
        n_late = max(1, int(round(len(completed_for_due) * 0.22)))
        late_jobs = set(rng.sample(completed_for_due, min(n_late, len(completed_for_due))))
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
            db.session.add(
                MachineDowntime(
                    machine_unit_id=unit.id,
                    started_at=start,
                    ended_at=ended,
                    reason=rng.choice(DOWNTIME_REASONS),
                    reported_by_id=creator.id,
                    note=f"{TAG} closed downtime #{i + 1}",
                )
            )
        # Open downtimes (1–2), prefer units not already open
        open_count = 0
        shuffled = list(all_units)
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
            db.session.add(
                MachineDowntime(
                    machine_unit_id=unit.id,
                    started_at=start,
                    ended_at=None,
                    reason=rng.choice(DOWNTIME_REASONS),
                    reported_by_id=creator.id,
                    note=f"{TAG} open downtime",
                )
            )
            open_count += 1

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
    print(f"Operations created:  {len(created_ops)}")
    print(f"With variance data:  {len(with_var)}")
    print(f"Rework follow-ons:   {reworks}")
    print(f"Downtimes:           {dts} ({open_dts} open)")
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
    avail_per_unit = avail_days * 9.0
    open_scheduled = (
        JobOperation.query.join(JobOrder)
        .filter(
            JobOrder.client_po_number.like(f"{PO_PREFIX}%"),
            JobOrder.status != JobOrderStatus.COMPLETED,
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
