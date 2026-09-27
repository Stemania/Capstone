"""History seed purchase lines: dates line up with the start gate and lead-time analytics.

Calls the seed helper directly inside the rolled-back session from test_process_flow.
"""

import random
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.models.job_order import MaterialStatus
from app.models.operation import OperationStatus
from scripts.seed_history import (
    MATERIAL_CATALOG,
    SUPPLIER_PROFILES,
    _add_purchase_lines,
    _load_suppliers,
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


def _started_job(people, start_utc):
    job = _job(people, material_status=MaterialStatus.TO_ORDER)
    job.created_at = start_utc - timedelta(hours=1)
    op = _add_op(job, "TURNING", people["worker"].id, status=OperationStatus.COMPLETED)
    op.actual_start = start_utc
    return job, op


def test_started_jobs_receive_before_first_op_and_consume_at_start(people):
    suppliers = _load_suppliers()
    assert set(suppliers) == set(SUPPLIER_PROFILES)
    rng = random.Random(7)
    today = date(2026, 9, 28)
    for i in range(40):
        start = datetime(2026, 8, 3, 1, 0, tzinfo=timezone.utc) + timedelta(days=i)
        if start.astimezone(SHOP_TZ).weekday() == 6:
            continue
        job, op = _started_job(people, start)
        lines = _add_purchase_lines(job, [op], suppliers, today, rng)

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
    today = date(2026, 9, 28)
    job = _job(people, material_status=MaterialStatus.TO_ORDER)
    job.created_at = datetime(2026, 9, 28, 0, 0, tzinfo=timezone.utc)
    op = _add_op(job, "TURNING", people["worker"].id, status=OperationStatus.PENDING)
    lines = _add_purchase_lines(job, [op], suppliers, today, random.Random(3))

    for ln in lines:
        assert ln.date_ordered == today
        assert ln.date_received is None
        assert ln.consumed_at is None
    assert job.material_status == MaterialStatus.ORDERED


def test_lead_times_vary_and_include_late_deliveries(people):
    suppliers = _load_suppliers()
    rng = random.Random(11)
    today = date(2026, 9, 28)
    late = 0
    by_supplier = {name: 0 for name in SUPPLIER_PROFILES}
    for i in range(60):
        start = datetime(2026, 7, 1, 1, 0, tzinfo=timezone.utc) + timedelta(days=i)
        if start.astimezone(SHOP_TZ).weekday() == 6:
            continue
        job, op = _started_job(people, start)
        for ln in _add_purchase_lines(job, [op], suppliers, today, rng):
            name = next(n for n, s in suppliers.items() if s.id == ln.supplier_id)
            by_supplier[name] += 1
            if (ln.date_received - ln.date_ordered).days > suppliers[name].typical_lead_time_days:
                late += 1
    assert late > 0
    assert by_supplier["STP"] > by_supplier["Railim"] > by_supplier["Seno Metals"] > 0
