"""Tests for earliest-fit scheduling."""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from app.constants.scheduling import SCHEDULE_HORIZON_DAYS
from app.models.worker_skill import CalendarExceptionType
from app.services.schedule_calendar import (
    SHOP_TZ,
    build_worker_working_windows,
    place_duration,
    shop_local_to_utc,
)
from app.services.schedule_service import (
    MISSING_WORKER_MESSAGE,
    compute_schedule_flag,
    propose_schedule,
    validate_schedule,
)

SHOP = SHOP_TZ


def _mon_sat_schedule_by_dow():
    rows = {}
    for dow in range(7):
        working = dow < 6
        rows[dow] = SimpleNamespace(
            day_of_week=dow,
            is_working=working,
            start_time=time(8, 0) if working else None,
            end_time=time(17, 0) if working else None,
        )
    return rows


def _lathe_units(lathe_id="lathe-1", unit_a="u1", unit_b="u2"):
    units = [
        SimpleNamespace(id=unit_a, machine_type_id=lathe_id, label="Lathe #1", active=True),
        SimpleNamespace(id=unit_b, machine_type_id=lathe_id, label="Lathe #2", active=True),
    ]
    return {lathe_id: units}


def _anchor(year=2026, month=8, day=10, hour=8):
    return shop_local_to_utc(date(year, month, day), time(hour, 0))


@pytest.fixture
def schedule_patches(monkeypatch):
    schedule_by_dow = _mon_sat_schedule_by_dow()
    lathe_id = "lathe-type-1"

    monkeypatch.setattr(
        "app.services.schedule_service.load_worker_schedule_maps",
        lambda worker_id: schedule_by_dow,
    )
    monkeypatch.setattr(
        "app.services.schedule_service.load_calendar_exceptions",
        lambda start, end: {},
    )
    monkeypatch.setattr(
        "app.services.schedule_service._load_external_bookings",
        lambda exclude_job_id=None, exclude_operation_ids=None: ({}, {}),
    )
    monkeypatch.setattr(
        "app.services.schedule_service._machine_units_by_type",
        lambda: _lathe_units(lathe_id),
    )
    return {"lathe_id": lathe_id, "schedule_by_dow": schedule_by_dow}


def test_place_duration_spans_multiple_working_days():
    schedule_by_dow = _mon_sat_schedule_by_dow()
    anchor = _anchor(hour=15)
    end = anchor + timedelta(days=SCHEDULE_HORIZON_DAYS)
    windows = build_worker_working_windows(schedule_by_dow, {}, anchor, end)
    start, finish, _ = place_duration(windows, timedelta(hours=5), anchor, end)
    assert start is not None
    assert finish is not None
    # Calendar span includes non-working overnight gap between shifts.
    assert start.astimezone(SHOP).hour == 15
    assert start.astimezone(SHOP).date() == date(2026, 8, 10)
    assert finish.astimezone(SHOP).date() == date(2026, 8, 11)
    assert finish.astimezone(SHOP).hour == 11
    assert (finish - start).total_seconds() == pytest.approx(20 * 3600, rel=1e-6)


def test_six_hour_op_from_1400_finishes_next_day_no_outside_hours_warning(monkeypatch):
    """6h from 14:00 on Mon–Sat 08–17 finishes next working day; two segments; validate clean."""
    schedule_by_dow = _mon_sat_schedule_by_dow()
    worker_id = "worker-1"
    monkeypatch.setattr(
        "app.services.schedule_service.load_worker_schedule_maps",
        lambda wid: schedule_by_dow,
    )
    monkeypatch.setattr(
        "app.services.schedule_service.load_calendar_exceptions",
        lambda start_d, end_d: {},
    )
    monkeypatch.setattr(
        "app.services.schedule_service._load_external_bookings",
        lambda **kwargs: ({}, {}),
    )
    monkeypatch.setattr(
        "app.services.schedule_service._machine_units_by_type",
        lambda: {},
    )

    anchor = shop_local_to_utc(date(2026, 8, 10), time(14, 0))  # Monday
    result = propose_schedule(
        [
            {
                "sequenceNo": 1,
                "operationName": "Long turn",
                "assignedWorkerId": worker_id,
                "machineTypeId": None,
                "estimatedHours": 6,
            }
        ],
        date(2026, 8, 20),
        anchor_utc=anchor,
    )
    op = result["operations"][0]
    assert op["scheduled"] is True
    start = datetime.fromisoformat(op["scheduledStart"]).astimezone(SHOP)
    finish = datetime.fromisoformat(op["scheduledEnd"]).astimezone(SHOP)
    assert start.date() == date(2026, 8, 10)
    assert start.hour == 14
    # 14:00–17:00 = 3h, then Tue 08:00–11:00 = 3h
    assert finish.date() == date(2026, 8, 11)
    assert finish.hour == 11
    assert finish.minute == 0

    segments = op["segments"]
    assert len(segments) == 2
    seg0 = datetime.fromisoformat(segments[0]["start"]).astimezone(SHOP)
    seg0e = datetime.fromisoformat(segments[0]["end"]).astimezone(SHOP)
    seg1 = datetime.fromisoformat(segments[1]["start"]).astimezone(SHOP)
    seg1e = datetime.fromisoformat(segments[1]["end"]).astimezone(SHOP)
    assert (seg0.hour, seg0.minute) == (14, 0)
    assert (seg0e.hour, seg0e.minute) == (17, 0)
    assert seg1.date() == date(2026, 8, 11)
    assert (seg1.hour, seg1.minute) == (8, 0)
    assert (seg1e.hour, seg1e.minute) == (11, 0)

    validation = validate_schedule(
        [
            {
                "sequenceNo": 1,
                "operationName": "Long turn",
                "assignedWorkerId": worker_id,
                "scheduledStart": op["scheduledStart"],
                "scheduledEnd": op["scheduledEnd"],
            }
        ],
        due_date=date(2026, 8, 20),
    )
    outside = [w for w in validation["warnings"] if w["code"] == "OUTSIDE_WORKING_HOURS"]
    assert outside == []


