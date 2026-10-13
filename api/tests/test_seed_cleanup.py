"""`flask cleanup-seed-data`: groups every client and supplier, is a dry run
by default, deletes only SEED records (option A) and merges DUPLICATE
suppliers with --apply, never touches REAL or UNSURE records or reference
data, and is idempotent."""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

import pytest

from app.extensions import bcrypt, db
from app.models.audit_log import AuditLog
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.machine import MachineType, MachineUnit
from app.models.material_catalog import MaterialCatalogItem
from app.models.material_purchase import MaterialPurchase
from app.models.notification import (
    NotificationChannel,
    NotificationLog,
    NotificationMilestone,
    NotificationStatus,
)
from app.models.operation import JobOperation, OperationStatus
from app.models.operation_time import DowntimeCategory, MachineDowntime, OperationTimeEvent, OperationTimeLog
from app.models.shop_settings import ShopSettings
from app.models.supplier import Supplier
from app.models.stocktake import Stocktake, StocktakeLine
from app.models.supplier_order import SupplierOrder, SupplierOrderStatus
from app.models.tool import Tool
from app.models.tool_event import ToolEvent, ToolEventType
from app.models.user import User, UserRole, UserStatus
from app.models.worker_skill import CalendarExceptionType, OperationType, WorkCalendarException
from app.services import seed_cleanup_service as cleanup
from app.services.reference_data_service import load_reference_data
from app.utils.db_url import mask_database_url

NOW = datetime(2026, 9, 1, 2, 0, tzinfo=timezone.utc)


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
    return user


def _job(client, creator, po):
    job = JobOrder(
        client_id=client.id,
        client_po_number=po,
        title="Shaft",
        due_date=date(2026, 9, 30),
        status=JobOrderStatus.COMPLETED,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        material_status=MaterialStatus.NOT_REQUIRED,
        raw_materials=[],
        amount=Decimal("5000"),
        created_by_id=creator.id,
        created_at=NOW,
    )
    db.session.add(job)
    db.session.flush()
    op = JobOperation(
        job_order_id=job.id,
        sequence_no=1,
        operation_name="Turning",
        estimated_hours=Decimal("2"),
        actual_worked_hours=Decimal("2"),
        actual_start=NOW,
        actual_end=NOW + timedelta(hours=2),
        assigned_worker_id=creator.id,
        status=OperationStatus.COMPLETED,
    )
    db.session.add(op)
    db.session.flush()
    db.session.add(
        OperationTimeLog(operation_id=op.id, worker_id=creator.id, event=OperationTimeEvent.START, event_at=NOW)
    )
    return job


def _order(supplier, admin, notes=None):
    order = SupplierOrder(
        supplier_id=supplier.id, status=SupplierOrderStatus.RECEIVED, notes=notes, prepared_by_id=admin.id
    )
    db.session.add(order)
    db.session.flush()
    return order


def _line(supplier, order=None, job=None, tool=None):
    line = MaterialPurchase(
        job_order_id=job.id if job else None,
        tool_id=tool.id if tool else None,
        supplier_id=supplier.id,
        supplier_order_id=order.id if order else None,
        material_name="Round bar",
        quantity=Decimal("1"),
        unit="pcs",
        unit_cost=Decimal("100"),
        date_ordered=date(2026, 8, 20),
        date_received=date(2026, 8, 25),
    )
    db.session.add(line)
    db.session.flush()
    return line


def _audit_create(entity_type, entity_id, user):
    db.session.add(
        AuditLog(user_id=user.id, user_role=user.role.value, action="CREATE", entity_type=entity_type, entity_id=entity_id)
    )


