"""Breakdowns with an expected repair date, the plain Schedule-step message when
a breakdown has none, and the bell alert for single-unit machine types.

Uses the bmsc_test database from conftest (schema built from the models).
"""

from datetime import datetime, time, timedelta, timezone

import pytest
from flask_jwt_extended import create_access_token

from app.extensions import bcrypt, db
from app.models.machine import MachineType, MachineUnit
from app.models.operation_time import MachineDowntime, DowntimeCategory, pause_reason_label
from app.models.staff_alert import StaffAlert, StaffAlertKind
from app.models.user import User, UserRole, UserStatus
from app.models.worker_profile import WorkerProfile
from app.models.worker_skill import WorkerSchedule, WorkerSkill
from app.services.schedule_calendar import shop_local_to_utc, shop_now


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
        for dow in range(7):
            db.session.add(
                WorkerSchedule(
                    worker_id=user.id,
                    day_of_week=dow,
                    is_working=True,
                    start_time=time(8, 0),
                    end_time=time(17, 0),
                )
            )
    return user


def _headers(user):
    token = create_access_token(identity=user.id, additional_claims={"role": user.role.value})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def shop(app):
    admin = _user("br_admin@test.local", UserRole.ADMIN)
    office = _user("br_office@test.local", UserRole.OFFICE_STAFF)
    worker = _user("br_worker@test.local", UserRole.PRODUCTION_WORKER)
    shaper = MachineType(code="SHAPER", name="Shaper", units=1)
    lathe = MachineType(code="LATHE", name="Lathe", units=2)
    db.session.add_all([shaper, lathe])
    db.session.flush()
    shaper_1 = MachineUnit(machine_type_id=shaper.id, label="Shaper #1")
    lathe_1 = MachineUnit(machine_type_id=lathe.id, label="Lathe #1")
    lathe_2 = MachineUnit(machine_type_id=lathe.id, label="Lathe #2")
    db.session.add_all([shaper_1, lathe_1, lathe_2])
    db.session.add(WorkerSkill(worker_id=worker.id, machine_type_id=shaper.id, proficiency=4))
    db.session.add(WorkerSkill(worker_id=worker.id, machine_type_id=lathe.id, proficiency=4))
    db.session.commit()
    return {
        "admin": admin,
        "office": office,
        "worker": worker,
        "shaper": shaper,
        "lathe": lathe,
        "shaper_1": shaper_1,
        "lathe_1": lathe_1,
        "lathe_2": lathe_2,
    }


def _report(client, user, unit, **body):
    return client.post(
        f"/api/v1/operations/machine-units/{unit.id}/downtime",
        json={"category": "MECHANICAL_FAILURE", **body},
        headers=_headers(user),
    )


def _keyway(shop, machine_type=None):
    from app.services.schedule_service import propose_schedule

    ops = [
        {
            "sequenceNo": 1,
            "operationName": "Keyway",
            "machineTypeId": (machine_type or shop["shaper"]).id,
            "assignedWorkerId": shop["worker"].id,
            "estimatedHours": 2,
        }
    ]
    today = shop_now().date()
    return propose_schedule(ops, today + timedelta(days=60), anchor_utc=datetime.now(timezone.utc))[
        "operations"
    ][0]


def test_admin_sets_expected_repair_date_and_scheduler_waits_until_after_it(client, shop):
    repair = shop_now().date() + timedelta(days=3)
    res = _report(client, shop["admin"], shop["shaper_1"], expectedRepairDate=repair.isoformat())
    assert res.status_code == 201, res.get_json()
    assert res.get_json()["expectedRepairDate"] == repair.isoformat()

    op = _keyway(shop)
    assert op["scheduled"] is True, op
    start = datetime.fromisoformat(op["scheduledStart"])
    assert start >= shop_local_to_utc(repair + timedelta(days=1), time(0, 0))


def test_worker_cannot_set_expected_repair_date(client, shop):
    repair = shop_now().date() + timedelta(days=2)
    res = _report(client, shop["worker"], shop["shaper_1"], expectedRepairDate=repair.isoformat())
    assert res.status_code == 403
    assert MachineDowntime.query.count() == 0


