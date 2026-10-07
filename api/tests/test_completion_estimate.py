"""Completion estimates from past operation durations, and the at-risk alert.

Uses the bmsc_test database from conftest (schema built from the models).
"""

from datetime import date, datetime, time, timedelta
from decimal import Decimal

import pytest

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.operation import JobOperation, OperationStatus
from app.models.operation_time import OperationTimeEvent, OperationTimeLog
from app.models.staff_alert import StaffAlert, StaffAlertKind
from app.models.user import User, UserRole, UserStatus
from app.models.worker_profile import WorkerProfile
from app.models.worker_skill import OperationType, WorkerSchedule
from app.services import completion_estimate_service as est
from app.services.schedule_calendar import SHOP_TZ

MONDAY = date(2026, 8, 10)


def _at(day, hh, mm=0):
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


def _job(shop, status, due=date(2026, 12, 31)):
    job = JobOrder(
        client_id=shop["client"].id,
        title="Estimate job",
        due_date=due,
        status=status,
        job_type=JobType.REPAIR,
        part_condition=PartCondition.CLIENT_SUPPLIED_ITEM,
        material_status=MaterialStatus.NOT_REQUIRED,
        raw_materials=[],
        amount=Decimal("1000"),
        created_by_id=shop["office"].id,
    )
    db.session.add(job)
    db.session.flush()
    return job


def _op(shop, job, op_type, seq, target, status, worked=None):
    op = JobOperation(
        job_order_id=job.id,
        sequence_no=seq,
        operation_name=op_type.name,
        operation_type_id=op_type.id,
        estimated_hours=Decimal(str(target)),
        actual_worked_hours=Decimal(str(worked)) if worked is not None else None,
        status=status,
        assigned_worker_id=shop["worker"].id,
    )
    db.session.add(op)
    db.session.flush()
    return op


@pytest.fixture
def shop(app):
    admin = _user("ce_admin@test.local", UserRole.ADMIN)
    office = _user("ce_office@test.local", UserRole.OFFICE_STAFF)
    worker = _user("ce_worker@test.local", UserRole.PRODUCTION_WORKER)
    for dow in range(7):
        db.session.add(
            WorkerSchedule(
                worker_id=worker.id,
                day_of_week=dow,
                is_working=dow < 6,
                start_time=time(8, 0) if dow < 6 else None,
                end_time=time(17, 0) if dow < 6 else None,
            )
        )
    client = Client(name="Estimate Client")
    turning = OperationType(code="CE_TURNING", name="CE Turning")
    facing = OperationType(code="CE_FACING", name="CE Facing")
    db.session.add_all([client, turning, facing])
    db.session.flush()
    shop = {"admin": admin, "office": office, "worker": worker, "client": client,
            "turning": turning, "facing": facing}

    # History: five Turning operations took 1.5x target; only three Facing ones.
    done = _job(shop, JobOrderStatus.DELIVERED)
    for i in range(5):
        _op(shop, done, turning, i + 1, 4, OperationStatus.COMPLETED, worked=6)
    for i in range(3):
        _op(shop, done, facing, i + 6, 2, OperationStatus.COMPLETED, worked=4)
    # Redo operations do not count toward the ratio.
    redo = _op(shop, done, turning, 9, 4, OperationStatus.COMPLETED, worked=40)
    redo.rework_of_operation_id = done.operations[0].id
    db.session.commit()
    return shop


def test_ratio_above_one_pushes_predicted_finish_later(shop):
    ratios = est.type_ratios()
    assert ratios[shop["turning"].id]["ratio"] == pytest.approx(1.5)
    assert ratios[shop["turning"].id]["enoughHistory"] is True

    job = _job(shop, JobOrderStatus.SCHEDULED)
    _op(shop, job, shop["turning"], 1, 4, OperationStatus.SCHEDULED)
    db.session.commit()

    estimate = est.predict_job(job, now=_at(MONDAY, 8))

    # Target alone would finish at 12:00; at 1.5x it takes 6 hours, around the break.
    assert datetime.fromisoformat(estimate["predictedFinish"]) == _at(MONDAY, 15)
    assert estimate["operations"][0]["ratio"] == pytest.approx(1.5)
    assert estimate["notEnoughHistoryNote"] is None


