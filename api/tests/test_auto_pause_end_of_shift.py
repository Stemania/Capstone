"""Work left running when the worker's shift ends is paused at the end of the
shift (or at the recorded clock-out), so the night is not counted as work."""

from datetime import date, time, timedelta

from app.extensions import db
from app.models.attendance import AttendanceRecord
from app.models.operation_time import OperationPauseReason, OperationTimeEvent
from app.models.worker_skill import CalendarExceptionType, WorkCalendarException
from app.services import shop_floor_check_service as checks
from app.services.operation_service import compute_worked_hours
from app.services.schedule_calendar import ensure_utc, shop_local_to_utc

from tests.test_shop_floor_checks import _running, shop  # noqa: F401  (fixture)

MONDAY = date(2026, 10, 19)


def _at(hh, mm=0, day=MONDAY):
    return shop_local_to_utc(day, time(hh, mm))


def _run(shop, started):
    return _running(shop, shop["juan"], shop["la"], started=started, hours=20,
                    planned_end=started + timedelta(days=3))


def _last(op):
    db.session.refresh(op)
    return max(op.time_logs, key=lambda L: ensure_utc(L.event_at))


def test_paused_at_shift_end_after_grace(shop):
    op = _run(shop, _at(10))
    assert checks.auto_pause_after_shift(_at(17, 20)) == 0  # still within the grace period
    assert checks.auto_pause_after_shift(_at(17, 45)) == 1
    db.session.commit()
    last = _last(op)
    assert last.event == OperationTimeEvent.PAUSE
    assert last.reason == OperationPauseReason.END_OF_SHIFT
    assert ensure_utc(last.event_at) == _at(17)
    assert last.note == checks.AUTO_PAUSE_NOTE
    assert float(compute_worked_hours(op)) == 6.0  # 10:00–17:00 less the 1-hour break
    assert checks.auto_pause_after_shift(_at(23)) == 0  # already paused


def test_recorded_clock_out_is_used(shop):
    op = _run(shop, _at(10))
    db.session.add(AttendanceRecord(worker_id=shop["juan"].id, work_date=MONDAY,
                                    clock_in=_at(8), clock_out=_at(18, 30),
                                    recorded_by_id=shop["admin"].id))
    db.session.commit()
    assert checks.auto_pause_after_shift(_at(18, 45)) == 0
    assert checks.auto_pause_after_shift(_at(19, 5)) == 1
    assert ensure_utc(_last(op).event_at) == _at(18, 30)


def test_clocked_in_without_clock_out_waits_for_end_of_day(shop):
    op = _run(shop, _at(10))
    db.session.add(AttendanceRecord(worker_id=shop["juan"].id, work_date=MONDAY,
                                    clock_in=_at(8), recorded_by_id=shop["admin"].id))
    db.session.commit()
    assert checks.auto_pause_after_shift(_at(20)) == 0
    assert checks.auto_pause_after_shift(_at(0, 10, MONDAY + timedelta(days=1))) == 1
    assert ensure_utc(_last(op).event_at) == _at(17)


def test_overtime_extends_the_shift(shop):
    db.session.add(WorkCalendarException(date=MONDAY, type=CalendarExceptionType.OVERTIME,
                                         start_time=time(17), end_time=time(20)))
    db.session.commit()
    op = _run(shop, _at(10))
    assert checks.auto_pause_after_shift(_at(18)) == 0
    assert checks.auto_pause_after_shift(_at(20, 31)) == 1
    assert ensure_utc(_last(op).event_at) == _at(20)


def test_started_after_hours_pauses_at_end_of_day(shop):
    op = _run(shop, _at(19))
    assert checks.auto_pause_after_shift(_at(23)) == 0
    assert checks.auto_pause_after_shift(_at(0, 5, MONDAY + timedelta(days=1))) == 1
    assert ensure_utc(_last(op).event_at) == shop_local_to_utc(MONDAY + timedelta(days=1), time(0))


def test_paused_work_is_left_alone(shop):
    op = _running(shop, shop["juan"], shop["la"], started=_at(10), hours=20,
                  planned_end=_at(10) + timedelta(days=3), paused=_at(15))
    assert checks.auto_pause_after_shift(_at(23)) == 0
    assert len(op.time_logs) == 2


def test_run_checks_reports_auto_paused(shop):
    _run(shop, _at(10))
    assert checks.run_checks(_at(18))["autoPaused"] == 1
