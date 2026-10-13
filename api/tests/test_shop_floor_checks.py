"""Work already on the shop floor: overruns push later work back (with move
history and an Admin alert), stalled pauses are flagged and stop growing, and
work booked on a broken unit is moved or flagged."""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.extensions import db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.machine import MachineType, MachineUnit
from app.models.operation import JobOperation, OperationStatus
from app.models.operation_time import (
    DowntimeCategory,
    MachineDowntime,
    OperationPauseReason,
    OperationTimeEvent,
    OperationTimeLog,
)
from app.models.schedule_move import DelayKind, ScheduleMove
from app.models.staff_alert import StaffAlert, StaffAlertKind
from app.models.user import User, UserRole, UserStatus
from app.models.worker_profile import WorkerProfile
from app.models.worker_skill import WorkerSchedule, WorkerSkill
from app.services import shop_floor_check_service as checks
from app.services.operation_service import open_machine_downtime
from app.services.schedule_calendar import ensure_utc, shop_local_to_utc, shop_now
from app.services.schedule_service import (
    _operation_booking_envelope,
    operation_working_segments,
    place_from_start,
)


def _now():
    return datetime.now(timezone.utc).replace(microsecond=0)


def _user(email, role, name):
    user = User(email=email, password_hash="x", full_name=name, role=role,
                status=UserStatus.ACTIVE, active=True)
    db.session.add(user)
    db.session.flush()
    if role == UserRole.PRODUCTION_WORKER:
        db.session.add(WorkerProfile(user_id=user.id))
        for dow in range(7):
            db.session.add(WorkerSchedule(worker_id=user.id, day_of_week=dow, is_working=dow < 6,
                                          start_time=time(8, 0), end_time=time(17, 0)))
    return user


def _headers(user):
    token = create_access_token(identity=user.id, additional_claims={"role": user.role.value})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def shop(app):
    admin = _user("sf_admin@test.local", UserRole.ADMIN, "Sf Admin")
    office = _user("sf_office@test.local", UserRole.OFFICE_STAFF, "Sf Office")
    juan = _user("sf_juan@test.local", UserRole.PRODUCTION_WORKER, "Juan Dela")
    ana = _user("sf_ana@test.local", UserRole.PRODUCTION_WORKER, "Ana Lim")
    ben = _user("sf_ben@test.local", UserRole.PRODUCTION_WORKER, "Ben Cruz")
    mill = MachineType(code="MILL_SF", name="Milling", units=2)
    lathe = MachineType(code="LATHE_SF", name="Lathe", units=3)
    drill = MachineType(code="DRILL_SF", name="Drilling", units=1)
    db.session.add_all([mill, lathe, drill])
    db.session.flush()
    units = {
        "m1": MachineUnit(machine_type_id=mill.id, label="Milling #1", active=True),
        "m2": MachineUnit(machine_type_id=mill.id, label="Milling #2", active=True),
        "la": MachineUnit(machine_type_id=lathe.id, label="Lathe #1", active=True,
                          default_operator_id=juan.id),
        "lb": MachineUnit(machine_type_id=lathe.id, label="Lathe #2", active=True,
                          default_operator_id=ben.id),
        "lc": MachineUnit(machine_type_id=lathe.id, label="Lathe #3", active=True),
        "d1": MachineUnit(machine_type_id=drill.id, label="Drilling #1", active=True),
    }
    client_row = Client(name="Sf Client")
    db.session.add_all([*units.values(), client_row])
    for person in (juan, ana, ben):
        for mtype in (mill, lathe, drill):
            db.session.add(WorkerSkill(worker_id=person.id, machine_type_id=mtype.id, proficiency=3))
    db.session.commit()
    return {"admin": admin, "office": office, "juan": juan, "ana": ana, "ben": ben,
            "client": client_row, **units}


def _job(shop, status=JobOrderStatus.SCHEDULED):
    job = JobOrder(client_id=shop["client"].id, title="Sf Job", due_date=shop_now().date() + timedelta(days=40),
                   status=status, job_type=JobType.FABRICATION,
                   part_condition=PartCondition.RAW_MATERIAL,
                   material_status=MaterialStatus.NOT_REQUIRED, created_by_id=shop["admin"].id)
    db.session.add(job)
    db.session.commit()
    return job