def test_type_with_fewer_than_five_samples_uses_ratio_one(shop):
    info = est.type_ratios()[shop["facing"].id]
    assert info["samples"] == 3
    assert info["enoughHistory"] is False
    assert info["ratio"] == 1.0

    job = _job(shop, JobOrderStatus.SCHEDULED)
    _op(shop, job, shop["facing"], 1, 2, OperationStatus.SCHEDULED)
    db.session.commit()

    estimate = est.predict_job(job, now=_at(MONDAY, 8))

    assert datetime.fromisoformat(estimate["predictedFinish"]) == _at(MONDAY, 10)
    assert "CE Facing" in estimate["notEnoughHistoryNote"]
    assert "1.0" in estimate["notEnoughHistoryNote"]


def test_in_progress_operation_takes_what_is_left_after_hours_worked(shop):
    job = _job(shop, JobOrderStatus.IN_PROGRESS)
    op = _op(shop, job, shop["turning"], 1, 4, OperationStatus.IN_PROGRESS)
    _op(shop, job, shop["facing"], 2, 2, OperationStatus.SCHEDULED)
    for event, hh in ((OperationTimeEvent.START, 8), (OperationTimeEvent.PAUSE, 10)):
        db.session.add(
            OperationTimeLog(operation_id=op.id, worker_id=shop["worker"].id,
                             event=event, event_at=_at(MONDAY, hh))
        )
    db.session.commit()

    estimate = est.predict_job(job, now=_at(MONDAY, 11))

    first, second = estimate["operations"]
    assert first["hoursWorked"] == pytest.approx(2)
    assert first["predictedHoursLeft"] == pytest.approx(4)  # 6 predicted - 2 worked
    # 11:00-12:00, the break, 13:00-16:00.
    assert datetime.fromisoformat(first["predictedEnd"]) == _at(MONDAY, 16)
    # Facing follows in operation order: 16:00-17:00, then 08:00-09:00 next day.
    assert datetime.fromisoformat(estimate["predictedFinish"]) == _at(
        MONDAY + timedelta(days=1), 9
    )


def test_at_risk_change_sends_one_notification(shop):
    job = _job(shop, JobOrderStatus.SCHEDULED, due=MONDAY)
    op = _op(shop, job, shop["turning"], 1, 16, OperationStatus.SCHEDULED)
    # The confirmed schedule meets the date; past performance says 24h, not 16h.
    op.scheduled_start = _at(MONDAY, 8)
    op.scheduled_end = _at(MONDAY, 17)
    db.session.commit()
    now = _at(MONDAY, 8)

    state = est.risk_state(job, now)
    assert state["basis"] == "ESTIMATE" and state["flag"] == "RED"

    assert est.sync_at_risk_alert(job, now) is True
    db.session.commit()
    alerts = StaffAlert.query.filter_by(kind=StaffAlertKind.JOB_AT_RISK, job_order_id=job.id).all()
    assert sorted(a.recipient_id for a in alerts) == sorted([shop["admin"].id, shop["office"].id])
    assert "required Aug 10, 2026" in alerts[0].message
    assert "Aug 12, 2026 17:00" in alerts[0].message  # 24h over 8h days from Monday 08:00

    # Still at risk: no second alert.
    assert est.sync_at_risk_alert(job, now) is False
    db.session.commit()
    assert StaffAlert.query.filter_by(kind=StaffAlertKind.JOB_AT_RISK).count() == 2

    # Back on time, then at risk again: one new alert each.
    job.due_date = MONDAY + timedelta(days=10)
    assert est.sync_at_risk_alert(job, now) is False
    job.due_date = MONDAY
    assert est.sync_at_risk_alert(job, now) is True
    db.session.commit()
    assert StaffAlert.query.filter_by(kind=StaffAlertKind.JOB_AT_RISK).count() == 4


def test_job_dict_shows_both_finishes_and_flags_the_later(shop):
    job = _job(shop, JobOrderStatus.SCHEDULED, due=MONDAY + timedelta(days=60))
    _op(shop, job, shop["turning"], 1, 4, OperationStatus.SCHEDULED)
    job.operations[0].scheduled_start = _at(MONDAY + timedelta(days=30), 8)
    job.operations[0].scheduled_end = _at(MONDAY + timedelta(days=30), 12)
    db.session.commit()

    data = job.to_dict(include_operations=True)

    assert data["projectedCompletion"] and data["predictedCompletion"]
    assert data["completionEstimate"]["label"] == est.LABEL
    assert data["scheduleFlag"] == "GREEN"
