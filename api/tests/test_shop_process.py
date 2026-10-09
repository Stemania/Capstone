"""Shop process: daily break, fabrication sequence, machine-only skills,
and outsourced operations (Heat Treatment).

Uses the bmsc_test database from conftest (schema built from the models).
"""

import json
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.machine import MachineType, MachineUnit
from app.models.operation import JobOperation, OperationStatus
from app.models.operation_time import OperationTimeEvent, OperationTimeLog
from app.models.user import User, UserRole, UserStatus
from app.models.worker_profile import WorkerProfile
from app.models.worker_skill import OperationType, WorkerSchedule, WorkerSkill
from app.services.schedule_calendar import (
    hours_excluding_break,
    shop_local_to_utc,
    shop_now,
    utc_to_shop,
)


def _monday(d=date(2031, 3, 10)):
    return d - timedelta(days=d.weekday())


MONDAY = _monday()


def _at(day, hh, mm=0):
    return shop_local_to_utc(day, time(hh, mm))


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
    if role == UserRole.PRODUCTION_WORKER:
        db.session.add(WorkerProfile(user_id=user.id))
        for dow in range(6):
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
    admin = _user("sp_admin@test.local", UserRole.ADMIN, "SP Admin")
    office = _user("sp_office@test.local", UserRole.OFFICE_STAFF, "SP Office")
    ana = _user("sp_ana@test.local", UserRole.PRODUCTION_WORKER, "Ana Fitter")
    ben = _user("sp_ben@test.local", UserRole.PRODUCTION_WORKER, "Ben Helper")
    lathe = MachineType(code="LATHE", name="Lathe", units=1)
    db.session.add(lathe)
    db.session.flush()
    unit = MachineUnit(machine_type_id=lathe.id, label="Lathe A-1")
    types = {
        "TURNING": OperationType(code="TURNING", name="Turning", default_machine_type_id=lathe.id),
        "LAYOUT": OperationType(code="LAYOUT", name="Layout"),
        "CUTTING": OperationType(code="CUTTING", name="Cutting"),
        "FITTING": OperationType(code="FITTING", name="Fitting"),
        "FINISHING": OperationType(code="FINISHING", name="Finishing (Bapping)"),
        "CHECKING": OperationType(code="CHECKING", name="Checking"),
        "HEAT_TREATMENT": OperationType(
            code="HEAT_TREATMENT",
            name="Heat Treatment",
            is_outsourced=True,
            default_turnaround_days=3,
        ),
    }
    client_row = Client(name="SP Client")
    db.session.add_all([unit, client_row, *types.values()])
    db.session.add(WorkerSkill(worker_id=ana.id, machine_type_id=lathe.id, proficiency=4))
    db.session.commit()
    return {
        "admin": admin,
        "office": office,
        "ana": ana,
        "ben": ben,
        "lathe": lathe,
        "unit": unit,
        "client": client_row,
        "types": types,
    }


def _job(shop, status=JobOrderStatus.SCHEDULED, job_type=JobType.FABRICATION):
    job = JobOrder(
        client_id=shop["client"].id,
        title="SP Job",
        due_date=date(2031, 6, 1),
        status=status,
        job_type=job_type,
        part_condition=PartCondition.RAW_MATERIAL,
        material_status=MaterialStatus.NOT_REQUIRED,
        created_by_id=shop["office"].id,
    )
    db.session.add(job)
    db.session.flush()
    return job


def _op(job, seq, op_type, *, worker=None, status=OperationStatus.SCHEDULED, hours="2", **extra):
    op = JobOperation(
        job_order_id=job.id,
        sequence_no=seq,
        operation_name=op_type.name,
        operation_type_id=op_type.id,
        machine_type_id=op_type.default_machine_type_id,
        assigned_worker_id=worker.id if worker else None,
        estimated_hours=Decimal(hours) if hours is not None else None,
        status=status,
        **extra,
    )
    db.session.add(op)
    db.session.commit()
    return op


# 1. Daily break