@pytest.fixture
def world(app):
    load_reference_data()
    admin = _user("cleanup_admin@test.example", UserRole.ADMIN)
    office = _user("cleanup_office@test.example", UserRole.OFFICE_STAFF)
    sup = {s.code: s for s in Supplier.query.filter(Supplier.code.isnot(None)).all()}

    real = Client(name="Acme Real")
    legacy = Client(name="Legacy Co")
    mystery = Client(name="Mystery Co")
    hist = Client(name="HIST-SEED Foo", contact="foo@hist-seed.local")
    tc = Client(name="TC-SEED Bar")
    demo = Client(name="ABC Manufacturing", contact="09171234567")
    mixed = Client(name="HIST-SEED Mixed", contact="mixed@hist-seed.local")
    db.session.add_all([real, legacy, mystery, hist, tc, demo, mixed])
    db.session.flush()
    _audit_create("Client", real.id, office)

    real_job = _job(real, admin, "PO-1001")
    legacy_job = _job(legacy, admin, None)
    hist_job = _job(hist, admin, "HIST-SEED-20260801-001")
    tc_job = _job(tc, admin, "TC-SEED-20260801-T01")
    mixed_seed_job = _job(mixed, admin, "HIST-SEED-20260802-001")
    mixed_app_job = _job(mixed, admin, "12738")

    db.session.add(
        NotificationLog(
            job_order_id=hist_job.id,
            client_id=hist.id,
            milestone=NotificationMilestone.JOB_COMPLETED,
            channel=NotificationChannel.SMS,
            recipient="09170000000",
            message_body="Done",
            status=NotificationStatus.SENT,
        )
    )

    seed_supplier = Supplier(name="Fake Supplies", is_seed=True)
    seno = Supplier(name="Seno Metals", is_seed=True, active=False)
    dup = Supplier(name="Railim Industrial Corporation (duplicate)", active=False)
    db.session.add_all([seed_supplier, seno, dup])
    db.session.flush()

    tool = Tool.query.first()
    seed_order = _order(sup["RIC"], admin, "HIST-SEED job materials")
    _line(sup["RIC"], seed_order, hist_job)
    restock = _order(sup["STP"], admin, "HIST-SEED consumable restock")
    restock_line = _line(sup["STP"], restock, tool=tool)
    shared = _order(sup["RIC"], admin, "HIST-SEED job materials")
    _line(sup["RIC"], shared, hist_job)
    _line(sup["RIC"], shared, real_job)
    real_order = _order(sup["RTC"], admin)
    _line(sup["RTC"], real_order, real_job)
    fake_order = _order(seed_supplier, admin, "HIST-SEED job materials")
    _line(seed_supplier, fake_order, tc_job)
    dup_order = _order(dup, admin)
    _line(dup, dup_order, legacy_job)

    unit = MachineUnit.query.first()
    db.session.add_all(
        [
            MachineDowntime(
                machine_unit_id=unit.id,
                started_at=NOW,
                category=DowntimeCategory.MECHANICAL_FAILURE,
                reason="Mechanical failure",
                note="HIST-SEED open downtime",
                reported_by_id=admin.id,
            ),
            MachineDowntime(
                machine_unit_id=unit.id,
                started_at=NOW - timedelta(days=3),
                ended_at=NOW - timedelta(days=2),
                category=DowntimeCategory.ELECTRICAL_FAULT,
                reason="Electrical fault",
                reported_by_id=admin.id,
            ),
        ]
    )
    usage = ToolEvent(
        tool_id=tool.id, worker_id=admin.id, type=ToolEventType.ISSUE, quantity=Decimal("1"), job_order_id=hist_job.id
    )
    delivery = ToolEvent(
        tool_id=tool.id,
        worker_id=admin.id,
        type=ToolEventType.RECEIVE,
        quantity=Decimal("5"),
        material_purchase_id=restock_line.id,
    )
    db.session.add_all([usage, delivery])
    db.session.commit()
    return {
        "admin": admin,
        "sup": sup,
        "real_job": real_job.id,
        "mixed_app_job": mixed_app_job.id,
        "mixed_seed_job": mixed_seed_job.id,
        "shared": shared.id,
        "real_order": real_order.id,
        "dup_order": dup_order.id,
        "usage": usage.id,
        "delivery": delivery.id,
    }


def _groups(plan, kind):
    return {r.name: r.group for r in plan.records(kind)}


