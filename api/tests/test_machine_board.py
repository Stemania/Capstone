"""Machines page status board: jobs today per unit, and the next job is shown
while another operation runs."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from flask_jwt_extended import create_access_token

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.machine import MachineType, MachineUnit
from app.models.operation import JobOperation, OperationStatus
from app.models.user import User, UserRole, UserStatus
from app.services.schedule_calendar import shop_now


def _user(email, role, name):
    user = User(
        email=email,
        password_hash=bcrypt.generate_password_hash("Passw0rd!").decode("utf-8"),
        full_name=name,
        role=role,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    db.session.flush()
    return user


def test_status_board_reports_jobs_today_and_next_job_while_running(client, app):
    admin = _user("mtn_admin@test.local", UserRole.ADMIN, "Mia Admin")
    worker = _user("mtn_worker@test.local", UserRole.PRODUCTION_WORKER, "Wes Worker")
    lathe = MachineType(code="LATHE", name="Lathe Machine", units=1)
    db.session.add(lathe)
    db.session.flush()
    unit = MachineUnit(machine_type_id=lathe.id, label="Lathe #1", active=True)
    customer = Client(name="MTN Client")
    db.session.add_all([unit, customer])
    db.session.flush()

    def job(status=JobOrderStatus.IN_PROGRESS):
        row = JobOrder(
            client_id=customer.id,
            title="MTN job",
            due_date=date(2026, 12, 30),
            status=status,
            job_type=JobType.FABRICATION,
            part_condition=PartCondition.RAW_MATERIAL,
            material_status=MaterialStatus.NOT_REQUIRED,
            raw_materials=[],
            amount=Decimal("100"),
            created_by_id=admin.id,
        )
        db.session.add(row)
        db.session.flush()
        return row

    now = shop_now().astimezone(timezone.utc)
    running_job, later_job, draft_job = job(), job(JobOrderStatus.SCHEDULED), job(JobOrderStatus.DRAFT)
    db.session.add_all(
        [
            JobOperation(
                job_order_id=running_job.id,
                sequence_no=1,
                operation_name="Turning",
                status=OperationStatus.IN_PROGRESS,
                machine_type_id=lathe.id,
                machine_unit_id=unit.id,
                assigned_worker_id=worker.id,
                scheduled_start=now - timedelta(minutes=30),
                scheduled_end=now + timedelta(minutes=30),
                actual_start=now - timedelta(minutes=30),
            ),
            JobOperation(
                job_order_id=later_job.id,
                sequence_no=1,
                operation_name="Facing",
                status=OperationStatus.SCHEDULED,
                machine_type_id=lathe.id,
                machine_unit_id=unit.id,
                scheduled_start=now + timedelta(days=3),
                scheduled_end=now + timedelta(days=3, hours=2),
            ),
            JobOperation(
                job_order_id=draft_job.id,
                sequence_no=1,
                operation_name="Threading",
                status=OperationStatus.PENDING,
                machine_type_id=lathe.id,
                machine_unit_id=unit.id,
                scheduled_start=now,
                scheduled_end=now + timedelta(hours=1),
            ),
        ]
    )
    db.session.commit()

    token = create_access_token(identity=admin.id, additional_claims={"role": admin.role.value})
    res = client.get(
        "/api/v1/operations/machine-units/status",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    row = next(r for r in res.get_json() if r["id"] == unit.id)
    assert row["currentOperation"]["operationName"] == "Turning"
    assert row["nextOperation"]["operationName"] == "Facing"
    assert row["jobsToday"] == 1
    assert datetime.fromisoformat(row["nextOperation"]["scheduledStart"]) > now


def test_breakdown_pauses_running_work_and_clears_running_now(client, app):
    from app.models.operation_time import OperationPauseReason, OperationTimeEvent, OperationTimeLog

    admin = _user("brk_admin@test.local", UserRole.ADMIN, "Bea Admin")
    worker = _user("brk_worker@test.local", UserRole.PRODUCTION_WORKER, "Rio Worker")
    lathe = MachineType(code="LATHE2", name="Lathe Machine", units=2)
    db.session.add(lathe)
    db.session.flush()
    down = MachineUnit(machine_type_id=lathe.id, label="Lathe #3", active=True)
    spare = MachineUnit(machine_type_id=lathe.id, label="Lathe #4", active=True)
    customer = Client(name="BRK Client")
    db.session.add_all([down, spare, customer])
    db.session.flush()
    job = JobOrder(
        client_id=customer.id,
        title="BRK job",
        due_date=date(2026, 12, 30),
        status=JobOrderStatus.IN_PROGRESS,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        material_status=MaterialStatus.NOT_REQUIRED,
        raw_materials=[],
        amount=Decimal("100"),
        created_by_id=admin.id,
    )
    db.session.add(job)
    db.session.flush()
    now = shop_now().astimezone(timezone.utc)
    op = JobOperation(
        job_order_id=job.id,
        sequence_no=1,
        operation_name="Threading",
        status=OperationStatus.IN_PROGRESS,
        machine_type_id=lathe.id,
        machine_unit_id=down.id,
        assigned_worker_id=worker.id,
        scheduled_start=now - timedelta(hours=1),
        scheduled_end=now + timedelta(hours=1),
        actual_start=now - timedelta(hours=1),
    )
    later = JobOperation(
        job_order_id=job.id,
        sequence_no=2,
        operation_name="Facing",
        status=OperationStatus.SCHEDULED,
        machine_type_id=lathe.id,
        machine_unit_id=down.id,
        scheduled_start=now + timedelta(hours=2),
        scheduled_end=now + timedelta(hours=3),
    )
    db.session.add_all([op, later])
    db.session.flush()
    db.session.add(
        OperationTimeLog(
            operation_id=op.id,
            worker_id=worker.id,
            event=OperationTimeEvent.START,
            event_at=now - timedelta(hours=1),
        )
    )
    db.session.commit()

    token = create_access_token(identity=admin.id, additional_claims={"role": admin.role.value})
    headers = {"Authorization": f"Bearer {token}"}
    opened = client.post(
        f"/api/v1/operations/machine-units/{down.id}/downtime",
        json={"category": "MECHANICAL_FAILURE"},
        headers=headers,
    )
    assert opened.status_code == 201, opened.get_json()
    names = {row["operationName"] for row in opened.get_json()["affectedOperations"]}
    assert names == {"Threading", "Facing"}

    logs = (
        OperationTimeLog.query.filter_by(operation_id=op.id)
        .order_by(OperationTimeLog.event_at)
        .all()
    )
    assert logs[-1].event == OperationTimeEvent.PAUSE
    assert logs[-1].reason == OperationPauseReason.MACHINE_DOWN

    board = client.get("/api/v1/operations/machine-units/status", headers=headers)
    row = next(item for item in board.get_json() if item["id"] == down.id)
    assert row["down"] is True
    assert row["currentOperation"] is None

    work = client.get(
        f"/api/v1/operations/machine-units/{down.id}/downtime/work", headers=headers
    )
    assert work.status_code == 200, work.get_json()
    listed = {item["operationName"]: item for item in work.get_json()["operations"]}
    assert listed["Threading"]["paused"] is True
    assert listed["Threading"]["pauseReason"] == "Machine breakdown"
    assert "Facing" in listed

    moved = client.post(
        f"/api/v1/operations/machine-units/{down.id}/downtime/work",
        json={"action": "MOVE_UNIT"},
        headers=headers,
    )
    assert moved.status_code == 200, moved.get_json()
    db.session.refresh(op)
    assert op.machine_unit_id == spare.id
    assert op.status == OperationStatus.IN_PROGRESS
