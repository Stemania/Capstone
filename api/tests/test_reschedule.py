"""Admin Reschedule: required reason, audit row, non-Admin blocked.

Runs against the test database inside a transaction that is always rolled back.
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
from app.models.schedule_move import DelayKind, ScheduleMove
from app.models.user import User, UserRole
from app.models.worker_skill import WorkerSchedule
from app.services.schedule_calendar import shop_local_to_utc

MONDAY = date(2031, 3, 10)


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
        email="resched_reason_admin@test.local",
        password_hash=bcrypt.generate_password_hash("Admin123!").decode("utf-8"),
        full_name="Admin",
        role=UserRole.ADMIN,
        active=True,
    )
    office = User(
        email="resched_reason_office@test.local",
        password_hash=bcrypt.generate_password_hash("Office123!").decode("utf-8"),
        full_name="Office",
        role=UserRole.OFFICE_STAFF,
        active=True,
    )
    worker = User(
        email="resched_reason_worker@test.local",
        password_hash=bcrypt.generate_password_hash("Worker123!").decode("utf-8"),
        full_name="Worker",
        role=UserRole.PRODUCTION_WORKER,
        active=True,
    )
    db.session.add_all([admin, office, worker])
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
    client_row = Client(name="Reschedule Reason Client")
    db.session.add(client_row)
    db.session.flush()

    job = JobOrder(
        client_id=client_row.id,
        title="Reschedule Reason Job",
        due_date=date(2031, 4, 1),
        status=JobOrderStatus.SCHEDULED,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        created_by_id=admin.id,
    )
    db.session.add(job)
    db.session.flush()
    waiting = JobOperation(
        job_order_id=job.id,
        sequence_no=1,
        operation_name="Turning",
        assigned_worker_id=worker.id,
        estimated_hours=Decimal("2"),
        status=OperationStatus.SCHEDULED,
        scheduled_start=shop_local_to_utc(MONDAY, time(13, 0)),
        scheduled_end=shop_local_to_utc(MONDAY, time(15, 0)),
    )
    db.session.add(waiting)
    db.session.flush()

    admin_token = _login(app, "resched_reason_admin@test.local", "Admin123!")
    office_token = _login(app, "resched_reason_office@test.local", "Office123!")
    return {
        "job": job,
        "waiting": waiting,
        "admin": admin,
        "admin_token": admin_token,
        "office_token": office_token,
    }


def _login(app, email, password):
    res = app.test_client().post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    return res.get_json()["accessToken"]


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def _iso(d, t):
    return shop_local_to_utc(d, t).isoformat()


def _ops_body(shop, start=time(14, 0), end=time(16, 0)):
    return [
        {
            "id": shop["waiting"].id,
            "scheduledStart": _iso(MONDAY, start),
            "scheduledEnd": _iso(MONDAY, end),
            "assignedWorkerId": shop["waiting"].assigned_worker_id,
        }
    ]


def test_reschedule_without_reason_rejected(client, shop):
    res = client.post(
        f"/api/v1/job-orders/{shop['job'].id}/schedule/reschedule",
        headers=_headers(shop["admin_token"]),
        json={"operations": _ops_body(shop)},
    )
    assert res.status_code == 400
    assert res.get_json()["error"]["code"] == "VALIDATION_ERROR"


def test_reschedule_other_requires_note(client, shop):
    res = client.post(
        f"/api/v1/job-orders/{shop['job'].id}/schedule/reschedule",
        headers=_headers(shop["admin_token"]),
        json={"operations": _ops_body(shop), "reason": "OTHER"},
    )
    assert res.status_code == 400
    assert "note" in res.get_json()["error"]["message"].lower()


def test_reschedule_with_reason_applied_and_logged(client, shop):
    res = client.post(
        f"/api/v1/job-orders/{shop['job'].id}/schedule/reschedule",
        headers=_headers(shop["admin_token"]),
        json={
            "operations": _ops_body(shop),
            "reason": "WORKER_ABSENT",
            "note": "Out sick",
        },
    )
    assert res.status_code == 200, res.get_json()
    db.session.refresh(shop["waiting"])
    assert shop["waiting"].scheduled_start.astimezone(timezone.utc) == shop_local_to_utc(
        MONDAY, time(14, 0)
    )
    move = ScheduleMove.query.filter_by(job_order_id=shop["job"].id).one()
    assert move.kind == DelayKind.RESCHEDULED
    assert move.reason == "WORKER_ABSENT"
    assert move.note == "Out sick"
    assert move.moved_by_id == shop["admin"].id
    assert move.changes is not None
    assert move.changes.get("operations")

    hist = client.get(
        f"/api/v1/job-orders/{shop['job'].id}/schedule-moves",
        headers=_headers(shop["admin_token"]),
    )
    assert hist.status_code == 200
    rows = hist.get_json()
    assert len(rows) == 1
    assert rows[0]["reason"] == "WORKER_ABSENT"
    assert rows[0]["movedById"] == shop["admin"].id


def test_reschedule_non_admin_blocked(client, shop):
    res = client.post(
        f"/api/v1/job-orders/{shop['job'].id}/schedule/reschedule",
        headers=_headers(shop["office_token"]),
        json={"operations": _ops_body(shop), "reason": "WORKER_ABSENT"},
    )
    assert res.status_code == 403
