"""History seed purchase lines: dates line up with the start gate and lead-time analytics.

Calls the seed helpers directly inside the rolled-back session from test_process_flow.
"""

import random
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.models.job_order import MaterialStatus
from app.models.operation import OperationStatus
from scripts.seed_history import (
    LATE_SUPPLIER_SHARES,
    MATERIAL_CATALOG,
    PRIMARY_SUPPLIER_ROTATION,
    SUPPLIER_PROFILES,
    _add_purchase_lines,
    _load_suppliers,
    _settle_purchases,
)
from tests.test_process_flow import (  # noqa: F401  (fixtures)
    _add_op,
    _job,
    _rollback_txn,
    app,
    people,
)

SHOP_TZ = ZoneInfo("Asia/Manila")
MATERIAL_NAMES = {m[0] for m in MATERIAL_CATALOG}
TODAY = date(2026, 9, 28)


def _started_job(people, start_utc):
    job = _job(people, material_status=MaterialStatus.TO_ORDER)
    job.created_at = start_utc - timedelta(hours=1)
    op = _add_op(job, "TURNING", people["worker"].id, status=OperationStatus.COMPLETED)
    op.actual_start = start_utc
    return job, op


def _seed(people, starts, rng):
    """Purchase lines for started jobs, settled the way seed_history does."""
    suppliers = _load_suppliers()
    jobs, first_start = [], {}
    for i, start in enumerate(starts):
        job, op = _started_job(people, start)
        primary = PRIMARY_SUPPLIER_ROTATION[i % len(PRIMARY_SUPPLIER_ROTATION)]
        _add_purchase_lines(job, [op], suppliers, TODAY, rng, primary)
        jobs.append(job)
        first_start[job.id] = start
    late_material = _settle_purchases(jobs, first_start, suppliers, TODAY, rng)
    return suppliers, jobs, late_material


def _weekday_starts(first, count):
    starts = []
    day = first
    while len(starts) < count:
        if day.astimezone(SHOP_TZ).weekday() != 6:
            starts.append(day)
        day += timedelta(days=1)
    return starts


def test_started_jobs_receive_before_first_op_and_consume_at_start(people):
    suppliers = _load_suppliers()
    assert set(suppliers) == set(SUPPLIER_PROFILES)
    starts = _weekday_starts(datetime(2026, 8, 3, 1, 0, tzinfo=timezone.utc), 30)
    _suppliers, jobs, _late = _seed(people, starts, random.Random(7))

    for job, start in zip(jobs, starts):
        lines = list(job.material_purchases)
        first_day = start.astimezone(SHOP_TZ).date()
        assert 1 <= len(lines) <= 3
        assert len({ln.material_name for ln in lines}) == len(lines)
        assert {ln.material_name for ln in lines} <= MATERIAL_NAMES
        for ln in lines:
            assert ln.date_ordered < first_day
            assert ln.date_ordered.weekday() != 6
            assert ln.date_received is not None
            assert ln.date_ordered < ln.date_received <= first_day
            assert ln.date_received.weekday() != 6
            assert ln.consumed_at == start
            assert ln.unit_cost > 0
        assert job.material_status == MaterialStatus.RECEIVED
        assert job.created_at <= start
        assert job.raw_materials and len(job.raw_materials) == len(lines)


def test_not_started_job_keeps_future_deliveries_on_order(people):
    suppliers = _load_suppliers()
    job = _job(people, material_status=MaterialStatus.TO_ORDER)
    job.created_at = datetime(2026, 9, 28, 0, 0, tzinfo=timezone.utc)
    op = _add_op(job, "TURNING", people["worker"].id, status=OperationStatus.PENDING)
    _add_purchase_lines(job, [op], suppliers, TODAY, random.Random(3), "STP")
    _settle_purchases([job], {job.id: None}, suppliers, TODAY, random.Random(3))

    for ln in job.material_purchases:
        assert ln.date_ordered == TODAY
        assert ln.date_received is None
        assert ln.consumed_at is None
    assert job.material_status == MaterialStatus.ORDERED


def test_on_time_shares_and_late_material_split(people):
    starts = _weekday_starts(datetime(2026, 6, 1, 1, 0, tzinfo=timezone.utc), 40)
    suppliers, jobs, late_material = _seed(people, starts, random.Random(11))

    due = defaultdict(int)
    late = defaultdict(int)
    for job in jobs:
        for ln in job.material_purchases:
            name = next(n for n, s in suppliers.items() if s.id == ln.supplier_id)
            promised = ln.date_ordered + timedelta(days=suppliers[name].typical_lead_time_days)
            due[name] += 1
            if ln.date_received > promised:
                late[name] += 1
    for name, profile in SUPPLIER_PROFILES.items():
        assert due[name] >= 5, name
        on_time = 1 - late[name] / due[name]
        assert abs(on_time - profile["on_time"]) <= 0.10, (name, on_time)

    counts = defaultdict(int)
    for name in late_material.values():
        counts[name] += 1
    total = len(late_material)
    assert total >= 6
    for name, share in LATE_SUPPLIER_SHARES.items():
        assert abs(counts[name] / total - share) <= 0.10, (name, counts[name], total)