def test_overnight_gap_not_counted_as_machine_busy(schedule_patches, monkeypatch):
    """Envelope spans overnight but busy intervals are only working segments."""
    from app.models.operation import OperationStatus
    from app.services.schedule_service import _busy_intervals_for_operation

    schedule_by_dow = schedule_patches["schedule_by_dow"]
    monkeypatch.setattr(
        "app.services.schedule_service.load_worker_schedule_maps",
        lambda wid: schedule_by_dow,
    )
    monkeypatch.setattr(
        "app.services.schedule_service.load_calendar_exceptions",
        lambda start_d, end_d: {},
    )

    start = shop_local_to_utc(date(2026, 8, 10), time(14, 0))
    end = shop_local_to_utc(date(2026, 8, 11), time(11, 0))
    unit_id = "unit-1"
    op = SimpleNamespace(
        status=OperationStatus.SCHEDULED,
        assigned_worker_id="worker-1",
        machine_unit_id=unit_id,
        scheduled_start=start,
        scheduled_end=end,
        actual_start=None,
        actual_end=None,
    )

    intervals = _busy_intervals_for_operation(op)
    assert len(intervals) == 2
    gap_probe = shop_local_to_utc(date(2026, 8, 10), time(20, 0))
    for s, e in intervals:
        assert not (s <= gap_probe < e)

    machine_busy = {unit_id: list(intervals)}
    worker_busy = {"worker-1": list(intervals)}
    monkeypatch.setattr(
        "app.services.schedule_service._load_external_bookings",
        lambda **kwargs: (worker_busy, machine_busy),
    )
    result = propose_schedule(
        [
            {
                "sequenceNo": 1,
                "operationName": "Follow-on",
                "assignedWorkerId": "worker-1",
                "machineTypeId": None,
                "estimatedHours": 1,
            }
        ],
        date(2026, 8, 20),
        anchor_utc=shop_local_to_utc(date(2026, 8, 10), time(18, 0)),
    )
    follow = result["operations"][0]
    assert follow["scheduled"] is True
    follow_start = datetime.fromisoformat(follow["scheduledStart"]).astimezone(SHOP)
    assert follow_start.date() == date(2026, 8, 11)
    assert follow_start.hour == 11


def test_manual_window_outside_hours_still_warns(monkeypatch):
    schedule_by_dow = _mon_sat_schedule_by_dow()
    monkeypatch.setattr(
        "app.services.schedule_service.load_worker_schedule_maps",
        lambda wid: schedule_by_dow,
    )
    monkeypatch.setattr(
        "app.services.schedule_service.load_calendar_exceptions",
        lambda start_d, end_d: {},
    )
    # 16:00–20:00 overhangs past 17:00
    start = shop_local_to_utc(date(2026, 8, 10), time(16, 0))
    end = shop_local_to_utc(date(2026, 8, 10), time(20, 0))
    validation = validate_schedule(
        [
            {
                "sequenceNo": 1,
                "operationName": "Late",
                "assignedWorkerId": "worker-1",
                "scheduledStart": start.isoformat(),
                "scheduledEnd": end.isoformat(),
            }
        ],
        due_date=date(2026, 8, 20),
    )
    outside = [w for w in validation["warnings"] if w["code"] == "OUTSIDE_WORKING_HOURS"]
    assert len(outside) >= 1


