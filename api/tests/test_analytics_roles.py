"""Role-based analytics (objective 4.1), enforced on the server.

Uses the bmsc_test database from conftest (schema built from the models).
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.operation import JobOperation, OperationStatus
from app.models.user import User, UserRole, UserStatus
from app.models.worker_profile import WorkerProfile
from app.services.schedule_calendar import shop_now

PASSWORD = "Passw0rd!"

PRODUCTION_ONLY = [
    "/api/v1/analytics/overview",
    "/api/v1/analytics/efficiency/by-worker",
    "/api/v1/analytics/efficiency/by-operation-type",
    "/api/v1/analytics/efficiency/by-machine",
    "/api/v1/analytics/efficiency/trend",
    "/api/v1/analytics/delays",
    "/api/v1/analytics/demand/capacity",
]
TRANSACTIONS = [
    "/api/v1/analytics/job-orders",
    "/api/v1/analytics/sales/summary",
    "/api/v1/analytics/sales/forecast",
    "/api/v1/analytics/demand/forecast",
    "/api/v1/analytics/consumables/run-out",
    "/api/v1/analytics/purchasing",
    "/api/v1/suppliers/reliability",
]


def _user(email, role, name):
    user = User(
        email=email,
        password_hash=bcrypt.generate_password_hash(PASSWORD).decode("utf-8"),
        full_name=name,
        role=role,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    db.session.flush()
    if role == UserRole.PRODUCTION_WORKER:
        db.session.add(WorkerProfile(user_id=user.id))
    return user


def _headers(client, email):
    res = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert res.status_code == 200, res.get_json()
    return {"Authorization": f"Bearer {res.get_json()['accessToken']}"}


@pytest.fixture
def shop(app):
    with app.app_context():
        office = _user("office@roles.test", UserRole.OFFICE_STAFF, "Office Person")
        _user("admin@roles.test", UserRole.ADMIN, "Admin Person")
        ana = _user("ana@roles.test", UserRole.PRODUCTION_WORKER, "Ana Worker")
        ben = _user("ben@roles.test", UserRole.PRODUCTION_WORKER, "Ben Worker")
        cust = Client(name="Roles Client")
        db.session.add(cust)
        db.session.flush()
        job = JobOrder(
            client_id=cust.id,
            title="Roles job",
            due_date=date.today() + timedelta(days=30),
            status=JobOrderStatus.IN_PROGRESS,
            job_type=JobType.REPAIR,
            part_condition=PartCondition.CLIENT_SUPPLIED_ITEM,
            material_status=MaterialStatus.NOT_REQUIRED,
            raw_materials=[],
            amount=Decimal("1000"),
            created_by_id=office.id,
        )
        db.session.add(job)
        db.session.flush()
        finished_at = shop_now() - timedelta(minutes=1)

        def done(worker, seq, target, worked, redo_of=None):
            op = JobOperation(
                job_order_id=job.id,
                sequence_no=seq,
                operation_name=f"Op {seq}",
                assigned_worker_id=worker.id,
                estimated_hours=Decimal(str(target)) if target is not None else None,
                actual_worked_hours=Decimal(str(worked)),
                variance_pct=(
                    Decimal(str((worked - target) / target * 100)) if target is not None else None
                ),
                actual_start=finished_at - timedelta(hours=worked),
                actual_end=finished_at,
                status=OperationStatus.COMPLETED,
                rework_of_operation_id=redo_of,
            )
            db.session.add(op)
            db.session.flush()
            return op

        first = done(ana, 1, 4, 5)
        done(ana, 2, 4, 5)
        done(ana, 3, None, 1, redo_of=first.id)
        done(ben, 4, 10, 2)
        db.session.commit()
        ids = {"ana": ana.id, "ben": ben.id}
        db.session.expunge_all()
        return ids


def test_office_staff_are_refused_per_worker_efficiency(client, shop):
    office = _headers(client, "office@roles.test")
    for url in PRODUCTION_ONLY:
        res = client.get(url, headers=office)
        assert res.status_code == 403, url
        assert "Ana Worker" not in res.get_data(as_text=True)
    for url in TRANSACTIONS:
        assert client.get(url, headers=office).status_code == 200, url


def test_admin_sees_production_and_transactions(client, shop):
    admin = _headers(client, "admin@roles.test")
    for url in PRODUCTION_ONLY + TRANSACTIONS:
        assert client.get(url, headers=admin).status_code == 200, url
    names = {w["workerName"] for w in client.get(
        "/api/v1/analytics/efficiency/by-worker?minOps=1", headers=admin
    ).get_json()["workers"]}
    assert {"Ana Worker", "Ben Worker"} <= names


def test_worker_sees_only_their_own_figures(client, shop):
    ana = _headers(client, "ana@roles.test")
    res = client.get(f"/api/v1/analytics/me?workerId={shop['ben']}", headers=ana)
    assert res.status_code == 200
    body = res.get_json()
    for period in ("thisWeek", "thisMonth"):
        figures = body[period]
        assert figures["finishedOperations"] == 3
        assert figures["redoOperations"] == 1
        assert figures["hoursWorked"] == 11.0
        assert figures["targetHours"] == 8.0
        assert figures["laborEfficiencyPct"] == 80.0
    text = res.get_data(as_text=True)
    assert shop["ben"] not in text and "Ben" not in text

    ben = client.get("/api/v1/analytics/me", headers=_headers(client, "ben@roles.test")).get_json()
    assert ben["thisWeek"]["finishedOperations"] == 1
    assert ben["thisWeek"]["laborEfficiencyPct"] == 500.0

    for url in PRODUCTION_ONLY + TRANSACTIONS:
        assert client.get(url, headers=ana).status_code == 403, url


def test_my_summary_is_for_workers_only(client, shop):
    for email in ("admin@roles.test", "office@roles.test"):
        assert client.get("/api/v1/analytics/me", headers=_headers(client, email)).status_code == 403


def test_job_orders_summary_counts_received_and_open(client, shop):
    body = client.get(
        "/api/v1/analytics/job-orders", headers=_headers(client, "office@roles.test")
    ).get_json()
    assert body["received"]["count"] == 1
    assert body["openNow"]["byStatus"]["IN_PROGRESS"] == 1
    assert body["delivered"]["count"] == 0
