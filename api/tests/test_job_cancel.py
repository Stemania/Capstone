"""Cancel job order: reason required, frees schedule, no hard delete."""

from datetime import date, time, timezone
from decimal import Decimal

import pytest

from app import create_app
from app.config import Config
from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, PartCondition
from app.models.operation import JobOperation, OperationStatus
from app.models.user import User, UserRole
from app.models.worker_skill import WorkerSchedule
from app.services.schedule_calendar import shop_local_to_utc

MONDAY = date(2031, 5, 12)


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
        email="cancel_admin@test.local",
        password_hash=bcrypt.generate_password_hash("Admin123!").decode("utf-8"),
        full_name="Admin",
        role=UserRole.ADMIN,
        active=True,
    )
    office = User(
        email="cancel_office@test.local",
        password_hash=bcrypt.generate_password_hash("Office123!").decode("utf-8"),
        full_name="Office",
        role=UserRole.OFFICE_STAFF,
        active=True,
    )
    worker = User(
        email="cancel_worker@test.local",
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
    client_row = Client(name="Cancel Client")
    db.session.add(client_row)
    db.session.flush()
    return {
        "admin": admin,
        "office": office,
        "worker": worker,
        "client": client_row,
        "admin_token": _login(app, "cancel_admin@test.local", "Admin123!"),
        "office_token": _login(app, "cancel_office@test.local", "Office123!"),
    }


def _login(app, email, password):
    res = app.test_client().post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    return res.get_json()["accessToken"]


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def _job(shop, status=JobOrderStatus.SCHEDULED):
    job = JobOrder(
        client_id=shop["client"].id,
        title="Cancel Me",
        due_date=date(2031, 6, 1),
        status=status,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        created_by_id=shop["admin"].id,
    )
    db.session.add(job)
    db.session.flush()
    return job


def test_delete_endpoint_removed(client, shop):
    job = _job(shop, status=JobOrderStatus.DRAFT)
    db.session.flush()
    res = client.delete(
        f"/api/v1/job-orders/{job.id}", headers=_headers(shop["admin_token"])
    )
    assert res.status_code == 405
    assert db.session.get(JobOrder, job.id) is not None


def test_cancel_without_reason_rejected(client, shop):
    job = _job(shop)
    db.session.flush()
    res = client.post(
        f"/api/v1/job-orders/{job.id}/cancel",
        headers=_headers(shop["admin_token"]),
        json={},
    )
    assert res.status_code == 400


def test_cancel_other_requires_note(client, shop):
    job = _job(shop)
    db.session.flush()
    res = client.post(
        f"/api/v1/job-orders/{job.id}/cancel",
        headers=_headers(shop["office_token"]),
        json={"reason": "OTHER"},
    )
    assert res.status_code == 400
    assert "note" in res.get_json()["error"]["message"].lower()


def test_cancel_scheduled_frees_slots_and_keeps_row(client, shop):
    job = _job(shop)
    op = JobOperation(
        job_order_id=job.id,
        sequence_no=1,
        operation_name="Turning",
        assigned_worker_id=shop["worker"].id,
        estimated_hours=Decimal("2"),
        status=OperationStatus.SCHEDULED,
        scheduled_start=shop_local_to_utc(MONDAY, time(9, 0)),
        scheduled_end=shop_local_to_utc(MONDAY, time(11, 0)),
    )
    db.session.add(op)
    db.session.flush()

    res = client.post(
        f"/api/v1/job-orders/{job.id}/cancel",
        headers=_headers(shop["office_token"]),
        json={"reason": "CLIENT_CANCELLED", "note": "Client pulled the PO"},
    )
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert body["status"] == "CANCELLED"
    assert body["cancelReason"] == "CLIENT_CANCELLED"
    assert body["cancelledById"] == shop["office"].id

    db.session.refresh(job)
    db.session.refresh(op)
    assert job.status == JobOrderStatus.CANCELLED
    assert op.scheduled_start is None
    assert op.assigned_worker_id is None
    assert op.status == OperationStatus.PENDING


def test_cancel_completed_blocked(client, shop):
    job = _job(shop, status=JobOrderStatus.COMPLETED)
    db.session.flush()
    res = client.post(
        f"/api/v1/job-orders/{job.id}/cancel",
        headers=_headers(shop["admin_token"]),
        json={"reason": "CLIENT_CANCELLED"},
    )
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "INVALID_TRANSITION"


def test_draft_cancel_works(client, shop):
    job = _job(shop, status=JobOrderStatus.DRAFT)
    db.session.flush()
    res = client.post(
        f"/api/v1/job-orders/{job.id}/cancel",
        headers=_headers(shop["admin_token"]),
        json={"reason": "DUPLICATE_OR_ENCODING_ERROR"},
    )
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["status"] == "CANCELLED"
    assert db.session.get(JobOrder, job.id) is not None