def _reference_counts():
    return {
        "users": User.query.count(),
        "machine types": MachineType.query.count(),
        "machine units": MachineUnit.query.count(),
        "operation types": OperationType.query.count(),
        "catalog": MaterialCatalogItem.query.count(),
        "tools": Tool.query.count(),
        "shop settings": ShopSettings.query.count(),
        "stock movements": ToolEvent.query.count(),
    }


def _all_counts():
    return {
        **_reference_counts(),
        "clients": Client.query.count(),
        "suppliers": Supplier.query.count(),
        "jobs": JobOrder.query.count(),
        "operations": JobOperation.query.count(),
        "time logs": OperationTimeLog.query.count(),
        "lines": MaterialPurchase.query.count(),
        "orders": SupplierOrder.query.count(),
        "downtimes": MachineDowntime.query.count(),
        "notifications": NotificationLog.query.count(),
    }


def test_every_client_and_supplier_is_grouped(world):
    plan = cleanup.build_plan()

    assert _groups(plan, "client") == {
        "Acme Real": "REAL",
        "Legacy Co": "REAL",
        "Mystery Co": "UNSURE",
        "HIST-SEED Foo": "SEED",
        "TC-SEED Bar": "SEED",
        "ABC Manufacturing": "SEED",
        "HIST-SEED Mixed": "SEED",
    }
    mixed = next(r for r in plan.clients if r.name == "HIST-SEED Mixed")
    assert mixed.linked["job orders"] == 2
    assert len(mixed.notes) == 1 and "PO 12738" in mixed.notes[0]
    groups = _groups(plan, "supplier")
    assert groups["Railim Industrial Corporation"] == "REAL"
    assert groups["Seno Metals"] == "REAL"  # retired reference supplier, despite is_seed
    assert groups["Fake Supplies"] == "SEED"
    assert groups["Railim Industrial Corporation (duplicate)"] == "DUPLICATE"
    dup = next(r for r in plan.suppliers if r.group == "DUPLICATE")
    assert dup.merge_into == (world["sup"]["RIC"].id, "Railim Industrial Corporation")

    foo = next(r for r in plan.clients if r.name == "HIST-SEED Foo")
    assert foo.linked["job orders"] == 1
    assert foo.linked["operations"] == 1
    assert foo.linked["time records"] == 1
    assert foo.linked["notifications"] == 1
    assert foo.linked["material lines"] == 2
    assert foo.linked["stock movements (kept, unlinked)"] == 1


def test_seed_orders_exclude_orders_with_real_lines(world):
    plan = cleanup.build_plan()
    assert world["shared"] not in plan.seed_order_ids
    assert world["real_order"] not in plan.seed_order_ids
    assert world["dup_order"] not in plan.seed_order_ids
    # the HIST-SEED job-material order, the restock order and the seed supplier's order
    assert len(plan.seed_order_ids) == 3
    assert len(plan.seed_downtime_ids) == 1


def test_dry_run_changes_nothing(world):
    before = _all_counts()
    plan = cleanup.run(apply=False, today=date(2026, 10, 12))
    assert _all_counts() == before
    assert plan.before["jobOrders"] == 6
    assert plan.after["jobOrders"] == 2  # Acme and Legacy
    assert Client.query.filter_by(name="HIST-SEED Foo").count() == 1