def _scheduled(shop, lead, unit, start, hours, job=None, seq=1):
    job = job or _job(shop)
    s, e, _ = place_from_start(lead.id, start, hours)
    op = JobOperation(job_order_id=job.id, sequence_no=seq, operation_name=f"Step {seq}",
                      assigned_worker_id=lead.id, estimated_hours=Decimal(str(hours)),
                      machine_type_id=unit.machine_type_id, machine_unit_id=unit.id,
                      scheduled_start=s, scheduled_end=e, status=OperationStatus.SCHEDULED)
    db.session.add(op)
    db.session.commit()
    return op


def _running(shop, lead, unit, *, started, hours, planned_end, paused=None, reason=OperationPauseReason.BREAK):
    job = _job(shop, JobOrderStatus.IN_PROGRESS)
    op = JobOperation(job_order_id=job.id, sequence_no=1, operation_name="Slotting",
                      assigned_worker_id=lead.id, estimated_hours=Decimal(str(hours)),
                      machine_type_id=unit.machine_type_id, machine_unit_id=unit.id,
                      scheduled_start=started, scheduled_end=planned_end, actual_start=started,
                      status=OperationStatus.IN_PROGRESS)
    db.session.add(op)
    db.session.flush()
    db.session.add(OperationTimeLog(operation_id=op.id, worker_id=lead.id,
                                    event=OperationTimeEvent.START, event_at=started))
    if paused:
        db.session.add(OperationTimeLog(operation_id=op.id, worker_id=lead.id,
                                        event=OperationTimeEvent.PAUSE, event_at=paused, reason=reason))
    db.session.commit()
    return op


def _clash_free():
    """No two released operations share a worker or unit at the same working time
    (a paused op's finish creeps with the clock, so overlaps under a minute are drift)."""
    ops = (JobOperation.query.join(JobOrder).filter(JobOrder.status != JobOrderStatus.DRAFT,
                                                    JobOperation.status != OperationStatus.COMPLETED).all())
    segs = {op.id: operation_working_segments(op) for op in ops}
    for i, a in enumerate(ops):
        for b in ops[i + 1:]:
            shared = set(a.crew_ids) & set(b.crew_ids) or (a.machine_unit_id and a.machine_unit_id == b.machine_unit_id)
            if shared and any(min(e, be) - max(s, bs) > timedelta(minutes=1)
                              for s, e in segs[a.id] for bs, be in segs[b.id]):
                return False
    return True


def _alerts(kind):
    return StaffAlert.query.filter_by(kind=kind).all()


# --- 6. Overruns move later work ----------------------------------------------------


def _overrun_case(shop):
    now = _now()
    running = _running(shop, shop["juan"], shop["m2"], started=now - timedelta(hours=3), hours=10,
                       planned_end=now - timedelta(hours=1), paused=now - timedelta(minutes=30))
    same_worker = _scheduled(shop, shop["juan"], shop["m1"], now, 2)
    same_unit = _scheduled(shop, shop["ana"], shop["m2"], now, 3)
    unrelated = _scheduled(shop, shop["ben"], shop["m1"], now + timedelta(days=7), 2)
    return running, same_worker, same_unit, unrelated


def test_overrun_moves_clashing_unstarted_work_later_with_history_and_an_alert(app, shop):
    running, same_worker, same_unit, unrelated = _overrun_case(shop)
    unrelated_start = ensure_utc(unrelated.scheduled_start)
    clashes = checks.overrun_clashes()
    assert {op.id for c in clashes for op in c["affected"]} == {same_worker.id, same_unit.id}

    result = checks.shift_work_behind_overruns()
    assert {r["jobId"] for r in result["moved"]} == {same_worker.job_order_id, same_unit.job_order_id}
    db.session.expire_all()
    # Recomputed a moment after the move, so the paused op's finish may have crept on.
    finish = _operation_booking_envelope(db.session.get(JobOperation, running.id))[1]
    for op_id in (same_worker.id, same_unit.id):
        op = db.session.get(JobOperation, op_id)
        assert ensure_utc(op.scheduled_start) >= finish - timedelta(minutes=1)
        assert op.assigned_worker_id in (shop["juan"].id, shop["ana"].id)
    assert db.session.get(JobOperation, same_unit.id).machine_unit_id == shop["m2"].id
    assert ensure_utc(db.session.get(JobOperation, unrelated.id).scheduled_start) == unrelated_start

    moves = ScheduleMove.query.filter_by(kind=DelayKind.OVERRUN).all()
    assert {m.job_order_id for m in moves} == {same_worker.job_order_id, same_unit.job_order_id}
    assert all("running over" in m.reason for m in moves)
    alerts = _alerts(StaffAlertKind.WORK_MOVED)
    assert alerts and all(a.recipient_id == shop["admin"].id for a in alerts)
    assert checks.overrun_clashes() == []
    assert _clash_free()


