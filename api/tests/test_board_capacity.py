"""Board capacity: hours booked inside the period (clipped), less hours already
worked, over the shop's working hours on units that are not down. Plus the
board's stalled and machine-down flags."""

from datetime import datetime, time, timedelta, timezone
from decimal import Decimal

import pytest

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
from app.models.user import User, UserRole, UserStatus
from app.models.worker_profile import WorkerProfile
from app.models.worker_skill import WorkerSchedule
from app.services.analytics_service import capacity_type_rows
from app.services.board_service import capacity_for_period, schedule_board
from app.services.schedule_calendar import shop_local_to_utc, shop_now
from app.services.schedule_service import place_from_start


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


@pytest.fixture
def shop(app):
    admin = _user("cap_admin@test.local", UserRole.ADMIN, "Cap Admin")
    juan = _user("cap_juan@test.local", UserRole.PRODUCTION_WORKER, "Juan Dela")
    ana = _user("cap_ana@test.local", UserRole.PRODUCTION_WORKER, "Ana Lim")
    shaper = MachineType(code="SHAPER_CAP", name="Shaper", units=1)
    lathe = MachineType(code="LATHE_CAP", name="Lathe", units=2)
    db.session.add_all([shaper, lathe])
    db.session.flush()
    units = {
        "s1": MachineUnit(machine_type_id=shaper.id, label="Shaper #1", active=True),
        "l1": MachineUnit(machine_type_id=lathe.id, label="Lathe #1", active=True),
        "l2": MachineUnit(machine_type_id=lathe.id, label="Lathe #2", active=True),
    }
    client_row = Client(name="Cap Client")
    db.session.add_all([*units.values(), client_row])
    db.session.commit()
    return {"admin": admin, "juan": juan, "ana": ana, "client": client_row,
            "shaper": shaper, "lathe": lathe, **units}


def _monday(offset_days):
    d = shop_now().date() + timedelta(days=offset_days)
    return d - timedelta(days=d.weekday())


def _job(shop, status=JobOrderStatus.SCHEDULED):
    job = JobOrder(client_id=shop["client"].id, title="Cap Job", due_date=shop_now().date() + timedelta(days=90),
                   status=status, job_type=JobType.FABRICATION,
                   part_condition=PartCondition.RAW_MATERIAL,
                   material_status=MaterialStatus.NOT_REQUIRED, created_by_id=shop["admin"].id)
    db.session.add(job)
    db.session.commit()
    return job


def _scheduled(shop, lead, unit, start_local_date, start_t, hours, seq=1):
    job = _job(shop)
    s, e, _ = place_from_start(lead.id, shop_local_to_utc(start_local_date, start_t), hours)
    op = JobOperation(job_order_id=job.id, sequence_no=seq, operation_name=f"Step {seq}",
                      assigned_worker_id=lead.id, estimated_hours=Decimal(str(hours)),
                      machine_type_id=unit.machine_type_id, machine_unit_id=unit.id,
                      scheduled_start=s, scheduled_end=e, status=OperationStatus.SCHEDULED)
    db.session.add(op)
    db.session.commit()
    return op


def _week(monday):
    return shop_local_to_utc(monday, time(0, 0)), shop_local_to_utc(monday + timedelta(days=7), time(0, 0))


def _row(rows, code):
    return next(r for r in rows if r["machineTypeCode"] == code)


def test_shaper_week_counts_only_the_hours_inside_the_week(shop):
    monday = _monday(35)
    # 40 h Mon 08:00 -> Fri 17:00, then 14 h from Sat 10:00: 6 h fall on Saturday, 8 h next week.
    _scheduled(shop, shop["juan"], shop["s1"], monday, time(8, 0), 40)
    spill = _scheduled(shop, shop["juan"], shop["s1"], monday + timedelta(days=5), time(10, 0), 14, seq=2)
    assert spill.scheduled_end > _week(monday)[1]

    row = _row(capacity_for_period(*_week(monday)), "SHAPER_CAP")

    assert row["bookedHours"] == 46.0
    assert row["workedHours"] == 0.0
    assert row["availableHours"] == 48.0  # Mon-Sat 08:00-17:00 less the 12:00-13:00 break
    assert row["loadPct"] == pytest.approx(95.8, abs=0.05)
    # Not the old 54 h / 48 h = 112.5%
    assert row["loadPct"] < 100

    board = schedule_board(monday.isoformat(), (monday + timedelta(days=6)).isoformat())
    shaper = _row(board["summary"]["machineCapacity"], "SHAPER_CAP")
    assert shaper["loadPct"] == row["loadPct"]
    assert [c["machineTypeCode"] for c in board["summary"]["machinesNearFullCapacity"]].count("SHAPER_CAP") == 1


def _in_progress(shop, monday, *, paused_at=None):
    started = shop_local_to_utc(monday, time(8, 0))
    job = _job(shop, JobOrderStatus.IN_PROGRESS)
    op = JobOperation(job_order_id=job.id, sequence_no=1, operation_name="Slotting",
                      assigned_worker_id=shop["juan"].id, estimated_hours=Decimal("8"),
                      machine_type_id=shop["shaper"].id, machine_unit_id=shop["s1"].id,
                      scheduled_start=started, scheduled_end=shop_local_to_utc(monday, time(17, 0)),
                      actual_start=started, status=OperationStatus.IN_PROGRESS)
    db.session.add(op)
    db.session.flush()
    db.session.add(OperationTimeLog(operation_id=op.id, worker_id=shop["juan"].id,
                                    event=OperationTimeEvent.START, event_at=started))
    if paused_at:
        db.session.add(OperationTimeLog(operation_id=op.id, worker_id=shop["juan"].id,
                                        event=OperationTimeEvent.PAUSE,
                                        event_at=shop_local_to_utc(monday, paused_at),
                                        reason=OperationPauseReason.BREAK))
    db.session.commit()
    return op


