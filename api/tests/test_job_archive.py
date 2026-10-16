"""Archive / unarchive completed, delivered, and cancelled jobs."""

from datetime import date, time

import pytest

from app import create_app
from app.config import Config
from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, PartCondition
from app.models.user import User, UserRole


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
        email="archive_admin@test.local",
        password_hash=bcrypt.generate_password_hash("Admin123!").decode("utf-8"),
        full_name="Admin",
        role=UserRole.ADMIN,
        active=True,
    )
    office = User(
        email="archive_office@test.local",
        password_hash=bcrypt.generate_password_hash("Office123!").decode("utf-8"),
        full_name="Office",
        role=UserRole.OFFICE_STAFF,
        active=True,
    )
    db.session.add_all([admin, office])
    db.session.flush()
    client_row = Client(name="Archive Client")
    db.session.add(client_row)
    db.session.flush()
    return {
        "admin": admin,
        "office": office,
        "client": client_row,
        "admin_token": _login(app, "archive_admin@test.local", "Admin123!"),
        "office_token": _login(app, "archive_office@test.local", "Office123!"),
    }


def _login(app, email, password):
    res = app.test_client().post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    return res.get_json()["accessToken"]


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def _job(shop, status):
    job = JobOrder(
        client_id=shop["client"].id,
        title="Archive Me",
        due_date=date(2031, 7, 1),
        status=status,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        created_by_id=shop["admin"].id,
    )
    db.session.add(job)
    db.session.flush()
    return job


def test_archive_scheduled_blocked(client, shop):
    job = _job(shop, JobOrderStatus.SCHEDULED)
    res = client.post(
        f"/api/v1/job-orders/{job.id}/archive",
        headers=_headers(shop["admin_token"]),
    )
    assert res.status_code == 409


def test_archive_completed_hides_from_default_list(client, shop):
    job = _job(shop, JobOrderStatus.COMPLETED)
    res = client.post(
        f"/api/v1/job-orders/{job.id}/archive",
        headers=_headers(shop["office_token"]),
    )
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert body["isArchived"] is True
    assert body["archivedById"] == shop["office"].id

    listed = client.get(
        "/api/v1/job-orders?scope=production",
        headers=_headers(shop["admin_token"]),
    )
    assert listed.status_code == 200
    assert job.id not in {j["id"] for j in listed.get_json()}

    archived = client.get(
        "/api/v1/job-orders?scope=archived",
        headers=_headers(shop["admin_token"]),
    )
    assert archived.status_code == 200
    assert job.id in {j["id"] for j in archived.get_json()}


def test_unarchive_restores_to_default_list(client, shop):
    job = _job(shop, JobOrderStatus.DELIVERED)
    client.post(
        f"/api/v1/job-orders/{job.id}/archive",
        headers=_headers(shop["admin_token"]),
    )
    res = client.post(
        f"/api/v1/job-orders/{job.id}/unarchive",
        headers=_headers(shop["admin_token"]),
    )
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["isArchived"] is False

    listed = client.get(
        "/api/v1/job-orders?scope=production",
        headers=_headers(shop["admin_token"]),
    )
    assert job.id in {j["id"] for j in listed.get_json()}


def test_archive_cancelled_ok(client, shop):
    job = _job(shop, JobOrderStatus.CANCELLED)
    res = client.post(
        f"/api/v1/job-orders/{job.id}/archive",
        headers=_headers(shop["admin_token"]),
    )
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["archivedAt"] is not None