def test_overrun_within_the_slack_is_not_a_clash(app, shop):
    now = _now()
    running = _running(shop, shop["juan"], shop["m2"], started=now - timedelta(hours=1), hours=4,
                       planned_end=now)
    finish = _operation_booking_envelope(running, now)[1]
    running.scheduled_end = finish - checks.OVERRUN_SLACK + timedelta(minutes=5)
    db.session.commit()
    _scheduled(shop, shop["ana"], shop["m2"], ensure_utc(running.scheduled_end), 2)
    assert checks.overrun_clashes(now) == []

    running.scheduled_end = finish - checks.OVERRUN_SLACK - timedelta(hours=1)
    db.session.commit()
    _scheduled(shop, shop["ben"], shop["m2"], ensure_utc(running.scheduled_end), 1)
    assert checks.overrun_clashes(now)


def test_no_move_when_the_running_work_is_on_time(app, shop):
    now = _now()
    _running(shop, shop["juan"], shop["m2"], started=now - timedelta(hours=1), hours=2,
             planned_end=now + timedelta(days=3))
    later = _scheduled(shop, shop["juan"], shop["m2"], now + timedelta(days=5), 2)
    start = ensure_utc(later.scheduled_start)
    assert checks.shift_work_behind_overruns()["moved"] == []
    assert ensure_utc(db.session.get(JobOperation, later.id).scheduled_start) == start


def test_recording_a_pause_runs_the_overrun_check(client, shop):
    now = _now()
    running = _running(shop, shop["juan"], shop["m2"], started=now - timedelta(hours=2), hours=10,
                       planned_end=now - timedelta(hours=1))
    waiting = _scheduled(shop, shop["juan"], shop["m1"], now, 2)
    assert checks.overrun_clashes()
    res = client.post(f"/api/v1/operations/{running.id}/pause", json={"reason": "BREAK"},
                      headers=_headers(shop["juan"]))
    assert res.status_code == 200, res.get_json()
    db.session.expire_all()
    assert ScheduleMove.query.filter_by(job_order_id=waiting.job_order_id, kind=DelayKind.OVERRUN).count() == 1
    assert checks.overrun_clashes() == []


def test_work_that_cannot_be_placed_marks_the_job_needs_replan(app, shop):
    now = _now()
    _running(shop, shop["juan"], shop["m2"], started=now - timedelta(hours=2), hours=10,
             planned_end=now - timedelta(hours=1), paused=now - timedelta(minutes=10))
    # Juan's next job is on the only drill, which is down with no repair date.
    waiting = _scheduled(shop, shop["juan"], shop["d1"], now, 2)
    start = ensure_utc(waiting.scheduled_start)
    db.session.add(MachineDowntime(machine_unit_id=shop["d1"].id, started_at=now,
                                   category=DowntimeCategory.MECHANICAL_FAILURE, reason="Motor",
                                   reported_by_id=shop["admin"].id))
    db.session.commit()
    result = checks.shift_work_behind_overruns()
    assert [r["jobId"] for r in result["notPlaced"]] == [waiting.job_order_id]
    db.session.expire_all()
    assert ensure_utc(db.session.get(JobOperation, waiting.id).scheduled_start) == start
    assert db.session.get(JobOrder, waiting.job_order_id).needs_replan_reason
    assert _alerts(StaffAlertKind.NEEDS_REPLAN)


# --- 7. Stalled pauses ------------------------------------------------------------------


def test_a_pause_over_a_working_day_is_stalled_flagged_once_and_stops_growing(app, shop):
    now = _now()
    paused = now - timedelta(days=4)
    op = _running(shop, shop["juan"], shop["m2"], started=paused - timedelta(hours=1), hours=10,
                  planned_end=paused + timedelta(hours=2), paused=paused,
                  reason=OperationPauseReason.END_OF_SHIFT)
    assert [o.id for o, _ in checks.stalled_operations()] == [op.id]
    assert checks.flag_stalled() == 1
    assert checks.flag_stalled() == 0
    alert = _alerts(StaffAlertKind.OPERATION_STALLED)[0]
    assert "is stalled" in alert.title and "Resume it, re-plan or reassign it" in alert.message
    today = _operation_booking_envelope(op, now)
    next_week = _operation_booking_envelope(op, now + timedelta(days=7))
    assert today == next_week


