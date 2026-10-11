"""Analytics methods with known values (docs/analytics-methods.md): moving
average, simple exponential smoothing, Holt's trend, MAE / MAPE, method
selection, prediction interval, partial months, reorder point, Pareto
cumulative % and the supplier reliability score."""

import math
from datetime import date

import pytest

from app.services import forecast_methods as fm
from app.services import forecast_service as fs
from app.services.analytics_service import pareto_rows, vital_few_count
from app.services.supplier_reliability_service import grade_for, supplier_score

# --- Moving average ------------------------------------------------------------


def test_moving_average_is_mean_of_last_three():
    assert fm.moving_average_forecast([10, 20, 30, 40]) == pytest.approx(30.0)
    assert fm.moving_average_forecast([10, 20]) is None
    assert fm.forecast("MA3", [10, 20, 30, 40], h=3) == pytest.approx(30.0)


# --- Simple exponential smoothing -------------------------------------------------


def test_ses_level_and_error_by_hand():
    # alpha 0.5: level 10 -> 0.5*20 + 0.5*10 = 15 -> 0.5*30 + 0.5*15 = 22.5
    assert fm.ses_level([10, 20, 30], 0.5) == pytest.approx(22.5)
    # one-step errors: 20 - 10 = 10, 30 - 15 = 15 -> 100 + 225
    assert fm.ses_sse([10, 20, 30], 0.5) == pytest.approx(325.0)


def test_ses_fit_picks_lowest_error_alpha_and_ties_go_low():
    # A constant series has no error at any alpha: the smallest one is kept.
    alpha, level = fm.fit_ses([5, 5, 5, 5])
    assert alpha == 0.1 and level == pytest.approx(5.0)
    # A step up is followed fastest by the largest alpha.
    alpha, _ = fm.fit_ses([0, 0, 10, 10, 10])
    assert alpha == 0.9


# --- Holt's linear trend --------------------------------------------------------------


def test_holt_run_by_hand():
    # level 10, trend 2; y=12: level 12, trend 2; y=15: forecast 14 (error 1),
    # level 0.5*15 + 0.5*14 = 14.5, trend 0.5*(14.5-12) + 0.5*2 = 2.25
    level, trend, sse = fm.holt_run([10, 12, 15], 0.5, 0.5)
    assert level == pytest.approx(14.5)
    assert trend == pytest.approx(2.25)
    assert sse == pytest.approx(1.0)


def test_holt_follows_a_straight_line_exactly():
    assert fm.forecast("HOLT", [10, 12, 14, 16], h=1) == pytest.approx(18.0)
    assert fm.forecast("HOLT", [10, 12, 14, 16], h=3) == pytest.approx(22.0)


# --- Errors ---------------------------------------------------------------------------


def test_mae_mape_rmse_by_hand():
    actual, forecast = [100, 200], [110, 150]
    assert fm.mae(actual, forecast) == pytest.approx(30.0)
    # 10/100 = 10%, 50/200 = 25% -> 17.5%
    assert fm.mape(actual, forecast) == pytest.approx(17.5)
    assert fm.rmse(actual, forecast) == pytest.approx(math.sqrt((100 + 2500) / 2))


def test_mape_is_undefined_with_a_zero_actual():
    assert fm.mape([0, 10], [1, 10]) is None
    assert fm.mae([0, 10], [1, 10]) == pytest.approx(0.5)
    assert fm.mae([], []) is None and fm.mape([], []) is None


def test_rolling_backtest_refits_at_each_origin():
    rows = fm.rolling_backtest([10, 20, 30, 40, 30], "MA3")
    assert [r["forecast"] for r in rows] == pytest.approx([20.0, 30.0])
    assert [r["actual"] for r in rows] == [40.0, 30.0]


# --- Selection and interval ---------------------------------------------------------


