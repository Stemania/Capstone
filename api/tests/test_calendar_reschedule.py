"""Re-proposing released jobs after a work-calendar change.

Runs against the local DATABASE_URL inside a transaction that is always rolled back.
"""

from datetime import date, datetime, time, timezone
from decimal import Decimal

import pytest

from app import create_app
from app.config import Config
from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, PartCondition
from app.models.operation import JobOperation, OperationStatus
from app.models.user import User, UserRole
from app.models.worker_skill import (
    CalendarExceptionType,
    WorkCalendarException,
    WorkerSchedule,
)
from app.services.schedule_calendar import shop_local_to_utc
from app.services.worker_profile_service import calendar_exception_delete_impact

# Far-future dates so seeded or real data on the local database cannot collide.
MONDAY = date(2031, 3, 10)
SATURDAY = date(2031, 3, 8)


class LocalTxnConfig(Config):
    TESTING = True
    RATELIMIT_ENABLED = False
    RATELIMIT_STORAGE_URI = "memory://"


@pytest.fixture
def app():
    return create_app(LocalTxnConfig)


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture(autouse=True)
def _rollback_txn(app, monkeypatch):
    with app.app_context():
        monkeypatch.setattr(db.session, "commit", db.session.flush)
        try:
            yield
        finally:
            db.session.rollback()
            db.session.remove()


@pytest.fixture
def shop(app):
    admin = User(
        email="resched_admin@test.local",
        password_hash=bcrypt.generate_password_hash("Admin123!").decode("utf-8"),
        full_name="Admin",
        role=UserRole.ADMIN,
        active=True,
    )
    worker = User(
        email="resched_worker@test.local",
        password_hash=bcrypt.generate_password_hash("Worker123!").decode("utf-8"),
        full_name="Worker",
        role=UserRole.PRODUCTION_WORKER,
        active=True,
    )
    db.session.add_all([admin, worker])
    db.session.flush()
    for dow in range(6):
        db.session.add(
            WorkerSchedule(
                worker_id=worker.id,
                day_of_week=dow,
                is_working=True,
                start_time=time(8, 0),
                end_time=time(17, 0),
            )
        )
    client_row = Client(name="Reschedule Client")
    db.session.add(client_row)
    db.session.flush()

    job = JobOrder(
        client_id=client_row.id,
        title="Reschedule Job",
        due_date=date(2031, 4, 1),
        status=JobOrderStatus.IN_PROGRESS,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        created_by_id=admin.id,
    )
    db.session.add(job)
    db.session.flush()
    started = JobOperation(
        job_order_id=job.id,
        sequence_no=1,
        operation_name="Turning",
        assigned_worker_id=worker.id,
        estimated_hours=Decimal("4"),
        status=OperationStatus.IN_PROGRESS,
        actual_start=shop_local_to_utc(MONDAY, time(8, 0)),
        scheduled_start=shop_local_to_utc(MONDAY, time(8, 0)),
        scheduled_end=shop_local_to_utc(MONDAY, time(12, 0)),
    )
    waiting = JobOperation(
        job_order_id=job.id,
        sequence_no=2,
        operation_name="Facing",
        assigned_worker_id=worker.id,
        estimated_hours=Decimal("2"),
        status=OperationStatus.SCHEDULED,
        scheduled_start=shop_local_to_utc(MONDAY, time(13, 0)),
        scheduled_end=shop_local_to_utc(MONDAY, time(15, 0)),
    )
    db.session.add_all([started, waiting])
    db.session.flush()

    token = client_login(app, "resched_admin@test.local", "Admin123!")
    return {"job": job, "started": started, "waiting": waiting, "token": token}


def client_login(app, email, password):
    res = app.test_client().post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    return res.get_json()["accessToken"]


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def _iso(d, t):
    return shop_local_to_utc(d, t).isoformat()


def test_affected_jobs_lists_only_not_started_operations(client, shop):
    res = client.get(
        f"/api/v1/calendar/affected-jobs?from={MONDAY.isoformat()}",
        headers=_headers(shop["token"]),
    )
    assert res.status_code == 200
    jobs = [j for j in res.get_json()["jobs"] if j["jobOrderId"] == shop["job"].id]
    assert len(jobs) == 1
    assert [op["id"] for op in jobs[0]["operations"]] == [shop["waiting"].id]


def test_apply_refuses_to_move_in_progress_operation(client, shop):
    res = client.post(
        f"/api/v1/job-orders/{shop['job'].id}/schedule/apply",
        headers=_headers(shop["token"]),
        json={
            "operations": [
                {
                    "id": shop["started"].id,
                    "scheduledStart": _iso(MONDAY, time(9, 0)),
                    "scheduledEnd": _iso(MONDAY, time(13, 0)),
                }
            ]
        },
    )
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "OPERATION_STARTED"


def test_apply_moves_only_not_started_operations(client, shop):
    res = client.post(
        f"/api/v1/job-orders/{shop['job'].id}/schedule/apply",
        headers=_headers(shop["token"]),
        json={
            "operations": [
                {
                    # Unchanged in-progress window is accepted and left alone.
                    "id": shop["started"].id,
                    "scheduledStart": _iso(MONDAY, time(8, 0)),
                    "scheduledEnd": _iso(MONDAY, time(12, 0)),
                },
                {
                    "id": shop["waiting"].id,
                    "scheduledStart": _iso(MONDAY, time(14, 0)),
                    "scheduledEnd": _iso(MONDAY, time(16, 0)),
                },
            ]
        },
    )
    assert res.status_code == 200, res.get_json()
    db.session.refresh(shop["waiting"])
    db.session.refresh(shop["started"])
    assert shop["waiting"].scheduled_start.astimezone(timezone.utc) == shop_local_to_utc(
        MONDAY, time(14, 0)
    )
    assert shop["started"].status == OperationStatus.IN_PROGRESS
    assert shop["started"].scheduled_start.astimezone(timezone.utc) == shop_local_to_utc(
        MONDAY, time(8, 0)
    )


def test_apply_refuses_window_outside_working_hours(client, shop):
    res = client.post(
        f"/api/v1/job-orders/{shop['job'].id}/schedule/apply",
        headers=_headers(shop["token"]),
        json={
            "operations": [
                {
                    "id": shop["waiting"].id,
                    "scheduledStart": _iso(MONDAY, time(17, 0)),
                    "scheduledEnd": _iso(MONDAY, time(19, 0)),
                },
            ]
        },
    )
    assert res.status_code == 409, res.get_json()
    assert res.get_json()["error"]["code"] == "SCHEDULE_INVALID"


def test_removal_warning_ignores_overnight_work_outside_removed_hours(shop):
    exc = WorkCalendarException(
        date=MONDAY,
        type=CalendarExceptionType.OVERTIME,
        start_time=time(17, 0),
        end_time=time(20, 0),
    )
    db.session.add(exc)
    # Saturday 16:00 → Monday 10:00: its Monday work is 08:00–10:00, not overtime.
    shop["waiting"].scheduled_start = shop_local_to_utc(SATURDAY, time(16, 0))
    shop["waiting"].scheduled_end = shop_local_to_utc(MONDAY, time(10, 0))
    # 17:00–19:00 on Monday is inside the overtime being removed.
    shop["started"].scheduled_start = shop_local_to_utc(MONDAY, time(17, 0))
    shop["started"].scheduled_end = shop_local_to_utc(MONDAY, time(19, 0))
    db.session.flush()

    impact = calendar_exception_delete_impact(exc.id)
    ids = {op["id"] for op in impact["affectedOperations"]}
    assert shop["started"].id in ids
    assert shop["waiting"].id not in ids