def test_a_recent_pause_is_not_stalled_and_its_booking_follows_now(app, shop):
    now = _now()
    op = _running(shop, shop["juan"], shop["m2"], started=now - timedelta(hours=2), hours=10,
                  planned_end=now + timedelta(hours=1), paused=now - timedelta(minutes=20))
    assert checks.stalled_operations() == []
    assert _operation_booking_envelope(op, now) != _operation_booking_envelope(op, now + timedelta(days=7))


def test_resuming_clears_the_stall(app, shop):
    now = _now()
    paused = now - timedelta(days=4)
    op = _running(shop, shop["juan"], shop["m2"], started=paused - timedelta(hours=1), hours=10,
                  planned_end=paused + timedelta(hours=2), paused=paused)
    db.session.add(OperationTimeLog(operation_id=op.id, worker_id=shop["juan"].id,
                                    event=OperationTimeEvent.RESUME, event_at=now - timedelta(minutes=5)))
    db.session.commit()
    assert checks.stalled_operations() == []


# --- 8. Breakdown report: move the booked work -------------------------------------------


def _soon():
    return _now() + timedelta(days=1)


def _down(shop, unit, repair=None):
    return open_machine_downtime(unit.id, shop["admin"].id, "MECHANICAL_FAILURE",
                                 reporter_role=UserRole.ADMIN.value, expected_repair_date=repair)


def test_breakdown_options_list_the_booked_work_and_default_to_another_unit(app, shop):
    op = _scheduled(shop, shop["juan"], shop["la"], _soon(), 3)
    _down(shop, shop["la"])
    options = checks.breakdown_options(shop["la"].id)
    assert [o["id"] for o in options["operations"]] == [op.id]
    assert options["canMoveToUnit"] is True
    assert options["canMoveAfterRepair"] is False
    assert options["defaultAction"] == checks.MOVE_UNIT
    assert {u["label"] for u in options["otherUnits"]} == {"Lathe #2", "Lathe #3"}


def test_moving_to_another_unit_prefers_one_with_no_operator_or_a_free_one(app, shop):
    op = _scheduled(shop, shop["juan"], shop["la"], _soon(), 3)
    # Ben, Lathe #2's operator, is busy then on another machine.
    _scheduled(shop, shop["ben"], shop["m1"], ensure_utc(op.scheduled_start), 8)
    _down(shop, shop["la"])
    result = checks.resolve_breakdown(shop["la"].id, checks.MOVE_UNIT)
    assert [r["jobId"] for r in result["moved"]] == [op.job_order_id]
    db.session.expire_all()
    moved = db.session.get(JobOperation, op.id)
    assert moved.machine_unit_id == shop["lc"].id
    assert moved.assigned_worker_id == shop["juan"].id
    move = ScheduleMove.query.filter_by(job_order_id=op.job_order_id, kind=DelayKind.BREAKDOWN).one()
    assert "from Lathe #1 to Lathe #3" in move.reason
    assert _alerts(StaffAlertKind.WORK_MOVED)
    assert checks.work_on_down_units() == []


def test_moving_after_the_repair_keeps_the_unit(app, shop):
    op = _scheduled(shop, shop["juan"], shop["la"], _soon(), 3)
    repair = shop_now().date() + timedelta(days=4)
    _down(shop, shop["la"], repair.isoformat())
    checks.resolve_breakdown(shop["la"].id, checks.AFTER_REPAIR)
    db.session.expire_all()
    moved = db.session.get(JobOperation, op.id)
    assert moved.machine_unit_id == shop["la"].id
    assert ensure_utc(moved.scheduled_start) >= shop_local_to_utc(repair + timedelta(days=1), time(0, 0))


def test_after_repair_needs_a_repair_date(app, shop):
    from app.utils.errors import AppError

    _scheduled(shop, shop["juan"], shop["la"], _soon(), 3)
    _down(shop, shop["la"])
    with pytest.raises(AppError):
        checks.resolve_breakdown(shop["la"].id, checks.AFTER_REPAIR)


