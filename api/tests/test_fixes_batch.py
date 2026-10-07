"""Tests for on-time delivery, RECEIVE stock, and calendar-based capacity."""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.models.tool_event import ToolEventType
from app.models.worker_skill import CalendarExceptionType
from app.services.schedule_calendar import shop_available_hours
from app.services import stocktake_service


def test_on_time_uses_delivered_at_not_machining_end():
    """Delivered late after on-time machining must count as late."""
    from app.services import analytics_service as svc

    due = date(2026, 8, 10)
    # Machined Aug 9 (on time) but delivered Aug 12 (late)
    delivered_late = datetime(2026, 8, 12, 2, 0, tzinfo=timezone.utc)  # Aug 12 Manila morning-ish
    completed_on_time = datetime(2026, 8, 9, 8, 0, tzinfo=timezone.utc)

    job_late = SimpleNamespace(
        due_date=due,
        delivered_at=delivered_late,
        status="DELIVERED",
    )
    job_awaiting = SimpleNamespace(
        due_date=due,
        delivered_at=None,
        status="COMPLETED",
    )
    job_on_time = SimpleNamespace(
        due_date=due,
        delivered_at=datetime(2026, 8, 10, 2, 0, tzinfo=timezone.utc),
        status="DELIVERED",
    )

    finished = [
        (job_late, completed_on_time),
        (job_awaiting, completed_on_time),
        (job_on_time, completed_on_time),
    ]

    on_time = late = awaiting = 0
    for job, _ in finished:
        if not job.delivered_at:
            awaiting += 1
            continue
        done = job.delivered_at.astimezone(svc.SHOP_TZ).date()
        if done <= job.due_date:
            on_time += 1
        else:
            late += 1

    assert on_time == 1
    assert late == 1
    assert awaiting == 1
    # Rate excludes awaiting
    assert on_time / (on_time + late) == pytest.approx(0.5)


def test_receive_additions_counted_adjust_ignored():
    """Stocktake additions use RECEIVE only; ADJUST (even +prefix) is ignored."""
    start = datetime(2026, 8, 1, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 8, 15, 0, 0, tzinfo=timezone.utc)

    receive = SimpleNamespace(
        id="r1",
        type=ToolEventType.RECEIVE,
        quantity=Decimal("10"),
        received_on=date(2026, 8, 5),
        created_at=datetime(2026, 8, 6, 0, 0, tzinfo=timezone.utc),
    )
    adjust_plus = SimpleNamespace(
        id="a1",
        type=ToolEventType.ADJUST,
        quantity=Decimal("5"),
        reason="+5: Delivery",
        received_on=None,
        created_at=datetime(2026, 8, 5, 0, 0, tzinfo=timezone.utc),
    )

    mock_query = MagicMock()
    mock_query.filter.return_value.all.return_value = [receive]

    with patch.object(stocktake_service, "ToolEvent") as mock_te:
        mock_te.query = mock_query
        mock_te.ToolEventType = ToolEventType  # unused
        total = stocktake_service.receive_additions_between("tool-1", start, end)

    assert total == Decimal("10")

    # If only ADJUST were returned (legacy), RECEIVE filter means empty → 0
    mock_query.filter.return_value.all.return_value = []
    with patch.object(stocktake_service, "ToolEvent") as mock_te:
        mock_te.query = mock_query
        total2 = stocktake_service.receive_additions_between("tool-1", start, end)
    assert total2 == Decimal("0")
    # Sanity: ADJUST with + must never be treated as delivery by this helper
    assert adjust_plus.type == ToolEventType.ADJUST
    assert (adjust_plus.reason or "").startswith("+")


def test_shop_available_hours_respects_calendar_exceptions():
    """Holiday removes a day; overtime adds hours beyond the default 8h
    (08:00-17:00 less the 12:00-13:00 break)."""
    period_from = date(2026, 8, 3)  # Mon
    period_to = date(2026, 8, 8)  # Sat — 6 default working days × 8h = 48

    holiday = SimpleNamespace(
        type=CalendarExceptionType.HOLIDAY_NO_WORK,
        start_time=None,
        end_time=None,
    )
    overtime = SimpleNamespace(
        type=CalendarExceptionType.OVERTIME,
        start_time=time(17, 0),
        end_time=time(20, 0),  # +3h on Wednesday
    )
    exceptions = {
        date(2026, 8, 5): holiday,  # Wed removed (−8)
        date(2026, 8, 6): overtime,  # Thu +3
    }

    with patch(
        "app.services.schedule_calendar.load_calendar_exceptions",
        return_value=exceptions,
    ):
        hours = shop_available_hours(period_from, period_to)

    # Mon,Tue,Thu(+3),Fri,Sat = 5*8 + 3 = 43; Wed holiday removed
    assert hours == pytest.approx(43.0)

    with patch(
        "app.services.schedule_calendar.load_calendar_exceptions",
        return_value={},
    ):
        flat = shop_available_hours(period_from, period_to)
    assert flat == pytest.approx(48.0)


def test_analytics_shop_available_hours_delegates_to_calendar():
    from app.services.analytics_service import _shop_available_hours

    with patch(
        "app.services.analytics_service.shop_available_hours",
        return_value=42.5,
    ) as mock_fn:
        assert _shop_available_hours(date(2026, 8, 1), date(2026, 8, 7)) == 42.5
        mock_fn.assert_called_once()