def test_scheduling_skips_the_lunch_break(shop):
    from app.services.schedule_service import place_from_start

    start, end, segments = place_from_start(shop["ana"].id, _at(MONDAY, 8), 5)
    assert start == _at(MONDAY, 8)
    assert end == _at(MONDAY, 14)
    assert [(utc_to_shop(s).time(), utc_to_shop(e).time()) for s, e in segments] == [
        (time(8, 0), time(12, 0)),
        (time(13, 0), time(14, 0)),
    ]


def test_hours_and_timers_exclude_the_break(shop):
    from app.services.operation_service import compute_worked_hours

    assert hours_excluding_break(_at(MONDAY, 8), _at(MONDAY, 17)) == 8.0
    assert hours_excluding_break(_at(MONDAY, 8), _at(MONDAY, 11)) == 3.0

    job = _job(shop)
    op = _op(job, 1, shop["types"]["LAYOUT"], worker=shop["ana"], status=OperationStatus.COMPLETED)
    for event, at in (
        (OperationTimeEvent.START, _at(MONDAY, 11)),
        (OperationTimeEvent.COMPLETE, _at(MONDAY, 14)),
    ):
        db.session.add(
            OperationTimeLog(operation_id=op.id, worker_id=shop["ana"].id, event=event, event_at=at)
        )
    db.session.commit()
    db.session.refresh(op)
    assert float(compute_worked_hours(op)) == 2.0


def test_break_is_a_shop_setting_only_admin_changes(client, shop):
    from app.services.schedule_service import place_from_start

    res = client.get("/api/v1/calendar/break", headers=_headers(shop["office"]))
    assert res.status_code == 200
    assert res.get_json()["breakStart"] == "12:00"
    assert res.get_json()["breakEnd"] == "13:00"

    body = {"breakStart": "12:30", "breakEnd": "13:30"}
    assert (
        client.put("/api/v1/calendar/break", json=body, headers=_headers(shop["office"])).status_code
        == 403
    )
    bad = client.put(
        "/api/v1/calendar/break",
        json={"breakStart": "13:00", "breakEnd": "12:00"},
        headers=_headers(shop["admin"]),
    )
    assert bad.status_code == 400

    res = client.put("/api/v1/calendar/break", json=body, headers=_headers(shop["admin"]))
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["breakStart"] == "12:30"
    assert "affectedJobs" in res.get_json()

    _start, end, _ = place_from_start(shop["ana"].id, _at(MONDAY, 8), 4.5)
    assert end == _at(MONDAY, 12, 30)


# 2. Fabrication sequence: part stages


def _stage_after(shop, completed_codes, pending_code="CHECKING"):
    from app.services.job_order_service import advance_part_condition

    job = _job(shop)
    for i, code in enumerate(completed_codes, start=1):
        _op(job, i, shop["types"][code], status=OperationStatus.COMPLETED)
    _op(job, len(completed_codes) + 1, shop["types"][pending_code])
    db.session.refresh(job)
    advance_part_condition(job)
    return job.part_condition


def test_layout_does_not_change_the_part_stage(shop):
    assert _stage_after(shop, ["LAYOUT"]) == PartCondition.RAW_MATERIAL


def test_fitting_sets_assembled_and_finishing_sets_finished(shop):
    assert _stage_after(shop, ["LAYOUT", "CUTTING", "FITTING"]) == PartCondition.ASSEMBLED
    assert (
        _stage_after(shop, ["LAYOUT", "CUTTING", "FITTING", "FINISHING"])
        == PartCondition.FINISHED
    )


# 3. Skills are for machines; operations without a machine are open to all


def _assign(client, shop, op, worker):
    return client.patch(
        f"/api/v1/operations/{op.id}/assign",
        json={"assignedWorkerId": worker.id},
        headers=_headers(shop["admin"]),
    )


