"""Request speed safeguards: the job list's query count does not grow with the
number of jobs, page-open checks never hold a request, the health check skips
the database, and slow requests are logged."""

import logging
import threading
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import event

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.operation import JobOperation, OperationStatus
from app.models.operation_time import OperationTimeEvent, OperationTimeLog
from app.models.supplier import Supplier
from app.models.user import User, UserRole, UserStatus
from app.models.worker_profile import WorkerProfile
from app.models.worker_skill import OperationType, WorkerSchedule
from app.services import overdue_delivery_service as overdue


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


def _headers(user):
    token = create_access_token(identity=user.id, additional_claims={"role": user.role.value})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def shop(app):
    admin = _user("perf_admin@test.local", UserRole.ADMIN)
    client = Client(name="Perf Client")
    db.session.add(client)
    db.session.flush()
    return {"admin_id": admin.id, "headers": _headers(admin), "client_id": client.id, "n": 0}


def _add_jobs(shop, count):
    """Released jobs that each have their own worker, operation types, supplier,
    and an operation in progress with a time log."""
    now = datetime.now(timezone.utc)
    for _ in range(count):
        shop["n"] += 1
        n = shop["n"]
        worker = _user(f"perf_worker{n}@test.local", UserRole.PRODUCTION_WORKER)
        for dow in range(6):
            db.session.add(
                WorkerSchedule(worker_id=worker.id, day_of_week=dow, is_working=True,
                               start_time=time(8, 0), end_time=time(17, 0))
            )
        supplier = Supplier(name=f"Perf Supplier {n}", typical_lead_time_days=2)
        turning = OperationType(code=f"PERF_T{n}", name=f"Perf Turning {n}")
        facing = OperationType(code=f"PERF_F{n}", name=f"Perf Facing {n}")
        db.session.add_all([supplier, turning, facing])
        db.session.flush()
        job = JobOrder(
            client_id=shop["client_id"],
            supplier_id=supplier.id,
            title=f"Perf job {n}",
            due_date=(now + timedelta(days=30)).date(),
            status=JobOrderStatus.IN_PROGRESS,
            job_type=JobType.REPAIR,
            part_condition=PartCondition.CLIENT_SUPPLIED_ITEM,
            material_status=MaterialStatus.NOT_REQUIRED,
            raw_materials=[],
            amount=Decimal("1000"),
            created_by_id=shop["admin_id"],
        )
        db.session.add(job)
        db.session.flush()
        running = JobOperation(
            job_order_id=job.id, sequence_no=1, operation_name=turning.name,
            operation_type_id=turning.id, estimated_hours=Decimal("4"),
            status=OperationStatus.IN_PROGRESS, assigned_worker_id=worker.id,
        )
        waiting = JobOperation(
            job_order_id=job.id, sequence_no=2, operation_name=facing.name,
            operation_type_id=facing.id, estimated_hours=Decimal("2"),
            status=OperationStatus.SCHEDULED, assigned_worker_id=worker.id,
        )
        db.session.add_all([running, waiting])
        db.session.flush()
        db.session.add(
            OperationTimeLog(operation_id=running.id, worker_id=worker.id,
                             event=OperationTimeEvent.START, event_at=now - timedelta(hours=1))
        )
    db.session.commit()


def _list_query_count(app, client, shop):
    count = {"n": 0}

    def _count(*_a, **_k):
        count["n"] += 1

    db.session.expunge_all()
    event.listen(db.engine, "before_cursor_execute", _count)
    try:
        r = client.get("/api/v1/job-orders?scope=production", headers=shop["headers"])
    finally:
        event.remove(db.engine, "before_cursor_execute", _count)
    assert r.status_code == 200
    return count["n"], r.get_json()


def test_job_list_query_count_does_not_grow_with_jobs(app, client, shop):
    _add_jobs(shop, 2)
    few, body = _list_query_count(app, client, shop)
    assert len(body) == 2

    _add_jobs(shop, 6)
    many, body = _list_query_count(app, client, shop)
    assert len(body) == 8

    assert many == few
    assert many <= 12
    assert all(job["predictedCompletion"] for job in body)
    assert all(job["supplierName"] for job in body)


def test_overdue_check_request_returns_without_running_the_checks(client, shop):
    r = client.post("/api/v1/supplier-orders/overdue-check", headers=shop["headers"])
    assert r.status_code == 202


def test_page_open_checks_never_wait_for_a_running_check(app, monkeypatch):
    release = threading.Event()
    started = threading.Event()
    runs = []

    def slow_overdue():
        runs.append("overdue")
        started.set()
        release.wait(5)
        return {"overdueLines": 0, "overdueOrders": 0, "movedJobs": []}

    monkeypatch.setattr(overdue, "check_overdue_deliveries", slow_overdue)
    monkeypatch.setattr(
        "app.services.completion_estimate_service.check_released_jobs", lambda: 0
    )
    monkeypatch.setattr(overdue, "_last_started", [])

    assert overdue.request_checks(app) is True
    assert started.wait(5)
    # A second page open while the first run is still going returns at once.
    assert overdue.request_checks(app) is False
    assert overdue.run_checks(app) is False
    release.set()
    for _ in range(50):
        if not overdue._run_lock.locked():
            break
        threading.Event().wait(0.05)
    # Finished, but ran moments ago: still throttled.
    assert overdue.request_checks(app) is False
    assert runs == ["overdue"]

    monkeypatch.setattr(overdue, "_last_started", [0.0])
    monkeypatch.setattr(overdue.time, "monotonic", lambda: overdue.CHECK_INTERVAL_SECONDS + 1.0)
    assert overdue.request_checks(app) is True
    for _ in range(50):
        if len(runs) == 2 and not overdue._run_lock.locked():
            break
        threading.Event().wait(0.05)
    assert runs == ["overdue", "overdue"]


def test_health_check_answers_without_the_database(app, client):
    count = {"n": 0}

    def _count(*_a, **_k):
        count["n"] += 1

    event.listen(db.engine, "before_cursor_execute", _count)
    try:
        r = client.get("/api/v1/health")
        head = client.head("/api/v1/health")
    finally:
        event.remove(db.engine, "before_cursor_execute", _count)
    assert r.status_code == 200
    assert r.get_json() == {"status": "ok"}
    assert head.status_code == 200
    assert count["n"] == 0


def test_slow_requests_are_logged_with_path_status_duration_and_queries(app, client, shop, caplog):
    _add_jobs(shop, 2)
    app.config["SLOW_REQUEST_SECONDS"] = 0.0

    with caplog.at_level(logging.WARNING, logger=app.logger.name):
        expected_queries, _ = _list_query_count(app, client, shop)
    lines = [rec.getMessage() for rec in caplog.records if "slow_request" in rec.getMessage()]
    assert len(lines) == 1
    assert "method=GET path=/api/v1/job-orders status=200 duration_ms=" in lines[0]
    assert f"queries={expected_queries}" in lines[0]


def test_fast_requests_are_not_logged_as_slow(client, caplog):
    with caplog.at_level(logging.WARNING):
        client.get("/api/v1/health")
    assert not [rec for rec in caplog.records if "slow_request" in rec.getMessage()]