def test_office_updates_and_clears_the_repair_date(client, shop):
    res = _report(client, shop["worker"], shop["shaper_1"])
    assert res.status_code == 201
    dt_id = res.get_json()["id"]
    url = f"/api/v1/operations/machine-units/downtime/{dt_id}"
    repair = shop_now().date() + timedelta(days=5)

    res = client.patch(url, json={"expectedRepairDate": repair.isoformat()}, headers=_headers(shop["office"]))
    assert res.status_code == 200
    assert res.get_json()["expectedRepairDate"] == repair.isoformat()

    res = client.patch(url, json={"expectedRepairDate": repair.isoformat()}, headers=_headers(shop["worker"]))
    assert res.status_code == 403

    past = shop_now().date() - timedelta(days=1)
    res = client.patch(url, json={"expectedRepairDate": past.isoformat()}, headers=_headers(shop["admin"]))
    assert res.status_code == 400

    res = client.patch(url, json={"expectedRepairDate": None}, headers=_headers(shop["admin"]))
    assert res.status_code == 200
    assert res.get_json()["expectedRepairDate"] is None

    client.post(f"{url}/close", json={}, headers=_headers(shop["admin"]))
    res = client.patch(url, json={"expectedRepairDate": repair.isoformat()}, headers=_headers(shop["admin"]))
    assert res.status_code == 409


def test_schedule_step_says_machine_is_down_with_no_repair_date(client, shop):
    assert _report(client, shop["admin"], shop["shaper_1"]).status_code == 201
    op = _keyway(shop)
    assert op["scheduled"] is False
    assert op["message"] == "Shaper #1 is down with no expected repair date"
    assert "60 days" not in op["message"]


def test_passed_repair_date_blocks_and_says_so(shop):
    yesterday = shop_now().date() - timedelta(days=1)
    db.session.add(
        MachineDowntime(
            machine_unit_id=shop["shaper_1"].id,
            started_at=datetime.now(timezone.utc) - timedelta(days=3),
            category=DowntimeCategory.MECHANICAL_FAILURE,
            reason="Mechanical failure",
            reported_by_id=shop["admin"].id,
            expected_repair_date=yesterday,
        )
    )
    db.session.commit()
    op = _keyway(shop)
    assert op["scheduled"] is False
    assert op["message"].startswith("Shaper #1 is down and its expected repair date")
    assert op["message"].endswith("has passed")


def test_one_lathe_down_still_schedules_on_the_other(client, shop):
    assert _report(client, shop["admin"], shop["lathe_1"]).status_code == 201
    op = _keyway(shop, shop["lathe"])
    assert op["scheduled"] is True
    assert op["machineUnitId"] == shop["lathe_2"].id


def test_single_unit_breakdown_alerts_admin_once(client, shop):
    from app.services.operation_service import _alert_single_unit_breakdown

    res = _report(client, shop["office"], shop["shaper_1"])
    assert res.status_code == 201
    alerts = StaffAlert.query.filter_by(kind=StaffAlertKind.SINGLE_UNIT_DOWN).all()
    assert [a.recipient_id for a in alerts] == [shop["admin"].id]
    assert "Shaper #1" in alerts[0].title
    assert "No expected repair date" in alerts[0].message

    row = db.session.get(MachineDowntime, res.get_json()["id"])
    _alert_single_unit_breakdown(row, shop["shaper_1"])
    db.session.commit()
    assert StaffAlert.query.filter_by(kind=StaffAlertKind.SINGLE_UNIT_DOWN).count() == 1


def test_breakdown_on_multi_unit_type_raises_no_alert(client, shop):
    assert _report(client, shop["admin"], shop["lathe_1"]).status_code == 201
    assert StaffAlert.query.filter_by(kind=StaffAlertKind.SINGLE_UNIT_DOWN).count() == 0


def test_pause_reasons_have_readable_labels():
    assert pause_reason_label("OTHER") == "Other"
    assert pause_reason_label("MACHINE_DOWN") == "Machine down"
    assert pause_reason_label("SOMETHING_NEW") == "Something new"