def test_trend_series_selects_holt_by_mape():
    results = fm.evaluate([10, 20, 30, 40, 50, 60, 70])
    method, metric = fm.select_method(results)
    assert (method, metric) == ("HOLT", "MAPE")
    assert results["HOLT"]["mapePct"] == pytest.approx(0.0, abs=1e-9)
    # MA3 lags a rising series: 40 vs 20, 50 vs 30, 60 vs 40, 70 vs 50
    assert results["MA3"]["mae"] == pytest.approx(20.0)


def test_zero_month_falls_back_to_mae():
    results = fm.evaluate([2, 2, 2, 0, 2, 2, 2])
    method, metric = fm.select_method(results)
    assert metric == "MAE"
    assert all(results[m]["mapePct"] is None for m in fm.METHOD_ORDER)
    assert results[method]["mae"] == min(results[m]["mae"] for m in fm.METHOD_ORDER)


def test_equal_errors_pick_the_simplest_method():
    method, _ = fm.select_method(fm.evaluate([5] * 7))
    assert method == "MA3"


def test_interval_widens_with_horizon_and_stays_above_zero():
    lower, upper = fm.interval(100, 10, h=4)
    # 1.2816 x 10 x sqrt(4) = 25.632
    assert lower == pytest.approx(74.368) and upper == pytest.approx(125.632)
    lower, upper = fm.interval(5, 10, h=1)
    assert lower == 0.0 and upper == pytest.approx(17.816)


# --- Monthly series: partial months and "not enough history" ------------------------


def test_first_month_counts_only_when_records_start_on_its_first_working_day():
    # 1 Jan 2031 is a Wednesday: starting on the 5th makes January partial.
    assert fs.first_full_month(date(2031, 1, 5)) == date(2031, 2, 1)
    assert fs.first_full_month(date(2031, 1, 1)) == date(2031, 1, 1)
    # 1 Jun 2031 is a Sunday: the first working day is Monday the 2nd.
    assert fs.first_full_month(date(2031, 6, 2)) == date(2031, 6, 1)


def test_monthly_forecast_drops_partial_months_and_forecasts_three_ahead():
    # Records start mid-January (partial); Feb..Aug rise by 10 a month; the
    # September figures are the month in progress.
    dated = [(date(2031, 1, 20), 999)]
    dated += [(date(2031, m, 10), 10 * (m - 1)) for m in range(2, 9)]
    dated += [(date(2031, 9, 3), 5)]
    out = fs.monthly_forecast(dated, today=date(2031, 9, 15))
    assert [m["month"] for m in out["months"]][0] == "2031-02"
    assert [m["actual"] for m in out["months"]] == [10, 20, 30, 40, 50, 60, 70]
    assert {e["reason"] for e in out["excludedMonths"]} == {"PARTIAL_FIRST_MONTH", "IN_PROGRESS"}
    assert out["methodKey"] == "HOLT" and out["errorMetric"] == "MAPE"
    assert [h["month"] for h in out["horizon"]] == ["2031-09", "2031-10", "2031-11"]
    assert [h["forecast"] for h in out["horizon"]] == pytest.approx([80.0, 90.0, 100.0])
    assert out["forecast"] == pytest.approx(80.0)
    assert out["currentMonthSoFar"] == pytest.approx(5.0)
    assert [m["selected"] for m in out["methods"]] == [False, False, True]


def test_monthly_forecast_needs_six_full_months():
    dated = [(date(2031, m, 1), 10) for m in range(1, 6)]
    out = fs.monthly_forecast(dated, today=date(2031, 6, 10))
    assert out["monthsAvailable"] == 5 and out["monthsNeeded"] == 6
    assert out["enoughHistory"] is False
    assert out["notEnoughHistoryNote"] == "Not enough history yet"
    assert out["forecast"] is None and out["horizon"] == [] and out["methods"] == []


# --- Reorder point ----------------------------------------------------------------------