def test_existing_booking_forces_later_slot(schedule_patches, monkeypatch):
    f = schedule_patches
    worker_id = "worker-1"
    block_start = _anchor(hour=8)
    block_end = _anchor(hour=12)
    monkeypatch.setattr(
        "app.services.schedule_service._load_external_bookings",
        lambda **kwargs: ({worker_id: [(block_start, block_end)]}, {}),
    )
    result = propose_schedule(
        [
            {
                "sequenceNo": 1,
                "operationName": "Turning",
                "assignedWorkerId": worker_id,
                "machineTypeId": f["lathe_id"],
                "estimatedHours": 2,
            }
        ],
        date(2026, 8, 20),
        anchor_utc=_anchor(hour=8),
    )
    op = result["operations"][0]
    assert op["scheduled"]
    assert op["scheduledStart"] == block_end.isoformat()


def test_all_machine_units_busy(schedule_patches, monkeypatch):
    f = schedule_patches
    worker_id = "worker-1"
    anchor = _anchor(hour=8)
    machine_busy = {
        "u1": [(anchor, anchor + timedelta(days=SCHEDULE_HORIZON_DAYS))],
        "u2": [(anchor, anchor + timedelta(days=SCHEDULE_HORIZON_DAYS))],
    }
    monkeypatch.setattr(
        "app.services.schedule_service._load_external_bookings",
        lambda **kwargs: ({}, machine_busy),
    )
    result = propose_schedule(
        [
            {
                "sequenceNo": 1,
                "operationName": "Turning",
                "assignedWorkerId": worker_id,
                "machineTypeId": f["lathe_id"],
                "estimatedHours": 2,
            }
        ],
        date(2026, 8, 20),
        anchor_utc=anchor,
    )
    op = result["operations"][0]
    assert not op["scheduled"]
    assert "all machine units busy" in op["message"]
    assert op["placeableHours"] == 0.0


def test_no_machine_type_worker_only(schedule_patches):
    result = propose_schedule(
        [
            {
                "sequenceNo": 1,
                "operationName": "Heat Treatment",
                "assignedWorkerId": "worker-1",
                "machineTypeId": None,
                "estimatedHours": 2,
            }
        ],
        date(2026, 8, 20),
        anchor_utc=_anchor(hour=8),
    )
    op = result["operations"][0]
    assert op["scheduled"]
    assert op["machineUnitId"] is None


def test_missing_worker_not_proposed(schedule_patches):
    result = propose_schedule(
        [
            {
                "sequenceNo": 1,
                "operationName": "Turning",
                "assignedWorkerId": None,
                "machineTypeId": schedule_patches["lathe_id"],
                "estimatedHours": 2,
            }
        ],
        date(2026, 8, 20),
        anchor_utc=_anchor(hour=8),
    )
    op = result["operations"][0]
    assert not op["scheduled"]
    assert op["message"] == MISSING_WORKER_MESSAGE


def test_estimated_hours_default_flag(schedule_patches):
    result = propose_schedule(
        [
            {
                "sequenceNo": 1,
                "operationName": "Checking",
                "assignedWorkerId": "worker-1",
                "estimatedHours": None,
            }
        ],
        date(2026, 8, 20),
        anchor_utc=_anchor(hour=8),
    )
    op = result["operations"][0]
    assert op["estimatedHoursDefaulted"] is True
    assert op["estimatedHours"] == 1.0


def test_schedule_flags_green_amber_red():
    due = date(2026, 8, 15)
    green_end = shop_local_to_utc(date(2026, 8, 15), time(17, 0))
    amber_end = shop_local_to_utc(date(2026, 8, 16), time(10, 0))
    red_end = shop_local_to_utc(date(2026, 8, 17), time(8, 0))
    assert compute_schedule_flag(green_end, due) == "GREEN"
    assert compute_schedule_flag(amber_end, due) == "AMBER"
    assert compute_schedule_flag(red_end, due) == "RED"


def test_schedule_flag_uses_shop_local_date_not_utc():
    """23:00 Manila on the due date must be GREEN (not AMBER via UTC date)."""
    due = date(2026, 8, 15)
    end_manila_2300 = shop_local_to_utc(due, time(23, 0))
    assert end_manila_2300.astimezone(SHOP).date() == due
    assert compute_schedule_flag(end_manila_2300, due) == "GREEN"

    # After midnight Manila = next local day; UTC is still due_date (16:30Z).
    # Using UTC .date() would wrongly stay GREEN — shop local must yield AMBER.
    just_after_midnight = shop_local_to_utc(date(2026, 8, 16), time(0, 30))
    assert just_after_midnight.astimezone(timezone.utc).date() == due
    assert compute_schedule_flag(just_after_midnight, due) == "AMBER"


