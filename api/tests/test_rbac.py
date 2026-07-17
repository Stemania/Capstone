from datetime import date

import pytest

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus
from app.models.operation import Operation, OperationStatus
from app.models.user import User, UserRole
from app.models.worker_profile import WorkerProfile


def _login(client, email, password):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def _auth_header(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def seeded_users(app):
    with app.app_context():
        admin = User(
            email="admin@test.local",
            password_hash=bcrypt.generate_password_hash("Admin123!").decode("utf-8"),
            full_name="Admin",
            role=UserRole.ADMIN,
            active=True,
        )
        worker1 = User(
            email="worker1@test.local",
            password_hash=bcrypt.generate_password_hash("Worker123!").decode("utf-8"),
            full_name="Worker One",
            role=UserRole.PRODUCTION_WORKER,
            active=True,
        )
        worker2 = User(
            email="worker2@test.local",
            password_hash=bcrypt.generate_password_hash("Worker123!").decode("utf-8"),
            full_name="Worker Two",
            role=UserRole.PRODUCTION_WORKER,
            active=True,
        )
        office = User(
            email="office@test.local",
            password_hash=bcrypt.generate_password_hash("Office123!").decode("utf-8"),
            full_name="Office",
            role=UserRole.OFFICE_STAFF,
            active=True,
        )
        db.session.add_all([admin, worker1, worker2, office])
        db.session.flush()
        db.session.add(WorkerProfile(user_id=worker1.id, skills=["milling"]))
        db.session.add(WorkerProfile(user_id=worker2.id, skills=["welding"]))
        client = Client(name="Test Client")
        db.session.add(client)
        db.session.commit()
        return {
            "admin": admin,
            "worker1": worker1,
            "worker2": worker2,
            "office": office,
            "client": client,
        }


def test_worker_cannot_access_other_workers_job(client, app, seeded_users):
    with app.app_context():
        job = JobOrder(
            client_id=seeded_users["client"].id,
            title="Private Job",
            due_date=date(2026, 8, 1),
            status=JobOrderStatus.ASSIGNED,
            assigned_worker_id=seeded_users["worker2"].id,
            created_by_id=seeded_users["office"].id,
        )
        db.session.add(job)
        db.session.commit()
        job_id = job.id

    login = _login(client, "worker1@test.local", "Worker123!")
    token = login.get_json()["accessToken"]

    response = client.get(f"/api/v1/job-orders/{job_id}", headers=_auth_header(token))
    assert response.status_code == 403


def test_operation_start_is_idempotent(client, app, seeded_users):
    with app.app_context():
        job = JobOrder(
            client_id=seeded_users["client"].id,
            title="Worker Job",
            due_date=date(2026, 8, 1),
            status=JobOrderStatus.ASSIGNED,
            assigned_worker_id=seeded_users["worker1"].id,
            created_by_id=seeded_users["office"].id,
        )
        db.session.add(job)
        db.session.flush()
        op = Operation(job_order_id=job.id, seq=1, name="Milling", status=OperationStatus.PENDING)
        db.session.add(op)
        db.session.commit()
        op_id = op.id

    login = _login(client, "worker1@test.local", "Worker123!")
    token = login.get_json()["accessToken"]
    headers = _auth_header(token)
    ts = "2026-07-16T14:30:00Z"

    r1 = client.post(f"/api/v1/operations/{op_id}/start", json={"timestamp": ts}, headers=headers)
    r2 = client.post(f"/api/v1/operations/{op_id}/start", json={"timestamp": ts}, headers=headers)

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.get_json()["startedAt"] == r2.get_json()["startedAt"]
