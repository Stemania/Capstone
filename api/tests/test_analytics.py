"""Unit tests for analytics aggregations."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.services.analytics_service import (
    average_variance_pct,
    filter_by_min_ops,
    split_worked_hours,
    type_utilization_pct,
    utilization_from_segments,
)
from app.services.schedule_calendar import derive_working_segments


def test_null_estimated_hours_excluded_from_variance_average():
    ops = [
        SimpleNamespace(estimated_hours=4, variance_pct=10),
        SimpleNamespace(estimated_hours=None, variance_pct=0),  # must not pull avg to 5
        SimpleNamespace(estimated_hours=2, variance_pct=20),
    ]
    assert average_variance_pct(ops) == pytest.approx(15.0)


def test_rework_hours_reported_separately():
    ops = [
        SimpleNamespace(rework_of_operation_id=None, actual_worked_hours=10),
        SimpleNamespace(rework_of_operation_id=None, actual_worked_hours=5),
        SimpleNamespace(rework_of_operation_id="orig-1", actual_worked_hours=2.5),
        SimpleNamespace(rework_of_operation_id="orig-2", actual_worked_hours=1.5),
    ]
    original, rework = split_worked_hours(ops)
    assert original == pytest.approx(15.0)
    assert rework == pytest.approx(4.0)
    assert original + rework == pytest.approx(19.0)


def test_utilization_uses_working_segments_not_wall_clock():
    """Overnight envelope is large; segments exclude the gap."""
    start = datetime(2026, 8, 10, 6, 0, tzinfo=timezone.utc)  # 14:00 Manila
    end = datetime(2026, 8, 11, 3, 0, tzinfo=timezone.utc)  # 11:00 next day Manila
    wall_hours = (end - start).total_seconds() / 3600.0
    assert wall_hours == pytest.approx(21.0)

    # Mon schedule 08-17 Manila
    sched = {
        0: SimpleNamespace(is_working=True, start_time=__import__("datetime").time(8, 0), end_time=__import__("datetime").time(17, 0)),
        1: SimpleNamespace(is_working=True, start_time=__import__("datetime").time(8, 0), end_time=__import__("datetime").time(17, 0)),
    }
    for dow in range(2, 7):
        sched[dow] = SimpleNamespace(
            is_working=dow < 6,
            start_time=__import__("datetime").time(8, 0) if dow < 6 else None,
            end_time=__import__("datetime").time(17, 0) if dow < 6 else None,
        )

    segments = derive_working_segments(start, end, sched, {})
    segment_hours = sum((e - s).total_seconds() for s, e in segments) / 3600.0
    assert segment_hours < wall_hours
    # 14:00-17:00 + 08:00-11:00 = 6h
    assert segment_hours == pytest.approx(6.0)

    available = 9.0  # one shop day
    util = utilization_from_segments(segment_hours, available)
    assert util == pytest.approx(66.6667, rel=1e-3)
    # Wall-clock utilization would be wrong (>100% or inflated)
    wall_util = utilization_from_segments(wall_hours, available)
    assert wall_util > util


def test_minimum_operation_count_threshold_filters():
    groups = [
        {"workerName": "A", "operationCount": 10},
        {"workerName": "B", "operationCount": 5},
        {"workerName": "C", "operationCount": 4},
        {"workerName": "D", "operationCount": 1},
    ]
    assert [g["workerName"] for g in filter_by_min_ops(groups, 5)] == ["A", "B"]
    assert [g["workerName"] for g in filter_by_min_ops(groups, 1)] == ["A", "B", "C", "D"]
    assert filter_by_min_ops(groups, 11) == []


def test_type_level_utilization_is_mean_of_units_and_never_over_100():
    """Denominator is availableHours * unit_count, i.e. mean of unit utils."""
    available = 441.0
    # Seven lathe units with uneven busy hours (from seeded-style spread)
    busy = [48.6, 61.6, 34.3, 59.1, 38.8, 40.5, 50.7]
    unit_utils = [b / available * 100 for b in busy]
    type_util = type_utilization_pct(busy, available)

    assert type_util == pytest.approx(sum(unit_utils) / len(unit_utils))
    assert type_util < 100.0
    # Old bug: divide by single-unit available would inflate past mean * n
    inflated = sum(busy) / available * 100
    assert inflated > type_util
    assert inflated == pytest.approx(type_util * len(busy))
