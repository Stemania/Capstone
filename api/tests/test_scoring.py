"""Unit tests for weighted worker scoring components."""

from datetime import date, time
from types import SimpleNamespace

from app.models.scoring_weight import DEFAULT_SCORING_WEIGHTS
from app.services.schedule_calendar import shop_local_to_utc
from app.services.scoring_service import (
    score_availability,
    score_efficiency,
    score_skill,
    score_workload,
    validate_weights_sum,
)


def _mon_sat_schedules():
    rows = []
    for dow in range(7):
        working = dow < 6
        rows.append(
            SimpleNamespace(
                day_of_week=dow,
                is_working=working,
                start_time=time(8, 0) if working else None,
                end_time=time(17, 0) if working else None,
            )
        )
    return rows


def test_default_weights_sum_to_one():
    weights = {k: float(v) for k, v in DEFAULT_SCORING_WEIGHTS.items()}
    ok, total = validate_weights_sum(weights)
    assert ok
    assert abs(total - 1.0) < 1e-9


def test_score_skill_proficiency_and_primary():
    score, reason, used_default = score_skill(4, is_primary=False)
    assert abs(score - 0.8) < 1e-9
    assert "proficiency 4" in reason
    assert used_default is False

    score_p, _, _ = score_skill(4, is_primary=True)
    assert abs(score_p - 0.9) < 1e-9

    score_cap, _, _ = score_skill(5, is_primary=True)
    assert score_cap == 1.0


def test_score_skill_missing_is_zero():
    score, reason, used_default = score_skill(None)
    assert score == 0.0
    assert "no skill" in reason
    assert used_default is False


def test_availability_no_window_is_neutral_default():
    score, reason, used_default = score_availability("w1")
    assert score == 0.5
    assert used_default is True
    assert "no proposed window" in reason


def test_availability_conflict_is_zero():
    start = shop_local_to_utc(date(2026, 8, 10), time(9, 0))
    end = shop_local_to_utc(date(2026, 8, 10), time(12, 0))
    op = SimpleNamespace(
        scheduled_start=start,
        scheduled_end=end,
        operation_name="Turning",
    )
    score, reason, used_default = score_availability(
        "w1",
        scheduled_start=start,
        scheduled_end=end,
        schedules=_mon_sat_schedules(),
        exceptions=[],
        operations=[op],
    )
    assert score == 0.0
    assert "conflicts" in reason
    assert used_default is False


def test_availability_inside_hours():
    start = shop_local_to_utc(date(2026, 8, 10), time(9, 0))
    end = shop_local_to_utc(date(2026, 8, 10), time(11, 0))
    score, reason, used_default = score_availability(
        "w1",
        scheduled_start=start,
        scheduled_end=end,
        schedules=_mon_sat_schedules(),
        exceptions=[],
        operations=[],
    )
    assert score == 1.0
    assert "free" in reason
    assert used_default is False


def test_availability_multi_day_placement_not_penalized():
    """Envelope spans overnight; derived segments are all inside → score 1.0."""
    start = shop_local_to_utc(date(2026, 8, 10), time(14, 0))
    end = shop_local_to_utc(date(2026, 8, 11), time(11, 0))
    score, reason, used_default = score_availability(
        "w1",
        scheduled_start=start,
        scheduled_end=end,
        schedules=_mon_sat_schedules(),
        exceptions=[],
        operations=[],
    )
    assert score == 1.0
    assert "free" in reason
    assert used_default is False


def test_workload_equal_peers_get_one():
    score, reason, used_default = score_workload(8.0, [8.0, 8.0, 8.0])
    assert score == 1.0
    assert "equal" in reason
    assert used_default is False


def test_workload_minmax_linear():
    light, _, _ = score_workload(2.0, [2.0, 5.0, 8.0])
    mid, _, _ = score_workload(5.0, [2.0, 5.0, 8.0])
    heavy, _, _ = score_workload(8.0, [2.0, 5.0, 8.0])
    assert light == 1.0
    assert heavy == 0.0
    assert abs(mid - 0.5) < 1e-9


def test_efficiency_cold_start_neutral():
    score, reason, used_default = score_efficiency([(4.0, 4.0), (3.0, 3.0)])
    assert score == 0.5
    assert used_default is True
    assert "no completion history" in reason


def test_efficiency_from_history():
    # estimated/actual = 1.5 → normalized 1.0; = 0.75 → 0.5
    pairs = [(3.0, 2.0), (3.0, 2.0), (3.0, 4.0)]
    score, reason, used_default = score_efficiency(pairs)
    assert used_default is False
    assert "completed ops" in reason
    expected = (1.0 + 1.0 + (0.75 / 1.5)) / 3
    assert abs(score - expected) < 1e-9