def test_skills_are_for_machines_only(client, shop):
    layout = shop["types"]["LAYOUT"]
    url = f"/api/v1/workers/{shop['ana'].id}/skills"
    res = client.put(
        url,
        json={"skills": [{"machineTypeId": shop["lathe"].id, "proficiency": 4, "isPrimary": True}]},
        headers=_headers(shop["admin"]),
    )
    assert res.status_code == 200, res.get_json()
    rows = WorkerSkill.query.filter_by(worker_id=shop["ana"].id).all()
    assert [(r.machine_type_id, r.proficiency) for r in rows] == [(shop["lathe"].id, 4)]

    for bad in (
        {"operationTypeId": layout.id, "proficiency": 3},
        {"machineTypeId": shop["lathe"].id, "operationTypeId": layout.id, "proficiency": 3},
        {"proficiency": 3},
        {"machineTypeId": shop["lathe"].id, "proficiency": 6},
    ):
        res = client.put(url, json={"skills": [bad]}, headers=_headers(shop["admin"]))
        assert res.status_code == 400, bad


def test_every_worker_qualifies_for_operations_without_a_machine(client, shop):
    job = _job(shop)
    for seq, code in enumerate(("LAYOUT", "CUTTING", "FITTING", "CHECKING"), start=1):
        op = _op(job, seq, shop["types"][code])
        assert _assign(client, shop, op, shop["ben"]).status_code == 200, code

    body = {"operationTypeId": shop["types"]["LAYOUT"].id, "operationName": "Layout"}
    res = client.post("/api/v1/workers/suggest", json=body, headers=_headers(shop["admin"]))
    assert res.status_code == 200
    names = {s["fullName"] for s in res.get_json()["suggestions"]}
    assert {"Ana Fitter", "Ben Helper", "SP Admin"} <= names


def _laser(shop):
    laser = MachineType(code="LASER", name="Laser Machine", units=1)
    db.session.add(laser)
    db.session.flush()
    cutting = OperationType(code="LASER_CUT", name="Laser cutting", default_machine_type_id=laser.id)
    db.session.add(cutting)
    db.session.commit()
    return laser, cutting


def test_anyone_can_run_a_machine_until_an_active_worker_has_the_skill(client, shop):
    laser, cutting = _laser(shop)
    job = _job(shop)
    # A skill held only by an inactive worker does not count.
    gone = _user("sp_gone@test.local", UserRole.PRODUCTION_WORKER, "Gone Worker")
    gone.status = UserStatus.DISABLED
    gone.active = False
    db.session.add(WorkerSkill(worker_id=gone.id, machine_type_id=laser.id, proficiency=5))
    db.session.commit()

    assert _assign(client, shop, _op(job, 1, cutting), shop["ben"]).status_code == 200

    db.session.add(WorkerSkill(worker_id=shop["ana"].id, machine_type_id=laser.id, proficiency=3))
    db.session.commit()
    op2 = _op(job, 2, cutting)
    res = _assign(client, shop, op2, shop["ben"])
    assert res.status_code == 400
    err = res.get_json()["error"]
    assert err["code"] == "WORKER_NOT_QUALIFIED"
    assert "Laser Machine" in err["message"]
    assert _assign(client, shop, op2, shop["ana"]).status_code == 200


def test_machine_suggestions_and_worker_list_fall_back_to_everyone(client, shop):
    laser, cutting = _laser(shop)
    body = {"operationTypeId": cutting.id, "machineTypeId": laser.id}
    headers = _headers(shop["admin"])

    res = client.post("/api/v1/workers/suggest", json=body, headers=headers)
    assert res.status_code == 200
    suggestions = res.get_json()["suggestions"]
    assert {"Ana Fitter", "Ben Helper"} <= {s["fullName"] for s in suggestions}
    assert all("No one has this machine skill recorded yet" in s["reason"] for s in suggestions)
    listed = client.get(f"/api/v1/workers?machineTypeId={laser.id}", headers=headers).get_json()
    assert {"Ana Fitter", "Ben Helper"} <= {w["fullName"] for w in listed}

    db.session.add(WorkerSkill(worker_id=shop["ana"].id, machine_type_id=laser.id, proficiency=4))
    db.session.commit()
    res = client.post("/api/v1/workers/suggest", json=body, headers=headers)
    suggestions = res.get_json()["suggestions"]
    assert [s["fullName"] for s in suggestions] == ["Ana Fitter"]
    assert "No one has" not in suggestions[0]["reason"]
    listed = client.get(f"/api/v1/workers?machineTypeId={laser.id}", headers=headers).get_json()
    assert [w["fullName"] for w in listed] == ["Ana Fitter"]


