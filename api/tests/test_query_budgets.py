"""Regression: job-order detail and sales analytics stay under query budgets."""

from datetime import datetime, time, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import event

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import (
    JobOrder,
    JobOrderStatus,
    JobPriority,
    JobType,
    PartCondition,
)
from app.models.machine import MachineType, MachineUnit
from app.models.operation import JobOperation, OperationStatus
from app.models.operation_time import OperationTimeEvent, OperationTimeLog
from app.models.user import User, UserRole, UserStatus
from app.models.worker_skill import OperationType, WorkerSchedule
from app.services import analytics_service as analytics
from app.services import job_order_service as jo_service
from app.services.schedule_calendar import shop_now


def _count_queries(fn):
    queries = []

    def before(conn, cursor, statement, parameters, context, executemany):
        queries.append(statement)

    eng = db.engine
    event.listen(eng, "before_cursor_execute", before)
    try:
        result = fn()
    finally:
        event.remove(eng, "before_cursor_execute", before)
    return result, len(queries)


def _seed_detail_fixture():
    admin = User(
        email="qcount_admin@test.local",
        mobile_number="09170000001",
        password_hash=bcrypt.generate_password_hash("x").decode(),
        full_name="Admin",
        role=UserRole.ADMIN,
        status=UserStatus.ACTIVE,
        active=True,
    )
    worker = User(
        email="qcount_worker@test.local",
        mobile_number="09170000002",
        password_hash=bcrypt.generate_password_hash("x").decode(),
        full_name="Worker",
        role=UserRole.PRODUCTION_WORKER,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add_all([admin, worker])
    db.session.flush()
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
    client = Client(name="QC Client", contact="c", email="qc@test.local")
    db.session.add(client)
    db.session.flush()
    mt = MachineType(code="QC_LATHE", name="Lathe", units=1)
    db.session.add(mt)
    db.session.flush()
    unit = MachineUnit(machine_type_id=mt.id, label="Lathe #1", active=True)
    db.session.add(unit)
    ot = OperationType(
        code="QC_TURN", name="Turning", default_machine_type_id=mt.id, active=True
    )
    db.session.add(ot)
    db.session.flush()

    now = datetime.now(timezone.utc)
    job = JobOrder(
        client_id=client.id,
        title="QC detail",
        due_date=shop_now().date() + timedelta(days=14),
        status=JobOrderStatus.IN_PROGRESS,
        priority=JobPriority.MODERATE,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        amount=Decimal("1000"),
        created_by_id=admin.id,
    )
    db.session.add(job)
    db.session.flush()
    ops = []
    for i in range(5):
        op = JobOperation(
            job_order_id=job.id,
            sequence_no=i + 1,
            operation_name=f"Op {i + 1}",
            operation_type_id=ot.id,
            machine_type_id=mt.id,
            machine_unit_id=unit.id,
            assigned_worker_id=worker.id,
            estimated_hours=Decimal("4"),
            scheduled_start=now + timedelta(hours=i * 8),
            scheduled_end=now + timedelta(hours=i * 8 + 4),
            status=OperationStatus.SCHEDULED,
        )
        db.session.add(op)
        ops.append(op)
    db.session.flush()
    for i in range(10):
        db.session.add(
            OperationTimeLog(
                operation_id=ops[i % 5].id,
                worker_id=worker.id,
                event=OperationTimeEvent.START
                if i % 2 == 0
                else OperationTimeEvent.PAUSE,
                event_at=now + timedelta(minutes=i),
            )
        )

    for i in range(8):
        cj = JobOrder(
            client_id=client.id,
            title=f"QC sales {i}",
            due_date=shop_now().date() - timedelta(days=7 * i),
            status=JobOrderStatus.COMPLETED,
            priority=JobPriority.MODERATE,
            job_type=JobType.FABRICATION,
            part_condition=PartCondition.FINISHED,
            amount=Decimal(str(100 * (i + 1))),
            created_by_id=admin.id,
        )
        db.session.add(cj)
        db.session.flush()
        db.session.add(
            JobOperation(
                job_order_id=cj.id,
                sequence_no=1,
                operation_name="Done",
                operation_type_id=ot.id,
                assigned_worker_id=worker.id,
                estimated_hours=Decimal("2"),
                actual_end=now - timedelta(days=7 * i, hours=2),
                status=OperationStatus.COMPLETED,
            )
        )

    db.session.commit()
    return admin.id, job.id


def test_job_order_detail_query_budget(app):
    with app.app_context():
        admin_id, job_id = _seed_detail_fixture()
        db.session.expunge_all()

        def load():
            job = jo_service.get_job_order(job_id, admin_id, UserRole.ADMIN.value)
            return job.to_dict(include_operations=True, viewer_role=UserRole.ADMIN.value)

        payload, n = _count_queries(load)
        assert len(payload["operations"]) == 5
        assert sum(len(o["timeLogs"]) for o in payload["operations"]) == 10
        # includes one grouped query for the completion-estimate ratios and one
        # for the shop's daily break
        assert n < 7, f"expected under 7 queries, got {n}"


def test_sales_summary_query_budget(app):
    with app.app_context():
        _seed_detail_fixture()
        db.session.expunge_all()
        payload, n = _count_queries(lambda: analytics.sales_summary())
        assert payload["completedJobCount"] == 8
        assert n <= 2, f"expected <=2 queries, got {n}"
