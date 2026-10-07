"""Analytics fixes: open pipeline excludes pending jobs, machine utilization
counts only worked intervals, weekly trends cut weeks in Manila time, and late
job orders list time run over target as a cause.

Uses the bmsc_test database from conftest (schema built from the models).
"""

from datetime import date, datetime, time, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.machine import MachineType, MachineUnit
from app.models.operation import JobOperation, OperationStatus
from app.models.operation_time import OperationPauseReason, OperationTimeEvent, OperationTimeLog
from app.models.user import User, UserRole, UserStatus
from app.models.worker_profile import WorkerProfile
from app.models.worker_skill import WorkerSchedule
from app.services import analytics_service as svc
from app.services.delay_analysis_service import late_jobs, ran_over_target
from app.services.schedule_calendar import SHOP_TZ


def _local(day, hh, mm=0):
    return datetime.combine(day, time(hh, mm), tzinfo=SHOP_TZ)


def _user(email, role):
    user = User(
        email=email,
        password_hash=bcrypt.generate_password_hash("Passw0rd!").decode("utf-8"),
        full_name=email.split("@")[0],
        role=role,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    db.session.flush()
    if role == UserRole.PRODUCTION_WORKER:
        db.session.add(WorkerProfile(user_id=user.id))
    return user


@pytest.fixture
def shop(app):
    office = _user("af_office@test.local", UserRole.OFFICE_STAFF)
    worker = _user("af_worker@test.local", UserRole.PRODUCTION_WORKER)
    for dow in range(7):
        db.session.add(
            WorkerSchedule(
                worker_id=worker.id,
                day_of_week=dow,
                is_working=True,
                start_time=time(8, 0),
                end_time=time(17, 0),
            )
        )
    client_row = Client(name="Analytics Client")
    lathe = MachineType(code="AF_LATHE", name="Lathe", units=1)
    db.session.add_all([client_row, lathe])
    db.session.flush()
    unit = MachineUnit(machine_type_id=lathe.id, label="AF Lathe #1", active=True)
    db.session.add(unit)
    db.session.commit()
    return {"office": office, "worker": worker, "client": client_row, "lathe": lathe, "unit": unit}


def _job(shop, status, amount=1000, title="Job"):
    job = JobOrder(
        client_id=shop["client"].id,
        title=title,
        due_date=date(2026, 12, 31),
        status=status,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        material_status=MaterialStatus.NOT_REQUIRED,
        raw_materials=[],
        amount=Decimal(str(amount)),
        created_by_id=shop["office"].id,
    )
    db.session.add(job)
    db.session.flush()
    return job


def _finished_op(shop, job, start, end, events):
    op = JobOperation(
        job_order_id=job.id,
        sequence_no=1,
        operation_name="Turning",
        estimated_hours=Decimal("4"),
        status=OperationStatus.COMPLETED,
        assigned_worker_id=shop["worker"].id,
        machine_type_id=shop["lathe"].id,
        machine_unit_id=shop["unit"].id,
        scheduled_start=start,
        scheduled_end=end,
        actual_start=start,
        actual_end=end,
        actual_worked_hours=Decimal("4"),
        variance_pct=Decimal("0"),
    )
    db.session.add(op)
    db.session.flush()
    for event, at, reason in events:
        db.session.add(
            OperationTimeLog(
                operation_id=op.id,
                worker_id=shop["worker"].id,
                event=event,
                event_at=at,
                reason=reason,
            )
        )
    return op


# ---- Fix 1: Accepted, not delivered ------------------------------------------


def test_pipeline_counts_only_released_jobs_not_completed_or_delivered(shop):
    _job(shop, JobOrderStatus.DRAFT, 5000, "Pending")
    _job(shop, JobOrderStatus.SCHEDULED, 1000, "Scheduled")
    _job(shop, JobOrderStatus.IN_PROGRESS, 2000, "In progress")
    _job(shop, JobOrderStatus.COMPLETED, 4000, "Completed")
    _job(shop, JobOrderStatus.DELIVERED, 8000, "Delivered")
    db.session.commit()

    pipeline = svc.sales_forecast()["committedPipeline"]

    assert pipeline["jobCount"] == 2
    assert pipeline["totalAmount"] == 3000.0


# ---- Fix 2: machine utilization ------------------------------------------------


def test_worked_intervals_skip_paused_time():
    day = date(2026, 9, 28)
    logs = [
        SimpleNamespace(event=OperationTimeEvent.START, event_at=_local(day, 8), created_at=None),
        SimpleNamespace(event=OperationTimeEvent.PAUSE, event_at=_local(day, 10), created_at=None),
        SimpleNamespace(event=OperationTimeEvent.RESUME, event_at=_local(day, 13), created_at=None),
        SimpleNamespace(event=OperationTimeEvent.COMPLETE, event_at=_local(day, 15), created_at=None),
    ]
    assert svc.worked_intervals(logs) == [
        (_local(day, 8).astimezone(timezone.utc), _local(day, 10).astimezone(timezone.utc)),
        (_local(day, 13).astimezone(timezone.utc), _local(day, 15).astimezone(timezone.utc)),
    ]


def test_machine_utilization_counts_only_worked_intervals_in_working_hours(shop):
    day = date(2026, 9, 28)  # Monday
    job = _job(shop, JobOrderStatus.COMPLETED)
    # 08–10 worked, 10–13 paused for a breakdown, 13–18 worked; the shift ends at 17.
    _finished_op(
        shop,
        job,
        _local(day, 8),
        _local(day, 18),
        [
            (OperationTimeEvent.START, _local(day, 8), None),
            (OperationTimeEvent.PAUSE, _local(day, 10), OperationPauseReason.MACHINE_DOWN),
            (OperationTimeEvent.RESUME, _local(day, 13), None),
            (OperationTimeEvent.COMPLETE, _local(day, 18), None),
        ],
    )
    db.session.commit()

    result = svc.efficiency_by_machine("2026-09-28", "2026-09-28", min_ops=1)
    row = next(u for u in result["machineUnits"] if u["machineUnitId"] == shop["unit"].id)

    assert row["busySegmentHours"] == pytest.approx(6.0)


def test_machine_utilization_ignores_worked_time_outside_the_period(shop):
    sunday, monday = date(2026, 9, 27), date(2026, 9, 28)
    job = _job(shop, JobOrderStatus.COMPLETED)
    _finished_op(
        shop,
        job,
        _local(sunday, 15),
        _local(monday, 10),
        [
            (OperationTimeEvent.START, _local(sunday, 15), None),
            (OperationTimeEvent.PAUSE, _local(sunday, 17), OperationPauseReason.END_OF_SHIFT),
            (OperationTimeEvent.RESUME, _local(monday, 8), None),
            (OperationTimeEvent.COMPLETE, _local(monday, 10), None),
        ],
    )
    db.session.commit()

    result = svc.efficiency_by_machine("2026-09-28", "2026-09-28", min_ops=1)
    row = next(u for u in result["machineUnits"] if u["machineUnitId"] == shop["unit"].id)

    assert row["busySegmentHours"] == pytest.approx(2.0)


# ---- Fix 3: weekly trends in Manila time -----------------------------------------


def test_shop_week_starts_monday_midnight_manila():
    # Monday 07:00 Manila is still Sunday in UTC.
    monday_early = _local(date(2026, 10, 5), 7).astimezone(timezone.utc)
    assert monday_early.date() == date(2026, 10, 4)
    assert svc.shop_week_start(monday_early) == date(2026, 10, 5)
    # Sunday 23:30 Manila belongs to the week that started the Monday before.
    sunday_late = _local(date(2026, 10, 4), 23, 30)
    assert svc.shop_week_start(sunday_late) == date(2026, 9, 28)


def test_weekly_trend_groups_by_manila_week_with_jobs_finished(shop):
    monday = date(2026, 10, 5)
    job = _job(shop, JobOrderStatus.COMPLETED)
    _finished_op(
        shop,
        job,
        _local(monday, 3),
        _local(monday, 7),
        [
            (OperationTimeEvent.START, _local(monday, 3), None),
            (OperationTimeEvent.COMPLETE, _local(monday, 7), None),
        ],
    )
    db.session.commit()

    weeks = svc.efficiency_trend("2026-10-01", "2026-10-10")["weeks"]

    assert weeks == [
        {
            "weekStart": "2026-10-05",
            "operationCount": 1,
            "averageVariancePct": 0.0,
            "jobsFinished": 1,
        }
    ]


# ---- Late job orders: ran over target ---------------------------------------------


def test_ran_over_target_counts_hours_beyond_target_and_skips_redo():
    ops = [
        SimpleNamespace(rework_of_operation_id=None, estimated_hours=4, actual_worked_hours=6.5, is_outsourced=False),
        SimpleNamespace(rework_of_operation_id=None, estimated_hours=3, actual_worked_hours=2, is_outsourced=False),
        SimpleNamespace(rework_of_operation_id=None, estimated_hours=None, actual_worked_hours=9, is_outsourced=False),
        SimpleNamespace(rework_of_operation_id="orig", estimated_hours=1, actual_worked_hours=5, is_outsourced=False),
        SimpleNamespace(rework_of_operation_id=None, estimated_hours=1, actual_worked_hours=4, is_outsourced=True),
    ]
    assert ran_over_target(ops) == (pytest.approx(2.5), 1)


def test_late_job_lists_ran_over_target_as_a_cause(shop):
    day = date(2026, 10, 5)
    job = _job(shop, JobOrderStatus.DELIVERED)
    job.due_date = date(2026, 10, 6)
    job.delivered_at = _local(date(2026, 10, 8), 15)
    op = _finished_op(
        shop,
        job,
        _local(day, 8),
        _local(day, 15),
        [
            (OperationTimeEvent.START, _local(day, 8), None),
            (OperationTimeEvent.COMPLETE, _local(day, 15), None),
        ],
    )
    op.actual_worked_hours = Decimal("7")
    db.session.commit()

    rows = [r for r in late_jobs(date(2026, 10, 1), date(2026, 10, 31)) if r["jobOrderId"] == job.id]

    assert rows and rows[0]["daysLate"] == 2
    assert rows[0]["causes"] == [
        {
            "cause": "RAN_OVER_TARGET",
            "label": "Ran over target",
            "hours": 3.0,
            "detail": "1 operation over target hours",
        }
    ]