# 4. Outsourced operations


def test_outsourced_operation_is_saved_without_worker_or_hours(client, shop):
    job = _job(shop, status=JobOrderStatus.DRAFT)
    ht = shop["types"]["HEAT_TREATMENT"]
    res = client.patch(
        f"/api/v1/job-orders/{job.id}",
        json={
            "operations": [
                {
                    "operationTypeId": ht.id,
                    "operationName": "Heat Treatment",
                    "assignedWorkerId": shop["ana"].id,
                    "estimatedHours": 4,
                }
            ]
        },
        headers=_headers(shop["admin"]),
    )
    assert res.status_code == 200, res.get_json()
    op = JobOperation.query.filter_by(job_order_id=job.id).one()
    assert op.assigned_worker_id is None
    assert op.estimated_hours is None
    assert op.machine_type_id is None
    assert op.turnaround_days == 3
    assert op.to_dict()["isOutsourced"] is True


def test_scheduler_blocks_out_turnaround_days(shop):
    from app.services.schedule_service import propose_schedule, schedule_problems

    types = shop["types"]
    ops = [
        {
            "sequenceNo": 1,
            "operationName": "Turning",
            "operationTypeId": types["TURNING"].id,
            "machineTypeId": shop["lathe"].id,
            "assignedWorkerId": shop["ana"].id,
            "estimatedHours": 2,
        },
        {
            "sequenceNo": 2,
            "operationName": "Heat Treatment",
            "operationTypeId": types["HEAT_TREATMENT"].id,
            "turnaroundDays": 2,
        },
        {
            "sequenceNo": 3,
            "operationName": "Finishing (Bapping)",
            "operationTypeId": types["FINISHING"].id,
            "assignedWorkerId": shop["ana"].id,
            "estimatedHours": 1,
        },
    ]
    result = propose_schedule(ops, date(2031, 6, 1), anchor_utc=_at(MONDAY, 8))
    turning, ht, finishing = result["operations"]
    assert all(r["scheduled"] for r in result["operations"]), result["operations"]
    assert ht["isOutsourced"] is True
    assert ht["assignedWorkerId"] is None
    ht_start = datetime.fromisoformat(ht["scheduledStart"])
    ht_end = datetime.fromisoformat(ht["scheduledEnd"])
    assert ht_start == datetime.fromisoformat(turning["scheduledEnd"])
    assert ht_end - ht_start == timedelta(days=2)
    assert datetime.fromisoformat(finishing["scheduledStart"]) >= ht_end
    assert schedule_problems(result["operations"], now_utc=_at(MONDAY, 7)) == []


def _released_with_heat_treatment(shop, turnaround=3):
    types = shop["types"]
    job = _job(shop)
    first = _op(
        job,
        1,
        types["CUTTING"],
        worker=shop["ana"],
        status=OperationStatus.COMPLETED,
        actual_start=datetime.now(timezone.utc) - timedelta(days=20),
        actual_end=datetime.now(timezone.utc) - timedelta(days=19),
    )
    ht = _op(job, 2, types["HEAT_TREATMENT"], hours=None, turnaround_days=turnaround)
    nxt = _op(job, 3, types["FINISHING"], worker=shop["ana"])
    return job, first, ht, nxt