def test_cannot_place_within_horizon(schedule_patches):
    result = propose_schedule(
        [
            {
                "sequenceNo": 1,
                "operationName": "Marathon",
                "assignedWorkerId": "worker-1",
                "estimatedHours": 9999,
            }
        ],
        date(2027, 1, 1),
        anchor_utc=_anchor(hour=8),
    )
    op = result["operations"][0]
    assert not op["scheduled"]
    assert str(SCHEDULE_HORIZON_DAYS) in op["message"]
    assert op["placeableHours"] > 0
    assert op["requiredHours"] == 9999


def test_operation_spanning_midnight_local():
    schedule_by_dow = _mon_sat_schedule_by_dow()
    schedule_by_dow[0] = SimpleNamespace(
        day_of_week=0,
        is_working=True,
        start_time=time(18, 0),
        end_time=time(22, 0),
    )
    anchor = shop_local_to_utc(date(2026, 8, 10), time(20, 0))
    end = anchor + timedelta(days=7)
    windows = build_worker_working_windows(schedule_by_dow, {}, anchor, end)
    start, finish, _ = place_duration(windows, timedelta(hours=4), anchor, end)
    assert start.astimezone(SHOP).hour == 20
    assert finish.astimezone(SHOP).date() == date(2026, 8, 11)
    assert finish.astimezone(SHOP).hour == 10


def test_sunday_special_working_day():
    schedule_by_dow = _mon_sat_schedule_by_dow()
    sunday = date(2026, 8, 16)
    exceptions = {
        sunday: SimpleNamespace(
            date=sunday,
            type=CalendarExceptionType.SPECIAL_WORKING_DAY,
            start_time=time(8, 0),
            end_time=time(17, 0),
        )
    }
    anchor = shop_local_to_utc(sunday, time(8, 0))
    end = anchor + timedelta(days=1)
    windows = build_worker_working_windows(schedule_by_dow, exceptions, anchor, end)
    start, finish, _ = place_duration(windows, timedelta(hours=2), anchor, end)
    assert start is not None
    assert finish is not None
    assert start.astimezone(SHOP).date() == sunday


def test_sequential_operations_chain(schedule_patches):
    result = propose_schedule(
        [
            {
                "sequenceNo": 1,
                "operationName": "Turning",
                "assignedWorkerId": "worker-1",
                "machineTypeId": schedule_patches["lathe_id"],
                "estimatedHours": 3,
            },
            {
                "sequenceNo": 2,
                "operationName": "Heat Treatment",
                "assignedWorkerId": "worker-1",
                "machineTypeId": None,
                "estimatedHours": 1,
            },
        ],
        date(2026, 8, 20),
        anchor_utc=_anchor(hour=8),
    )
    ops = result["operations"]
    assert len(ops) == 2
    assert all(op["scheduled"] for op in ops)
    end1 = datetime.fromisoformat(ops[0]["scheduledEnd"])
    start2 = datetime.fromisoformat(ops[1]["scheduledStart"])
    assert start2 >= end1


def test_completed_predecessor_after_anchor_blocks_next(schedule_patches):
    """COMPLETED op with actual_end after the anchor — next op starts at/after that end."""
    anchor = _anchor(hour=8)  # Mon 2026-08-10 08:00 Manila
    # Finished Monday 14:00 Manila (after anchor)
    completed_start = shop_local_to_utc(date(2026, 8, 10), time(10, 0))
    completed_end = shop_local_to_utc(date(2026, 8, 10), time(14, 0))
    assert completed_end > anchor

    result = propose_schedule(
        [
            {
                "sequenceNo": 1,
                "operationName": "Blanking",
                "assignedWorkerId": "worker-1",
                "machineTypeId": schedule_patches["lathe_id"],
                "status": "COMPLETED",
                "actualStart": completed_start.isoformat(),
                "actualEnd": completed_end.isoformat(),
                "estimatedHours": 4,
            },
            {
                "sequenceNo": 2,
                "operationName": "Teeth cutting",
                "assignedWorkerId": "worker-1",
                "machineTypeId": schedule_patches["lathe_id"],
                "estimatedHours": 2,
            },
        ],
        date(2026, 8, 20),
        anchor_utc=anchor,
    )
    ops = result["operations"]
    assert ops[0]["scheduled"]
    assert ops[1]["scheduled"]
    start2 = datetime.fromisoformat(ops[1]["scheduledStart"])
    assert start2 >= completed_end
    # Must not fall back to the anchor when the frozen predecessor ends later
    assert start2 > anchor
