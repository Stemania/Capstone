"""Unit tests for analytics aggregations."""

from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.services.analytics_service import (
    CAPACITY_LOAD_FLAG_PCT,
    average_variance_pct,
    filter_by_min_ops,
    month_partial_flags,
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


def test_partial_months_flagged_for_seeded_range():
    """Seeded analytics window 2026-06-16..2026-08-11: Jun/Aug partial, Jul full."""
    period_from = date(2026, 6, 16)
    period_to = date(2026, 8, 11)
    jun_partial, jun_wd = month_partial_flags(period_from, period_to, 2026, 6)
    jul_partial, jul_wd = month_partial_flags(period_from, period_to, 2026, 7)
    aug_partial, aug_wd = month_partial_flags(period_from, period_to, 2026, 8)
    assert jun_partial is True
    assert aug_partial is True
    assert jul_partial is False
    assert jun_wd > 0 and aug_wd > 0
    assert jul_wd > jun_wd and jul_wd > aug_wd


def test_committed_pipeline_excludes_completed_jobs():
    from app.models.job_order import JobOrderStatus
    from app.services import analytics_service as svc

    completed = SimpleNamespace(
        id="c1",
        status=JobOrderStatus.COMPLETED,
        amount=999,
        due_date=date(2026, 8, 1),
        operations=[],
    )
    open_job = SimpleNamespace(
        id="o1",
        status=JobOrderStatus.IN_PROGRESS,
        amount=1000,
        due_date=date(2026, 8, 20),
        operations=[
            SimpleNamespace(
                scheduled_end=datetime(2026, 8, 25, 9, 0, tzinfo=timezone.utc)
            )
        ],
        client=None,
    )

    mock_job = MagicMock()
    mock_job.query.filter.return_value.all.return_value = [open_job]

    with (
        patch.object(svc, "JobOrder", mock_job),
        patch.object(
            svc,
            "_completed_jobs_in_period",
            return_value=[(completed, date(2026, 7, 1))],
        ),
        patch.object(
            svc,
            "_parse_period",
            return_value=(date(2026, 6, 16), date(2026, 8, 11), None, None),
        ),
        patch.object(
            svc, "shop_now", return_value=SimpleNamespace(date=lambda: date(2026, 8, 11))
        ),
    ):
        result = svc.sales_forecast()

    assert result["committedPipeline"]["jobCount"] == 1
    assert result["committedPipeline"]["totalAmount"] == 1000.0
    assert result["committedPipeline"]["label"] == "committedPipeline"
    assert "fact" in result["committedPipeline"]["description"].lower()
    # Projection states sample size separately from pipeline
    assert result["projectedRevenue"]["sampleCompletedJobs"] == 1
    assert result["projectedRevenue"]["sampleWorkingDays"] == result["workingDaysInSample"]
    assert result["projectedRevenue"]["label"] == "projectedRevenue"
    assert "estimate" in result["projectedRevenue"]["description"].lower()


def test_projection_states_sample_size_and_thin_flag():
    from app.services import analytics_service as svc

    mock_job = MagicMock()
    mock_job.query.filter.return_value.all.return_value = []

    with (
        patch.object(svc, "JobOrder", mock_job),
        patch.object(svc, "_completed_jobs_in_period", return_value=[]),
        patch.object(
            svc,
            "_parse_period",
            return_value=(date(2026, 8, 1), date(2026, 8, 7), None, None),
        ),
        patch.object(
            svc, "shop_now", return_value=SimpleNamespace(date=lambda: date(2026, 8, 11))
        ),
    ):
        result = svc.sales_forecast()

    assert result["thinSample"] is True
    assert result["sampleWeeks"] < 8
    assert "thinSampleNote" in result["projectedRevenue"]
    assert result["projectedRevenue"]["sampleWorkingDays"] == result["workingDaysInSample"]


def test_capacity_load_uses_unit_count_adjusted_available_hours():
    from app.services.analytics_service import capacity_type_rows

    mt_shaper = SimpleNamespace(id="t1", code="SHAPER", name="Shaper")
    mt_lathe = SimpleNamespace(id="t2", code="LATHE", name="Lathe")
    units_by_type = {
        "t1": [SimpleNamespace(id="u1")],
        "t2": [SimpleNamespace(id="u2"), SimpleNamespace(id="u3")],
    }
    # 180h on SHAPER (1 unit) → ~83% of 216; 200h on LATHE (2 units) → ~46% of 432
    load_by_type = {"t1": 180.0, "t2": 200.0}
    available_per_unit = 216.0

    rows = capacity_type_rows(
        [mt_shaper, mt_lathe], units_by_type, load_by_type, available_per_unit
    )
    by_code = {r["machineTypeCode"]: r for r in rows}

    assert by_code["SHAPER"]["activeUnitCount"] == 1
    assert by_code["SHAPER"]["availableHours"] == 216.0
    assert by_code["SHAPER"]["projectedLoadPct"] == pytest.approx(180 / 216 * 100, rel=1e-3)
    assert by_code["SHAPER"]["above80Pct"] is True
    assert by_code["SHAPER"]["projectedLoadPct"] >= CAPACITY_LOAD_FLAG_PCT

    assert by_code["LATHE"]["activeUnitCount"] == 2
    assert by_code["LATHE"]["availableHours"] == 432.0  # 216 * 2, not 216
    assert by_code["LATHE"]["projectedLoadPct"] == pytest.approx(200 / 432 * 100, rel=1e-3)
    assert by_code["LATHE"]["above80Pct"] is False
    # Wrong denominator (ignore unit count) would falsely flag LATHE
    wrong = 200 / 216 * 100
    assert wrong > CAPACITY_LOAD_FLAG_PCT
    assert by_code["LATHE"]["projectedLoadPct"] < CAPACITY_LOAD_FLAG_PCT