def test_send_out_and_return_gate_the_next_operation(client, shop):
    job, _first, ht, nxt = _released_with_heat_treatment(shop)
    today = shop_now().date()
    office = _headers(shop["office"])

    res = client.post(f"/api/v1/operations/{ht.id}/start", json={}, headers=_headers(shop["admin"]))
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "OPERATION_OUTSOURCED"

    res = client.post(f"/api/v1/operations/{ht.id}/return", json={"returnedDate": today.isoformat()}, headers=office)
    assert res.status_code == 409

    future = (today + timedelta(days=1)).isoformat()
    res = client.post(
        f"/api/v1/operations/{ht.id}/send-out",
        json={"sentOutDate": future, "sentTo": "Metro Heat"},
        headers=office,
    )
    assert res.status_code == 400
    res = client.post(
        f"/api/v1/operations/{ht.id}/send-out",
        json={"sentOutDate": today.isoformat(), "sentTo": ""},
        headers=office,
    )
    assert res.status_code == 400

    sent = today - timedelta(days=1)
    res = client.post(
        f"/api/v1/operations/{ht.id}/send-out",
        json={"sentOutDate": sent.isoformat(), "sentTo": "Metro Heat"},
        headers=office,
    )
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert body["status"] == "IN_PROGRESS"
    assert body["sentTo"] == "Metro Heat"
    assert body["expectedReturnDate"] == (sent + timedelta(days=3)).isoformat()
    assert db.session.get(JobOrder, job.id).status == JobOrderStatus.IN_PROGRESS

    res = client.post(f"/api/v1/operations/{nxt.id}/start", json={}, headers=_headers(shop["ana"]))
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "PRIOR_OPERATION_INCOMPLETE"

    res = client.post(
        f"/api/v1/operations/{ht.id}/return",
        json={"returnedDate": (sent - timedelta(days=1)).isoformat()},
        headers=office,
    )
    assert res.status_code == 400

    res = client.post(
        f"/api/v1/operations/{ht.id}/return", json={"returnedDate": today.isoformat()}, headers=office
    )
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["status"] == "COMPLETED"
    assert res.get_json()["returnedDate"] == today.isoformat()
    assert db.session.get(JobOrder, job.id).part_condition == PartCondition.HEAT_TREATED

    res = client.post(f"/api/v1/operations/{nxt.id}/start", json={}, headers=_headers(shop["ana"]))
    assert res.status_code == 200, res.get_json()


def test_workers_cannot_record_outsourced_work(client, shop):
    _job_row, _first, ht, _nxt = _released_with_heat_treatment(shop)
    res = client.post(
        f"/api/v1/operations/{ht.id}/send-out",
        json={"sentOutDate": shop_now().date().isoformat(), "sentTo": "X"},
        headers=_headers(shop["ana"]),
    )
    assert res.status_code == 403
    res = _assign(client, shop, ht, shop["ana"])
    assert res.status_code == 409


def test_outsourced_work_is_left_out_of_efficiency(shop):
    from app.services import analytics_service

    job = _job(shop)
    end = datetime.now(timezone.utc) - timedelta(days=2)
    # A Heat Treatment record from before it was outsourced: worker and hours.
    op = _op(
        job,
        1,
        shop["types"]["HEAT_TREATMENT"],
        worker=shop["ben"],
        status=OperationStatus.COMPLETED,
        actual_start=end - timedelta(hours=3),
        actual_end=end,
    )
    op.actual_worked_hours = Decimal("3")
    db.session.commit()

    by_worker = analytics_service.efficiency_by_worker(min_ops=1)
    by_type = analytics_service.efficiency_by_operation_type(min_ops=1)
    assert "Ben Helper" not in json.dumps(by_worker, default=str)
    assert "Heat Treatment" not in json.dumps(by_type, default=str)


def test_late_return_shows_as_outsourced_delay(shop):
    from app.services import analytics_service

    job, _first, ht, _nxt = _released_with_heat_treatment(shop, turnaround=2)
    today = shop_now().date()
    sent = today - timedelta(days=10)
    ht.status = OperationStatus.COMPLETED
    ht.sent_out_date = sent
    ht.sent_to = "Metro Heat"
    ht.actual_start = _at(sent, 8)
    ht.returned_date = today - timedelta(days=2)
    ht.actual_end = _at(today - timedelta(days=2), 17)
    db.session.commit()

    data = analytics_service.delays(
        (today - timedelta(days=30)).isoformat(), today.isoformat()
    )
    rows = [c for c in data["causes"] if c["cause"] == "OUTSOURCED_DELAY"]
    assert len(rows) == 1
    assert rows[0]["label"] == "Outsourced delay"
    assert rows[0]["causeType"] == "OUTSOURCED"
    assert rows[0]["hours"] > 0
    assert data["outsourcedDelays"][0]["sentTo"] == "Metro Heat"
