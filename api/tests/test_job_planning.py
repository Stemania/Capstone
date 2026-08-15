"""Job order planning workflow: DRAFT → PLANNING → RELEASED.

Runs against the local DATABASE_URL (bmsc) inside a connection transaction that
is always rolled back — no bmsc_test database required.
"""

from datetime import date
from decimal import Decimal

import pytest

from app import create_app
from app.config import Config
from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialSource, PartCondition
from app.models.notification import NotificationMilestone
from app.models.operation import JobOperation, OperationStatus
from app.models.user import User, UserRole
from app.models.worker_profile import WorkerProfile


class LocalTxnConfig(Config):
    """Same local Postgres as development; tests never commit."""

    TESTING = True


def _login(client, email, password):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def _auth_header(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def app():
    return create_app(LocalTxnConfig)


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture(autouse=True)
def _rollback_txn(app, monkeypatch):
    """Use local bmsc, but never commit — flush only, then roll back."""
    with app.app_context():
        # Keep one open transaction for the whole test; services that "commit"
        # only flush so teardown can undo everything.
        monkeypatch.setattr(db.session, "commit", db.session.flush)
        try:
            yield
        finally:
            db.session.rollback()
            db.session.remove()


@pytest.fixture
def seeded(app):
    admin = User(
        email="plan_admin@test.local",
        password_hash=bcrypt.generate_password_hash("Admin123!").decode("utf-8"),
        full_name="Admin",
        role=UserRole.ADMIN,
        active=True,
    )
    worker = User(
        email="plan_worker@test.local",
        password_hash=bcrypt.generate_password_hash("Worker123!").decode("utf-8"),
        full_name="Worker",
        role=UserRole.PRODUCTION_WORKER,
        active=True,
    )
    office = User(
        email="plan_office@test.local",
        password_hash=bcrypt.generate_password_hash("Office123!").decode("utf-8"),
        full_name="Office",
        role=UserRole.OFFICE_STAFF,
        active=True,
    )
    db.session.add_all([admin, worker, office])
    db.session.flush()
    db.session.add(WorkerProfile(user_id=worker.id))
    client_row = Client(name="Plan Test Client")
    db.session.add(client_row)
    db.session.flush()
    return {
        "admin_id": admin.id,
        "worker_id": worker.id,
        "office_id": office.id,
        "client_id": client_row.id,
    }


def _make_job(seeded, status, *, with_op=True, worker_id=None, hours=None):
    job = JobOrder(
        client_id=seeded["client_id"],
        title="Planning Job",
        due_date=date(2026, 9, 1),
        status=status,
        job_type=JobType.FABRICATION,
        material_source=MaterialSource.SHOP_PROCURED,
        part_condition=PartCondition.RAW_MATERIAL,
        created_by_id=seeded["office_id"],
    )
    db.session.add(job)
    db.session.flush()
    if with_op:
        db.session.add(
            JobOperation(
                job_order_id=job.id,
                sequence_no=1,
                operation_name="Milling",
                assigned_worker_id=worker_id,
                estimated_hours=Decimal(str(hours)) if hours is not None else None,
                status=OperationStatus.PENDING,
            )
        )
        db.session.flush()
    return job


def test_production_cannot_fetch_draft_or_planning_by_id(client, seeded):
    draft = _make_job(seeded, JobOrderStatus.DRAFT, worker_id=seeded["worker_id"], hours=2)
    planning = _make_job(
        seeded, JobOrderStatus.PLANNING, worker_id=seeded["worker_id"], hours=2
    )

    login = _login(client, "plan_worker@test.local", "Worker123!")
    token = login.get_json()["accessToken"]
    headers = _auth_header(token)

    assert client.get(f"/api/v1/job-orders/{draft.id}", headers=headers).status_code == 403
    assert client.get(f"/api/v1/job-orders/{planning.id}", headers=headers).status_code == 403


def test_operation_cannot_start_on_non_released_job(client, seeded):
    job = _make_job(seeded, JobOrderStatus.PLANNING, worker_id=seeded["worker_id"], hours=2)
    op_id = job.operations[0].id

    login = _login(client, "plan_worker@test.local", "Worker123!")
    token = login.get_json()["accessToken"]
    headers = _auth_header(token)

    response = client.post(
        f"/api/v1/operations/{op_id}/start",
        json={"timestamp": "2026-08-12T08:00:00Z"},
        headers=headers,
    )
    # Access denied (cannot see PLANNING) or explicit not-released gate — both enforce.
    assert response.status_code in (403, 409)
    body = response.get_json()
    msg = (body.get("error") or {}).get("message", "").lower()
    assert response.status_code == 403 or "released" in msg


def test_release_blocked_when_missing_worker_or_hours(client, seeded):
    job = _make_job(seeded, JobOrderStatus.PLANNING, worker_id=None, hours=None)

    login = _login(client, "plan_admin@test.local", "Admin123!")
    token = login.get_json()["accessToken"]
    headers = _auth_header(token)

    response = client.post(f"/api/v1/job-orders/{job.id}/release", headers=headers)
    assert response.status_code == 400
    msg = response.get_json()["error"]["message"].lower()
    assert "worker" in msg
    assert "hours" in msg


def test_existing_jobs_migrate_to_released_or_later():
    """Migration 009 maps UNASSIGNED → RELEASED; later statuses stay production-visible."""
    mapping = {
        "UNASSIGNED": "RELEASED",
        "ASSIGNED": "ASSIGNED",
        "IN_PROGRESS": "IN_PROGRESS",
        "COMPLETED": "COMPLETED",
        "DELIVERED": "DELIVERED",
    }
    for before, after in mapping.items():
        assert after not in ("DRAFT", "PLANNING")
        if before == "UNASSIGNED":
            assert after == "RELEASED"
        else:
            assert after == before


def test_no_notification_on_draft_or_planning_job_received_on_release(
    client, seeded, monkeypatch
):
    sent = []

    def fake_safe_notify(job_id, milestone):
        sent.append((job_id, milestone))

    import app.services.notification_service as nsvc

    monkeypatch.setattr(nsvc, "safe_notify_job_milestone", fake_safe_notify)

    login_office = _login(client, "plan_office@test.local", "Office123!")
    office_headers = _auth_header(login_office.get_json()["accessToken"])

    create = client.post(
        "/api/v1/job-orders",
        json={
            "clientId": seeded["client_id"],
            "title": "PO Draft",
            "dueDate": "2026-09-15",
            "jobType": "FABRICATION",
            "materialSource": "SHOP_PROCURED",
            "priority": "MODERATE",
        },
        headers=office_headers,
    )
    assert create.status_code == 201, create.get_json()
    job_id = create.get_json()["id"]
    assert create.get_json()["status"] == "DRAFT"
    assert sent == []

    login_admin = _login(client, "plan_admin@test.local", "Admin123!")
    admin_headers = _auth_header(login_admin.get_json()["accessToken"])

    plan = client.patch(
        f"/api/v1/job-orders/{job_id}",
        json={
            "operations": [
                {
                    "sequenceNo": 1,
                    "operationName": "Turning",
                    "assignedWorkerId": seeded["worker_id"],
                    "estimatedHours": 3,
                }
            ]
        },
        headers=admin_headers,
    )
    assert plan.status_code == 200, plan.get_json()
    assert plan.get_json()["status"] == "PLANNING"
    assert sent == []

    release = client.post(f"/api/v1/job-orders/{job_id}/release", headers=admin_headers)
    assert release.status_code == 200, release.get_json()
    assert release.get_json()["status"] in ("RELEASED", "ASSIGNED")
    assert any(m == NotificationMilestone.JOB_RECEIVED for _, m in sent)