def _day(monday):
    return shop_local_to_utc(monday, time(0, 0)), shop_local_to_utc(monday + timedelta(days=1), time(0, 0))


def test_hours_already_worked_are_not_counted_as_load(shop):
    monday = _monday(35)
    _in_progress(shop, monday)
    now = shop_local_to_utc(monday, time(10, 0))

    row = _row(capacity_for_period(*_day(monday), now=now), "SHAPER_CAP")

    # Clocked 08:00-10:00, then 6 h still to do from 10:00 (less the 12:00-13:00 break).
    assert row["bookedHours"] == 8.0
    assert row["workedHours"] == 2.0
    assert row["loadHours"] == 6.0
    assert row["availableHours"] == 8.0
    assert row["loadPct"] == 75.0


def test_time_spent_paused_is_not_booked(shop):
    monday = _monday(35)
    _in_progress(shop, monday, paused_at=time(10, 0))
    now = shop_local_to_utc(monday, time(14, 0))

    row = _row(capacity_for_period(*_day(monday), now=now), "SHAPER_CAP")

    # Worked 08:00-10:00, paused 10:00-14:00 (free), then 3 h of the 6 h left today.
    assert row["bookedHours"] == 5.0
    assert row["workedHours"] == 2.0
    assert row["loadHours"] == 3.0


def test_a_stalled_operation_is_flagged_and_stops_growing(shop):
    monday = _monday(-21)
    op = _in_progress(shop, monday, paused_at=time(12, 0))

    board = schedule_board(monday.isoformat(), monday.isoformat())
    flags = next(o for o in board["operations"] if o["id"] == op.id)
    assert flags["stalled"] is True
    assert flags["pausedAt"] is not None
    month = schedule_board(monday.isoformat(), (monday + timedelta(days=27)).isoformat())
    ends = [s["end"] for o in month["operations"] if o["id"] == op.id for s in o["segments"]]
    assert max(ends) < shop_local_to_utc(monday + timedelta(days=3), time(0, 0)).isoformat()


def test_a_unit_that_is_down_adds_no_available_hours(shop):
    monday = _monday(35)
    db.session.add(MachineDowntime(machine_unit_id=shop["l2"].id, started_at=datetime.now(timezone.utc),
                                   category=DowntimeCategory.MECHANICAL_FAILURE, reason="Spindle",
                                   reported_by_id=shop["admin"].id))
    db.session.commit()
    _scheduled(shop, shop["ana"], shop["l1"], monday, time(8, 0), 24)

    row = _row(capacity_for_period(*_week(monday)), "LATHE_CAP")

    assert row["units"] == 2
    assert row["unitsDown"] == 1
    assert row["availableHours"] == 48.0  # one working unit, not 96
    assert row["loadPct"] == 50.0


def test_a_unit_down_for_part_of_the_week_loses_only_those_hours(shop):
    monday = _monday(35)
    db.session.add(MachineDowntime(
        machine_unit_id=shop["l2"].id, category=DowntimeCategory.MECHANICAL_FAILURE, reason="Belt", reported_by_id=shop["admin"].id,
        started_at=shop_local_to_utc(monday, time(8, 0)),
        ended_at=shop_local_to_utc(monday + timedelta(days=2), time(8, 0)),
    ))
    db.session.commit()

    row = _row(capacity_for_period(*_week(monday)), "LATHE_CAP")

    assert row["unitsDown"] == 0
    assert row["availableHours"] == 80.0  # 48 + 48 less Mon and Tue on Lathe #2


def test_board_marks_work_booked_on_a_down_unit(shop):
    monday = _monday(35)
    op = _scheduled(shop, shop["ana"], shop["l2"], monday, time(8, 0), 8)
    db.session.add(MachineDowntime(machine_unit_id=shop["l2"].id, started_at=datetime.now(timezone.utc),
                                   category=DowntimeCategory.MECHANICAL_FAILURE, reason="Spindle",
                                   reported_by_id=shop["admin"].id))
    db.session.commit()

    board = schedule_board(monday.isoformat(), (monday + timedelta(days=6)).isoformat())
    row = next(o for o in board["operations"] if o["id"] == op.id)
    assert row["onDownUnit"] is True
    assert row["downtimeReason"] == "Spindle"
    other = _scheduled(shop, shop["juan"], shop["l1"], monday, time(8, 0), 8)
    board = schedule_board(monday.isoformat(), (monday + timedelta(days=6)).isoformat())
    assert next(o for o in board["operations"] if o["id"] == other.id)["onDownUnit"] is False


def test_analytics_workload_uses_the_board_rule():
    rows = capacity_type_rows([
        {"machineTypeId": "t1", "machineTypeCode": "SHAPER", "machineTypeName": "Shaper",
         "bookedHours": 46.0, "workedHours": 0.0, "loadHours": 46.0, "availableHours": 48.0,
         "units": 1, "unitsDown": 0, "loadPct": 95.8},
        {"machineTypeId": "t2", "machineTypeCode": "LATHE", "machineTypeName": "Lathe",
         "bookedHours": 0.0, "workedHours": 0.0, "loadHours": 0.0, "availableHours": 0.0,
         "units": 1, "unitsDown": 1, "loadPct": 0.0},
    ])
    shaper, lathe = rows
    assert shaper["scheduledLoadHours"] == 46.0
    assert shaper["projectedLoadPct"] == 95.8
    assert shaper["above80Pct"] is True
    assert lathe["projectedLoadPct"] is None
    assert lathe["unitsDown"] == 1
