"""flask cleanup-seed-data: merge seed people/companies onto real records."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.extensions import bcrypt, db
from app.models.attendance import AttendanceRecord
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.notification import (
    NotificationChannel,
    NotificationLog,
    NotificationMilestone,
    NotificationStatus,
)
from app.models.operation import JobOperation, OperationStatus
from app.models.operation_time import OperationTimeEvent, OperationTimeLog
from app.models.supplier import Supplier
from app.models.supplier_order import SupplierOrder, SupplierOrderStatus
from app.models.tool import Tool
from app.models.tool_event import ToolEvent, ToolEventType
from app.models.user import User, UserRole, UserStatus
from app.models.worker_profile import WorkerProfile
from app.models.worker_skill import WorkerSkill
from app.services import seed_cleanup_service as cleanup
from app.services.reference_data_service import load_reference_data
from app.utils.db_url import mask_database_url

NOW = datetime(2026, 9, 1, 2, 0, tzinfo=timezone.utc)


def _user(email, role, name=None):
    user = User(
        email=email,
        password_hash=bcrypt.generate_password_hash("Passw0rd!").decode("utf-8"),
        full_name=name or email.split("@")[0],
        role=role,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    db.session.flush()
    return user


def _worker(email, name):
    u = _user(email, UserRole.PRODUCTION_WORKER, name)
    db.session.add(WorkerProfile(user_id=u.id))
    db.session.flush()
    return u


@pytest.fixture
def world(app):
    load_reference_data()
    admin = _user("cleanup_admin@test.example", UserRole.ADMIN, "Admin User")
    office = _user("cleanup_office@test.example", UserRole.OFFICE_STAFF, "Office Staff")
    keep_a = _worker(None, "Anthony Pajantoy")
    keep_a.email = None
    keep_b = _worker(None, "Melvin Cablao")
    keep_b.email = None
    seed_w = _worker("worker1@bmsc.local", "Juan Dela Cruz")
    seed_w2 = _worker("worker2@bmsc.local", "Maria Santos")

    # Skills: seed_w shares a machine type with keep_a
    mt = db.session.execute(db.text("SELECT id FROM machine_types LIMIT 1")).scalar()
    if mt:
        db.session.add(WorkerSkill(worker_id=seed_w.id, machine_type_id=mt, proficiency=3, is_primary=True))
        db.session.add(WorkerSkill(worker_id=keep_a.id, machine_type_id=mt, proficiency=4, is_primary=True))

    ric = Supplier.query.filter_by(code="RIC").one()
    stp = Supplier.query.filter_by(code="STP").one()
    ric.is_seed = True
    stp.is_seed = True
    dup = Supplier(name="Railim Industrial Corporation (duplicate)", active=False)
    metro = Supplier(name="Metro Hardware", is_seed=True, active=False)
    seno = Supplier(name="Seno Metals", is_seed=True, active=False)
    other_seed = Supplier(name="Weird Seed Co", is_seed=True)
    db.session.add_all([dup, metro, seno, other_seed])
    db.session.flush()

    bsu = Client(name="BSU", contact="Real", email="bsu@real.example")
    sanitary = Client(name="Sanitary Care", contact="Ma'am Serlyn")
    hist_san = Client(name="HIST-SEED Sanitary Care", contact="sanitary@hist-seed.local")
    tc_san = Client(name="TC-SEED Sanitary Care")
    hist_abo = Client(name="HIST-SEED Aboitiz", contact="aboitiz@hist-seed.local")
    tc_abo = Client(name="TC-SEED Aboitiz")
    notify = Client(
        name="TC-SEED Notification Client (TC-29)",
        contact="Replace with a real contact before TC-29",
        email="tc29.client@example.com",
        notify_by_email=True,
    )
    db.session.add_all([bsu, sanitary, hist_san, tc_san, hist_abo, tc_abo, notify])
    db.session.flush()

    def job(client, title, worker, status=JobOrderStatus.COMPLETED, po=None):
        j = JobOrder(
            client_id=client.id,
            client_po_number=po,
            title=title,
            due_date=date(2026, 9, 30),
            status=status,
            job_type=JobType.FABRICATION,
            part_condition=PartCondition.RAW_MATERIAL,
            material_status=MaterialStatus.NOT_REQUIRED,
            raw_materials=[],
            amount=Decimal("100"),
            created_by_id=admin.id,
            created_at=NOW,
        )
        db.session.add(j)
        db.session.flush()
        op = JobOperation(
            job_order_id=j.id,
            sequence_no=1,
            operation_name="Turning",
            estimated_hours=Decimal("2"),
            assigned_worker_id=worker.id,
            status=OperationStatus.COMPLETED
            if status == JobOrderStatus.COMPLETED
            else OperationStatus.SCHEDULED,
            scheduled_start=NOW + timedelta(days=1),
            scheduled_end=NOW + timedelta(days=1, hours=2),
            actual_worked_hours=Decimal("2") if status == JobOrderStatus.COMPLETED else None,
            actual_start=NOW if status == JobOrderStatus.COMPLETED else None,
            actual_end=NOW + timedelta(hours=2) if status == JobOrderStatus.COMPLETED else None,
        )
        db.session.add(op)
        db.session.flush()
        if status == JobOrderStatus.COMPLETED:
            db.session.add(
                OperationTimeLog(
                    operation_id=op.id,
                    worker_id=worker.id,
                    event=OperationTimeEvent.START,
                    event_at=NOW,
                )
            )
        return j, op

    done_job, done_op = job(hist_san, "[HIST-SEED] Shaft", seed_w, po="HIST-SEED-1")
    # Open op on seed that overlaps keep_a's booking → unassign
    keep_open = JobOrder(
        client_id=sanitary.id,
        title="Keep open",
        due_date=date(2026, 10, 1),
        status=JobOrderStatus.SCHEDULED,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        material_status=MaterialStatus.NOT_REQUIRED,
        raw_materials=[],
        created_by_id=admin.id,
    )
    db.session.add(keep_open)
    db.session.flush()
    keep_op = JobOperation(
        job_order_id=keep_open.id,
        sequence_no=1,
        operation_name="Mill",
        estimated_hours=Decimal("2"),
        assigned_worker_id=keep_a.id,
        status=OperationStatus.SCHEDULED,
        scheduled_start=NOW + timedelta(days=2),
        scheduled_end=NOW + timedelta(days=2, hours=3),
    )
    db.session.add(keep_op)
    conflict_job = JobOrder(
        client_id=hist_abo.id,
        title="[TC-SEED] Conflict",
        due_date=date(2026, 10, 2),
        status=JobOrderStatus.SCHEDULED,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        material_status=MaterialStatus.NOT_REQUIRED,
        raw_materials=[],
        created_by_id=admin.id,
    )
    db.session.add(conflict_job)
    db.session.flush()
    conflict_op = JobOperation(
        job_order_id=conflict_job.id,
        sequence_no=1,
        operation_name="Turn",
        estimated_hours=Decimal("2"),
        assigned_worker_id=seed_w.id,
        status=OperationStatus.SCHEDULED,
        scheduled_start=NOW + timedelta(days=2, hours=1),
        scheduled_end=NOW + timedelta(days=2, hours=4),
    )
    db.session.add(conflict_op)

    # Non-overlapping open op on seed_w2 → should move
    free_job = JobOrder(
        client_id=tc_abo.id,
        title="Free move",
        due_date=date(2026, 10, 3),
        status=JobOrderStatus.SCHEDULED,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        material_status=MaterialStatus.NOT_REQUIRED,
        raw_materials=[],
        created_by_id=admin.id,
    )
    db.session.add(free_job)
    db.session.flush()
    free_op = JobOperation(
        job_order_id=free_job.id,
        sequence_no=1,
        operation_name="Drill",
        estimated_hours=Decimal("1"),
        assigned_worker_id=seed_w2.id,
        status=OperationStatus.SCHEDULED,
        scheduled_start=NOW + timedelta(days=5),
        scheduled_end=NOW + timedelta(days=5, hours=1),
    )
    db.session.add(free_op)

    day = date(2026, 8, 15)
    clock = NOW.replace(hour=1)
    db.session.add(
        AttendanceRecord(
            worker_id=seed_w.id,
            work_date=day,
            clock_in=clock,
            recorded_by_id=admin.id,
        )
    )
    db.session.add(
        AttendanceRecord(
            worker_id=keep_a.id,
            work_date=day,
            clock_in=clock,
            recorded_by_id=admin.id,
        )
    )
    db.session.add(
        AttendanceRecord(
            worker_id=seed_w2.id,
            work_date=date(2026, 8, 16),
            clock_in=clock,
            recorded_by_id=admin.id,
        )
    )

    tool = Tool.query.first()
    if tool:
        db.session.add(
            ToolEvent(
                tool_id=tool.id,
                worker_id=seed_w.id,
                type=ToolEventType.ISSUE,
                quantity=Decimal("1"),
            )
        )

    order = SupplierOrder(
        supplier_id=dup.id,
        status=SupplierOrderStatus.DRAFT,
        notes="HIST-SEED leftover notes",
        prepared_by_id=admin.id,
    )
    db.session.add(order)
    db.session.commit()
    return {
        "admin": admin,
        "office": office,
        "keep_a": keep_a,
        "keep_b": keep_b,
        "seed_w": seed_w,
        "seed_w2": seed_w2,
        "ric": ric,
        "stp": stp,
        "dup": dup,
        "metro": metro,
        "other_seed": other_seed,
        "bsu": bsu,
        "sanitary": sanitary,
        "done_op": done_op,
        "conflict_op": conflict_op,
        "conflict_job": conflict_job,
        "free_op": free_op,
        "order": order,
    }


def test_dry_run_leaves_db_unchanged(world):
    before_clients = {c.name for c in Client.query.all()}
    before_users = User.query.count()
    report = cleanup.run(apply=False)
    assert {c.name for c in Client.query.all()} == before_clients
    assert User.query.count() == before_users
    assert report.has_work()
    assert any("Juan Dela Cruz" in m["from"] for m in report.worker_mapping)


def test_apply_merges_and_moves(world):
    report = cleanup.run(apply=True, confirm_host=cleanup.database_label()[1])

    names = {c.name for c in Client.query.all()}
    assert "Sanitary Care" in names
    assert "Aboitiz" in names
    assert "BSU" in names
    for interview in cleanup.INTERVIEW_CLIENTS:
        assert any(n.lower() == interview.lower() for n in names), interview
    assert not any(n.startswith("HIST-SEED ") or n.startswith("TC-SEED ") for n in names)
    assert "TC-SEED Notification Client (TC-29)" not in names

    assert User.query.filter_by(email="worker1@bmsc.local").count() == 0
    assert User.query.filter_by(email="worker2@bmsc.local").count() == 0
    assert User.query.filter_by(full_name="Anthony Pajantoy").count() == 1
    assert any(k["fullName"] == "Anthony Pajantoy" for k in report.users_kept)
    assert any(k["fullName"] == "Admin User" for k in report.users_kept)

    done = db.session.get(JobOperation, world["done_op"].id)
    assert done.assigned_worker_id == world["keep_a"].id

    conflict = db.session.get(JobOperation, world["conflict_op"].id)
    assert conflict.assigned_worker_id is None
    job = db.session.get(JobOrder, world["conflict_job"].id)
    assert job.needs_replan_reason

    free = db.session.get(JobOperation, world["free_op"].id)
    assert free.assigned_worker_id in {world["keep_a"].id, world["keep_b"].id}

    # Attendance unique day dropped for seed_w; seed_w2 day moved
    assert (
        AttendanceRecord.query.filter_by(
            worker_id=world["keep_a"].id, work_date=date(2026, 8, 15)
        ).count()
        == 1
    )
    assert report.attendance_dropped >= 1

    ric = Supplier.query.filter_by(code="RIC").one()
    assert ric.is_seed is False
    assert Supplier.query.filter_by(name="Metro Hardware").count() == 0
    assert Supplier.query.filter_by(name="Railim Industrial Corporation (duplicate)").count() == 0
    assert Supplier.query.filter_by(name="Weird Seed Co").count() == 1  # left alone
    assert "Weird Seed Co" in report.suppliers_left_seed

    order = db.session.get(SupplierOrder, world["order"].id)
    assert order.supplier_id == ric.id
    assert order.notes == "leftover notes"

    title = JobOrder.query.filter(JobOrder.title == "Shaft").count()
    assert title >= 1


def test_idempotent_second_run(world):
    host = cleanup.database_label()[1]
    cleanup.run(apply=True, confirm_host=host)
    report = cleanup.run(apply=True, confirm_host=host)
    assert report.nothing_to_do
    assert not report.worker_mapping
    assert not report.suppliers_merged
    assert not report.clients_merged


def test_apply_aborts_on_host_mismatch(world):
    before = User.query.count()
    with pytest.raises(ValueError, match="Host confirmation failed"):
        cleanup.run(apply=True, confirm_host="wrong-host.example")
    assert User.query.count() == before


def test_cli_dry_run_and_apply_prompt(world, app):
    runner = app.test_cli_runner()
    before = User.query.filter(User.email.like("%@bmsc.local")).count()
    result = runner.invoke(args=["cleanup-seed-data"])
    assert result.exit_code == 0, result.output
    assert "Dry run: nothing was saved" in result.output
    assert "Target database:" in result.output
    assert User.query.filter(User.email.like("%@bmsc.local")).count() == before

    host = cleanup.database_label()[1]
    bad = runner.invoke(args=["cleanup-seed-data", "--apply"], input="not-the-host\n")
    assert bad.exit_code != 0
    assert "Host confirmation failed" in bad.output

    ok = runner.invoke(args=["cleanup-seed-data", "--apply"], input=f"{host}\n")
    assert ok.exit_code == 0, ok.output
    assert "Applied." in ok.output
    assert User.query.filter_by(email="worker1@bmsc.local").count() == 0


@pytest.mark.parametrize(
    ("url", "shown"),
    [
        ("postgresql://bmsc:s3cret@ep-cool-1.neon.tech/neondb?sslmode=require", "ep-cool-1.neon.tech/neondb"),
        ("postgresql+psycopg2://u:p%40ss@localhost:5433/bmsc", "localhost/bmsc"),
        ("sqlite:///tmp/test.db", "sqlite/tmp/test.db"),
        ("", "(unset)"),
        (None, "(unset)"),
        ("not a url s3cret", "(unreadable database URL)"),
    ],
)
def test_mask_database_url_hides_credentials(url, shown):
    masked = mask_database_url(url)
    assert masked == shown
    assert "s3cret" not in masked and "p%40ss" not in masked


def test_keep_list_never_deleted_even_with_bmsc_email(world):
    """Keep-list names are never removed, even when email is @bmsc.local."""
    kept = _worker("worker99@bmsc.local", "Anthony Serrano")
    db.session.commit()
    host = cleanup.database_label()[1]
    report = cleanup.run(apply=True, confirm_host=host)
    assert db.session.get(User, kept.id) is not None
    assert User.query.filter_by(email="worker99@bmsc.local").count() == 1
    assert any(k["id"] == kept.id for k in report.users_kept)
    assert "worker99@bmsc.local" not in (report.workers_deleted or [])
    assert not any(m.get("fromEmail") == "worker99@bmsc.local" for m in report.worker_mapping)


def test_interview_clients_created_once_idempotent(world):
    host = cleanup.database_label()[1]
    # Ensure a couple of interview names are absent before the first apply.
    for name in ("CyberAge", "SIDC", "MMV Builders"):
        row = Client.query.filter(db.func.lower(Client.name) == name.lower()).first()
        if row:
            db.session.delete(row)
    db.session.commit()
    assert Client.query.filter(db.func.lower(Client.name) == "cyberage").count() == 0

    first = cleanup.run(apply=True, confirm_host=host)
    assert "CyberAge" in first.clients_created
    assert "SIDC" in first.clients_created
    assert "MMV Builders" in first.clients_created
    assert Client.query.filter(db.func.lower(Client.name) == "cyberage").count() == 1

    second = cleanup.run(apply=True, confirm_host=host)
    assert second.clients_created == []
    assert Client.query.filter(db.func.lower(Client.name) == "cyberage").count() == 1


def test_placeholder_merge_moves_jobs_and_notification_logs(world):
    admin = world["admin"]
    abc = Client(name="ABC Manufacturing", contact="09171234567")
    metro = Client(name="Metro Steel Corp", contact="09181234567")
    pacific = Client(name="Pacific Engineering", contact="09191234567")
    db.session.add_all([abc, metro, pacific])
    db.session.flush()

    job = JobOrder(
        client_id=abc.id,
        title="Placeholder job",
        due_date=date(2026, 11, 1),
        status=JobOrderStatus.COMPLETED,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        material_status=MaterialStatus.NOT_REQUIRED,
        raw_materials=[],
        amount=Decimal("10"),
        created_by_id=admin.id,
    )
    db.session.add(job)
    db.session.flush()
    log = NotificationLog(
        job_order_id=job.id,
        client_id=abc.id,
        milestone=NotificationMilestone.JOB_COMPLETED,
        channel=NotificationChannel.EMAIL,
        recipient="nobody@example.com",
        message_body="done",
        status=NotificationStatus.SENT,
    )
    db.session.add(log)
    db.session.commit()
    job_id, log_id = job.id, log.id

    report = cleanup.run(apply=True, confirm_host=cleanup.database_label()[1])
    assert Client.query.filter_by(name="ABC Manufacturing").count() == 0
    assert Client.query.filter_by(name="Metro Steel Corp").count() == 0
    assert Client.query.filter_by(name="Pacific Engineering").count() == 0

    aboitiz = Client.query.filter(db.func.lower(Client.name) == "aboitiz").filter(
        ~Client.name.like("HIST-SEED %"), ~Client.name.like("TC-SEED %")
    ).one()
    moved_job = db.session.get(JobOrder, job_id)
    moved_log = db.session.get(NotificationLog, log_id)
    assert moved_job.client_id == aboitiz.id
    assert moved_log.client_id == aboitiz.id

    placeholder = {row["from"]: row for row in report.clients_placeholders_merged}
    assert "ABC Manufacturing" in placeholder
    assert placeholder["ABC Manufacturing"]["to"] == aboitiz.name
    assert placeholder["ABC Manufacturing"]["moved"].get("job_orders", 0) >= 1
    assert placeholder["ABC Manufacturing"]["moved"].get("notification_logs", 0) >= 1