def test_apply_deletes_seed_and_merges_duplicates_only(world):
    reference = _reference_counts()
    cleanup.run(apply=True, today=date(2026, 10, 12))

    names = {c.name for c in Client.query.all()}
    assert names == {"Acme Real", "Legacy Co", "Mystery Co"}
    assert {s.name for s in Supplier.query.all()} == {
        "Railim Industrial Corporation",
        "STP Industrial Inc.",
        "Raitech Industrial Corporation",
        "Seno Metals",
    }
    assert {j.id for j in JobOrder.query.all()} == {
        world["real_job"],
        *[j.id for j in JobOrder.query.filter_by(client_po_number=None)],
    }
    assert JobOrder.query.count() == 2
    assert NotificationLog.query.count() == 0
    assert MachineDowntime.query.count() == 1
    assert db.session.get(SupplierOrder, world["shared"]) is not None
    assert MaterialPurchase.query.filter_by(supplier_order_id=world["shared"]).count() == 1
    assert db.session.get(SupplierOrder, world["real_order"]) is not None
    assert db.session.get(SupplierOrder, world["dup_order"]).supplier_id == world["sup"]["RIC"].id

    assert _reference_counts() == reference
    usage = db.session.get(ToolEvent, world["usage"])
    delivery = db.session.get(ToolEvent, world["delivery"])
    assert usage.job_order_id is None and delivery.material_purchase_id is None


def test_second_run_changes_nothing(world):
    cleanup.run(apply=True, today=date(2026, 10, 12))
    after_first = _all_counts()
    plan = cleanup.run(apply=True, today=date(2026, 10, 12))
    assert _all_counts() == after_first
    assert not plan.records(group="SEED") and not plan.records(group="DUPLICATE")
    assert plan.seed_order_ids == [] and plan.seed_downtime_ids == []


def test_report_and_cli_dry_run(world, app):
    plan = cleanup.run(apply=False, today=date(2026, 10, 12))
    text = "\n".join(cleanup.report_lines(plan, applied=False))
    assert "Would delete (option A)" in text
    assert "HIST-SEED Foo" in text and "merge into 'Railim Industrial Corporation'" in text
    assert "Analytics impact" in text

    before = _all_counts()
    result = app.test_cli_runner().invoke(args=["cleanup-seed-data"])
    assert result.exit_code == 0, result.output
    assert "Dry run: nothing was saved." in result.output
    assert "Database: " in result.output
    assert _all_counts() == before


def test_also_clients_matches_exact_names_only(world, app):
    plan = cleanup.build_plan(also_clients=["Acme Real", "mystery co", "Nobody Inc"])
    groups = _groups(plan, "client")
    assert groups["Acme Real"] == "SEED"
    assert groups["Mystery Co"] == "UNSURE"
    assert plan.missing_names == ["Nobody Inc", "mystery co"]
    acme = next(r for r in plan.clients if r.name == "Acme Real")
    assert "named with --also-clients" in acme.reason
    assert acme.linked["job orders"] == 1
    assert world["real_job"] in plan.seed_job_ids
    assert world["shared"] in plan.seed_order_ids  # its only other line was on a seed job

    before = _all_counts()
    result = app.test_cli_runner().invoke(
        args=["cleanup-seed-data", "--also-clients", "Acme Real", "--also-clients", "Nobody Inc"]
    )
    assert result.exit_code == 0, result.output
    assert "--also-clients 'Nobody Inc': no client has exactly this name" in result.output
    assert "Acme Real  [named with --also-clients]" in result.output
    assert _all_counts() == before


def _tool(code, on_hand):
    tool = Tool(name=f"Item {code}", code=code, unit="pcs", quantity_on_hand=Decimal(on_hand))
    db.session.add(tool)
    db.session.flush()
    return tool


def _count(admin, on, notes, lines):
    take = Stocktake(counted_on=on, counted_by_id=admin.id, notes=notes)
    db.session.add(take)
    db.session.flush()
    for tool, previous, counted in lines:
        db.session.add(
            StocktakeLine(
                stocktake_id=take.id, tool_id=tool.id,
                previous_quantity=Decimal(previous), counted_quantity=Decimal(counted),
            )
        )
    return take


def _receive(admin, tool, qty, on, reason):
    event = ToolEvent(
        tool_id=tool.id, worker_id=admin.id, type=ToolEventType.RECEIVE,
        quantity=Decimal(qty), received_on=on, reason=reason,
    )
    db.session.add(event)
    return event