def test_leave_as_is_moves_nothing(app, shop):
    op = _scheduled(shop, shop["juan"], shop["la"], _soon(), 3)
    start = ensure_utc(op.scheduled_start)
    _down(shop, shop["la"])
    result = checks.resolve_breakdown(shop["la"].id, checks.LEAVE)
    assert result["left"] == [op.id]
    db.session.expire_all()
    kept = db.session.get(JobOperation, op.id)
    assert kept.machine_unit_id == shop["la"].id and ensure_utc(kept.scheduled_start) == start


def test_no_repair_date_and_no_other_unit_marks_needs_replan(app, shop):
    op = _scheduled(shop, shop["juan"], shop["d1"], _soon(), 3)
    _down(shop, shop["d1"])
    options = checks.breakdown_options(shop["d1"].id)
    assert options["needsReplan"] is True and options["defaultAction"] is None
    result = checks.resolve_breakdown(shop["d1"].id, checks.MOVE_UNIT)
    assert result["needsReplan"] == [op.job_order.job_number]
    db.session.expire_all()
    assert "Drilling #1 is down" in db.session.get(JobOrder, op.job_order_id).needs_replan_reason


def test_breakdown_endpoints(client, shop):
    _scheduled(shop, shop["juan"], shop["la"], _soon(), 3)
    res = client.post(f"/api/v1/operations/machine-units/{shop['la'].id}/downtime",
                      json={"category": "MECHANICAL_FAILURE"}, headers=_headers(shop["office"]))
    assert res.status_code == 201, res.get_json()
    assert len(res.get_json()["work"]["operations"]) == 1
    url = f"/api/v1/operations/machine-units/{shop['la'].id}/downtime/work"
    assert client.get(url, headers=_headers(shop["office"])).status_code == 200
    assert client.post(url, json={"action": "MOVE_UNIT"}, headers=_headers(shop["office"])).status_code == 403
    res = client.post(url, json={"action": "MOVE_UNIT"}, headers=_headers(shop["admin"]))
    assert res.status_code == 200, res.get_json()
    assert len(res.get_json()["moved"]) == 1
    assert client.post(url, json={"action": "NOPE"}, headers=_headers(shop["admin"])).status_code == 400


# --- 9. Background flags for down units --------------------------------------------------


def test_work_left_on_a_down_unit_is_flagged_once(app, shop):
    op = _scheduled(shop, shop["juan"], shop["la"], _soon(), 3)
    _down(shop, shop["la"])
    assert [o.id for o, _ in checks.work_on_down_units()] == [op.id]
    assert checks.flag_work_on_down_units() == 1
    assert checks.flag_work_on_down_units() == 0
    assert "which is down" in _alerts(StaffAlertKind.WORK_ON_DOWN_UNIT)[0].title


def test_work_after_the_expected_repair_is_not_flagged(app, shop):
    repair = shop_now().date() + timedelta(days=1)
    _scheduled(shop, shop["juan"], shop["la"], shop_local_to_utc(repair + timedelta(days=3), time(8)), 3)
    _down(shop, shop["la"], repair.isoformat())
    assert checks.work_on_down_units() == []


def test_background_marks_needs_replan_with_no_way_forward(app, shop):
    op = _scheduled(shop, shop["juan"], shop["d1"], _soon(), 3)
    _down(shop, shop["d1"])
    checks.flag_work_on_down_units()
    db.session.commit()
    assert db.session.get(JobOrder, op.job_order_id).needs_replan_reason


def test_a_passed_repair_date_asks_the_admin_to_update_it(app, shop):
    row = _down(shop, shop["la"], (shop_now().date() + timedelta(days=1)).isoformat())
    row.expected_repair_date = shop_now().date() - timedelta(days=1)
    db.session.commit()
    assert checks.flag_passed_repair_dates() == 1
    assert checks.flag_passed_repair_dates() == 0
    assert "expected repair date has passed" in _alerts(StaffAlertKind.REPAIR_DATE_PASSED)[0].title


def test_the_background_run_includes_the_shop_floor_checks(app, shop):
    from app.services.overdue_delivery_service import run_checks

    now = _now()
    _running(shop, shop["juan"], shop["m2"], started=now - timedelta(days=5), hours=10,
             planned_end=now - timedelta(days=4), paused=now - timedelta(days=4, hours=23))
    assert run_checks(app) is True
    assert _alerts(StaffAlertKind.OPERATION_STALLED)
