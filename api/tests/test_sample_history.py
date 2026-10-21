"""Sample-history generate and remove, on the test database only."""

from datetime import date, time
from decimal import Decimal

import pytest
from sqlalchemy.dialects.postgresql import JSONB

from app.extensions import db
from app.models.client import Client
from app.models.job_order import JobOrder
from app.models.machine import MachineType, MachineUnit
from app.models.material_catalog import MaterialCatalogItem
from app.models.notification import NotificationLog
from app.models.sample_record import SampleRecord
from app.models.supplier import Supplier
from app.models.tool import Tool, ToolCategory
from app.models.tool_type import ToolType, ToolUnit, ToolUnitStatus
from app.models.user import User, UserRole, UserStatus
from app.models.worker_skill import (
    CalendarExceptionType,
    OperationType,
    WorkCalendarException,
    WorkerSchedule,
    WorkerSkill,
)
from app.services.sample_history_service import generate, remove


def _person(email, role, name):
    user = User(
        email=email,
        password_hash="x",
        full_name=name,
        role=role,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    db.session.flush()
    if role == UserRole.PRODUCTION_WORKER:
        for dow in range(7):
            working = dow < 6
            db.session.add(
                WorkerSchedule(
                    worker_id=user.id,
                    day_of_week=dow,
                    is_working=working,
                    start_time=time(8, 0) if working else None,
                    end_time=time(17, 0) if working else None,
                )
            )
    return user


def _shop():
    admin = _person("ada.quill@example.test", UserRole.ADMIN, "Ada Quill")
    _person("nia.holt@example.test", UserRole.OFFICE_STAFF, "Nia Holt")
    wren = _person("wren.calder@example.test", UserRole.PRODUCTION_WORKER, "Wren Calder")
    moss = _person("moss.ellery@example.test", UserRole.PRODUCTION_WORKER, "Moss Ellery")
    db.session.add(Client(name="Northline Works", notify_by_email=False, notify_by_sms=False))
    db.session.add(Client(name="Bramble Assembly", notify_by_email=False, notify_by_sms=False))
    db.session.add(
        Supplier(name="Harbor Metals", code="HRB", typical_lead_time_days=5, active=True)
    )
    db.session.add(
        Supplier(name="Cedar Alloys", code="CDR", typical_lead_time_days=7, active=True)
    )
    lathe = MachineType(code="LATHE", name="Lathe", units=2)
    db.session.add(lathe)
    db.session.flush()
    for label, person in (("Lathe 1", wren), ("Lathe 2", moss)):
        db.session.add(
            MachineUnit(
                machine_type_id=lathe.id,
                label=label,
                active=True,
                default_operator_id=person.id,
            )
        )
        db.session.add(
            WorkerSkill(worker_id=person.id, machine_type_id=lathe.id, proficiency=3, is_primary=True)
        )
    db.session.add(
        OperationType(
            code="TURN",
            name="Turning",
            default_machine_type_id=lathe.id,
            active=True,
            is_outsourced=False,
        )
    )
    db.session.add(
        MaterialCatalogItem(
            name="Round bar",
            grades=["1018", "1045"],
            default_unit="kg",
            category="Steel",
            active=True,
        )
    )
    for name, code, qty in (
        ("Cutting disc 4 inch", "CD4", Decimal("40")),
        ("Grinding disc 7 inch", "GD7", Decimal("30")),
        ("Hand tap", "TAP", Decimal("20")),
        ("Carbide insert", "INS", Decimal("16")),
    ):
        db.session.add(
            Tool(
                name=name,
                code=code,
                category=ToolCategory.CONSUMABLE,
                unit="pcs",
                quantity_on_hand=qty,
                unit_cost=Decimal("25"),
                active=True,
            )
        )
    mic = ToolType(name="Micrometer", code="MIC")
    db.session.add(mic)
    db.session.flush()
    db.session.add(
        ToolUnit(tool_type_id=mic.id, asset_code="MIC-01", status=ToolUnitStatus.AVAILABLE)
    )
    db.session.commit()
    return admin


def test_record_id_is_text_and_detail_is_json():
    assert isinstance(SampleRecord.record_id.type, db.String)
    assert not isinstance(SampleRecord.record_id.type, db.Integer)
    assert isinstance(SampleRecord.detail.type, JSONB)


def test_dry_run_rolls_back_and_is_repeatable(app):
    _shop()
    before = JobOrder.query.count()
    first = generate(date(2026, 4, 6), date(2026, 4, 17), seed=7, apply=False)
    assert JobOrder.query.count() == before
    assert SampleRecord.query.count() == 0
    second = generate(date(2026, 4, 6), date(2026, 4, 17), seed=7, apply=False)
    assert second["jobs"] == first["jobs"]
    assert second["firstTitles"] == first["firstTitles"]
    assert first["jobs"] > 0


def test_apply_then_remove_restores_stock_and_deletes_holidays(app):
    _shop()
    client = Client.query.filter_by(name="Northline Works").one()
    unit = ToolUnit.query.filter_by(asset_code="MIC-01").one()
    disc = Tool.query.filter_by(code="CD4").one()
    opening = Decimal(str(disc.quantity_on_hand))
    held = unit.current_holder_id

    summary = generate(date(2026, 4, 6), date(2026, 4, 17), seed=7, apply=True)
    assert summary["applied"] is True
    assert summary["jobs"] > 0
    assert "2026-04-09" in summary["holidaysAdded"]
    assert "2026-05-01" in summary["holidaysAdded"]
    holiday = WorkCalendarException.query.filter_by(date=date(2026, 4, 9)).one()
    assert holiday.type == CalendarExceptionType.HOLIDAY_NO_WORK
    assert (
        SampleRecord.query.filter_by(
            table_name="work_calendar_exceptions", record_id=holiday.id
        ).count()
        == 1
    )
    db.session.refresh(disc)
    assert Decimal(str(disc.quantity_on_hand)) != opening
    db.session.refresh(unit)
    assert unit.status == ToolUnitStatus.AVAILABLE
    assert unit.current_holder_id == held
    assert Client.query.filter_by(id=client.id).one().name == "Northline Works"
    assert NotificationLog.query.count() == 0
    assert JobOrder.query.filter_by(created_by_id=User.query.filter_by(full_name="Ada Quill").one().id).count() > 0

    with pytest.raises(ValueError, match="already exists"):
        generate(date(2026, 4, 6), date(2026, 4, 17), seed=7, apply=True)

    preview = remove(apply=False)
    assert preview["ledgerRows"] > 0
    assert JobOrder.query.count() == summary["jobs"]
    assert WorkCalendarException.query.filter_by(date=date(2026, 5, 1)).count() == 1

    done = remove(apply=True)
    assert done["restoredStock"] >= 1
    assert JobOrder.query.count() == 0
    assert SampleRecord.query.count() == 0
    assert WorkCalendarException.query.filter_by(date=date(2026, 4, 9)).count() == 0
    assert WorkCalendarException.query.filter_by(date=date(2026, 5, 1)).count() == 0
    db.session.refresh(disc)
    assert Decimal(str(disc.quantity_on_hand)) == opening
    assert Client.query.filter_by(name="Northline Works").count() == 1
    assert User.query.filter_by(full_name="Wren Calder").count() == 1


def test_apply_aborts_when_the_host_does_not_match(app):
    runner = app.test_cli_runner()
    result = runner.invoke(
        args=[
            "sample-history",
            "generate",
            "--start",
            "2026-04-06",
            "--end",
            "2026-04-17",
            "--seed",
            "7",
            "--apply",
        ],
        input="not-the-host\n",
    )
    assert result.exit_code != 0
    assert "Host confirmation failed" in result.output
    assert JobOrder.query.count() == 0