def test_seed_stock_rows_are_removed_and_on_hand_recomputed(world):
    admin = world["admin"]
    counted = _tool("T-COUNTED", "27")
    never = _tool("T-NEVER", "30")
    _receive(admin, counted, "100", date(2026, 7, 1), "HIST-SEED restock")  # before the real count
    _count(admin, date(2026, 8, 1), "Monthly count", [(counted, "0", "10")])
    _count(admin, date(2026, 8, 15), "HIST-SEED count", [(counted, "10", "7")])
    _receive(admin, counted, "20", date(2026, 8, 20), "HIST-SEED restock")
    _receive(admin, never, "50", date(2026, 8, 20), "HIST-SEED restock")
    real_event = _receive(admin, never, "4", date(2026, 8, 21), "Walk-in purchase")
    db.session.commit()

    plan = cleanup.build_plan()
    stock = {s["code"]: s for s in plan.stock}
    assert stock["T-COUNTED"]["after"] == Decimal("10")  # 27 - (-3 + 20)
    assert stock["T-NEVER"]["after"] == Decimal("0")
    assert any("set to 0" in n for n in stock["T-NEVER"]["notes"])
    assert len(plan.seed_stocktake_ids) == 1 and len(plan.seed_stock_event_ids) == 3

    cleanup.run(apply=True, today=date(2026, 10, 12))
    db.session.expire_all()
    assert Stocktake.query.count() == 1
    assert StocktakeLine.query.count() == 1
    assert db.session.get(Tool, counted.id).quantity_on_hand == Decimal("10")
    assert db.session.get(Tool, never.id).quantity_on_hand == Decimal("0")
    assert db.session.get(ToolEvent, real_event.id) is not None
    assert ToolEvent.query.filter(ToolEvent.reason.like("%HIST-SEED%")).count() == 0

    plan = cleanup.run(apply=True, today=date(2026, 10, 12))
    assert db.session.get(Tool, counted.id).quantity_on_hand == Decimal("10")
    assert plan.seed_stocktake_ids == [] and plan.seed_stock_event_ids == []


def test_calendar_keeps_philippine_holidays(world):
    def entry(on, kind, note, start=None, end=None):
        row = WorkCalendarException(date=on, type=kind, note=note, start_time=start, end_time=end)
        db.session.add(row)
        return row

    ot = entry(date(2026, 9, 3), CalendarExceptionType.OVERTIME, "HIST-SEED OT window", time(17), time(19))
    good_friday = entry(date(2026, 4, 3), CalendarExceptionType.HOLIDAY_NO_WORK, "HIST-SEED Good Friday")
    odd = entry(date(2026, 9, 9), CalendarExceptionType.HOLIDAY_NO_WORK, "HIST-SEED shop outing")
    real = entry(date(2026, 9, 10), CalendarExceptionType.OVERTIME, "Rush order")
    db.session.commit()

    plan = cleanup.build_plan()
    by_id = {c["id"]: c for c in plan.calendar}
    assert set(by_id) == {ot.id, good_friday.id, odd.id}
    assert by_id[ot.id]["action"] == "delete"
    assert by_id[good_friday.id]["action"] == "keep"
    assert "Good Friday" in by_id[good_friday.id]["why"]
    assert by_id[odd.id]["action"] == "keep (check)"

    cleanup.run(apply=True, today=date(2026, 10, 12))
    left = {row.id for row in WorkCalendarException.query.all()}
    assert left == {good_friday.id, odd.id, real.id}


@pytest.mark.parametrize(
    ("on", "name"),
    [
        (date(2026, 1, 1), "New Year's Day"),
        (date(2026, 4, 2), "Maundy Thursday"),
        (date(2026, 4, 3), "Good Friday"),
        (date(2026, 4, 4), "Black Saturday"),
        (date(2025, 4, 18), "Good Friday"),
        (date(2026, 8, 31), "National Heroes Day"),
        (date(2025, 8, 25), "National Heroes Day"),
        (date(2026, 12, 30), "Rizal Day"),
        (date(2026, 8, 24), None),
        (date(2026, 9, 3), None),
    ],
)
def test_ph_holiday(on, name):
    assert cleanup.ph_holiday(on) == name


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