def test_safety_stock_and_reorder_point_by_hand():
    # usages 1 and 3: mean 2, sample sd sqrt(2); 1.65 x sqrt(2) x sqrt(4)
    ss = fs.safety_stock([1, 3], 4)
    assert ss == pytest.approx(1.65 * math.sqrt(2) * 2)
    assert fs.reorder_point(2, 4, ss) == pytest.approx(8 + ss)
    assert fs.safety_stock([2], 4) == 0.0
    assert fs.reorder_point(None, 4) is None


def test_stock_status_bands():
    assert fs.stock_status(0, 2, 10) == "LIKELY_OUT"
    assert fs.stock_status(8, 2, 10) == "REORDER_NOW"
    assert fs.stock_status(10, 2, 10) == "REORDER_NOW"
    assert fs.stock_status(11, 2, 10) == "OK"
    assert fs.stock_status(None, None, None) == "NO_DATA"


def test_lead_time_prefers_measured_then_supplier_then_default():
    assert fs.lead_time_for({"measured": [4, 6], "stated": 9}) == (5.0, "MEASURED")
    assert fs.lead_time_for({"measured": [], "stated": 9}) == (9.0, "SUPPLIER")
    assert fs.lead_time_for(None) == (float(fs.DEFAULT_LEAD_TIME_DAYS), "DEFAULT")


# --- Pareto -----------------------------------------------------------------------------


def test_pareto_sorts_and_accumulates():
    rows = pareto_rows([{"label": "a", "hours": 2}, {"label": "b", "hours": 5}, {"label": "c", "hours": 3}])
    assert [r["label"] for r in rows] == ["b", "c", "a"]
    assert [r["shareOfTotalPct"] for r in rows] == pytest.approx([50.0, 30.0, 20.0])
    assert [r["cumulativePct"] for r in rows] == pytest.approx([50.0, 80.0, 100.0])
    assert vital_few_count(rows) == 2


def test_pareto_with_no_hours():
    rows = pareto_rows([{"label": "a", "hours": 0}])
    assert rows[0]["cumulativePct"] == 0.0
    assert pareto_rows([]) == []


# --- Supplier reliability score -------------------------------------------------------


def test_supplier_score_by_hand():
    # 9/10 on time (0.9), 3.5 days late on average (1 - 3.5/7 = 0.5),
    # 8 days stated vs 10 actual (0.8): 0.5*0.9 + 0.3*0.5 + 0.2*0.8 = 0.76
    score, parts = supplier_score(9, 10, 3.5, avg_actual_lead=10, stated_lead=8)
    assert score == pytest.approx(76.0)
    assert parts == pytest.approx({"onTime": 0.9, "daysLate": 0.5, "leadTime": 0.8})
    assert grade_for(score) == "C"


def test_supplier_score_reweights_a_missing_part():
    # No stated lead time: on time and days late share the weight (0.5 + 0.3).
    score, parts = supplier_score(10, 10, 0, avg_actual_lead=4, stated_lead=None)
    assert parts["leadTime"] is None
    assert score == pytest.approx(100.0)
    # Two parts: 0.5*0.8 + 0.3*0.0 = 0.4 of 0.8 -> 50
    score, _ = supplier_score(4, 5, 10, avg_actual_lead=None, stated_lead=5)
    assert score == pytest.approx(50.0)


def test_supplier_score_caps_days_late_and_lead_time():
    # 7+ days late scores 0; delivering faster than stated scores no more than 1.
    score, parts = supplier_score(4, 5, 10, avg_actual_lead=3, stated_lead=5)
    assert parts["daysLate"] == 0.0 and parts["leadTime"] == 1.0
    assert score == pytest.approx(60.0)
    assert supplier_score(0, 0, 0) == (None, {"onTime": None, "daysLate": None, "leadTime": None})


def test_grade_bands():
    assert [grade_for(s) for s in (95, 90, 89.9, 80, 79.9, 70, 69.9)] == ["A", "A", "B", "B", "C", "C", "D"]
    assert grade_for(None) is None
