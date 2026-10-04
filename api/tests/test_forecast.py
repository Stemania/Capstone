"""Moving-average forecasts: method, back-test error (MAE / MAPE), monthly series,
and consumable run-out dates on the shop calendar."""

from datetime import date, datetime, time, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.extensions import bcrypt, db
from app.models.stocktake import Stocktake, StocktakeLine
from app.models.tool import Tool, ToolCategory
from app.models.tool_event import ToolEvent, ToolEventType
from app.models.user import User, UserRole, UserStatus
from app.models.worker_skill import CalendarExceptionType
from app.services import forecast_service as fs
from app.services.schedule_calendar import default_shop_schedule_by_dow

# --- Moving average -----------------------------------------------------------


def test_moving_average_is_mean_of_last_three():
    assert fs.moving_average([10, 20, 30, 40]) == pytest.approx(30.0)
    assert fs.moving_average([5, 5]) is None


def test_backtest_mae_and_mape():
    # forecasts: m3 = (10+20+30)/3 = 20 vs 40; m4 = (20+30+40)/3 = 30 vs 30
    rows, mae, mape = fs.backtest([10, 20, 30, 40, 30])
    assert [r["forecast"] for r in rows] == pytest.approx([20.0, 30.0])
    assert [r["absoluteError"] for r in rows] == pytest.approx([20.0, 0.0])
    assert mae == pytest.approx(10.0)
    # |40-20|/40 = 50%, |30-30|/30 = 0% -> mean 25%
    assert mape == pytest.approx(25.0)


def test_mape_skips_months_with_zero_actual():
    # m3 forecast 2 vs 0 (skipped for MAPE), m4 forecast 1 vs 4 -> 75%
    rows, mae, mape = fs.backtest([3, 3, 0, 0, 4])
    assert len(rows) == 2
    assert rows[0]["absolutePctError"] is None
    assert mae == pytest.approx((2.0 + 3.0) / 2)
    assert mape == pytest.approx(75.0)


def test_backtest_needs_window_plus_one_values():
    rows, mae, mape = fs.backtest([1, 2, 3])
    assert rows == [] and mae is None and mape is None


# --- Monthly series -------------------------------------------------------------


def test_monthly_forecast_fills_gaps_and_excludes_current_month():
    dated = [
        (date(2031, 1, 5), 100),
        (date(2031, 1, 20), 50),
        # February has nothing -> 0
        (date(2031, 3, 2), 300),
        (date(2031, 4, 9), 60),
        (date(2031, 5, 3), 999),  # current, partial month: left out
    ]
    out = fs.monthly_forecast(dated, today=date(2031, 5, 15))
    assert [m["month"] for m in out["months"]] == ["2031-01", "2031-02", "2031-03", "2031-04"]
    assert [m["actual"] for m in out["months"]] == [150.0, 0.0, 300.0, 60.0]
    assert out["enoughHistory"] is True
    assert out["forecastMonth"] == "2031-05"
    assert out["forecast"] == pytest.approx((0 + 300 + 60) / 3, abs=0.01)
    # April back-test: (150+0+300)/3 = 150 vs 60 -> MAE 90, MAPE 150%
    assert out["mae"] == pytest.approx(90.0)
    assert out["mapePct"] == pytest.approx(150.0)
    assert out["months"][3]["forecast"] == pytest.approx(150.0)
    assert out["months"][0]["forecast"] is None
    assert "moving average" in out["method"]


def test_monthly_forecast_not_enough_history():
    dated = [(date(2031, 2, 1), 10), (date(2031, 4, 1), 20)]
    out = fs.monthly_forecast(dated, today=date(2031, 5, 2))
    assert out["monthsAvailable"] == 3
    assert out["enoughHistory"] is False
    assert out["notEnoughHistoryNote"] == "Not enough history yet"
    assert out["forecast"] is None and out["mae"] is None and out["mapePct"] is None


def test_monthly_forecast_empty():
    out = fs.monthly_forecast([], today=date(2031, 5, 2))
    assert out["monthsAvailable"] == 0
    assert out["enoughHistory"] is False


# --- Run-out date ------------------------------------------------------------------


def test_run_out_date_counts_shop_working_days_skipping_sunday_and_holidays():
    schedule = default_shop_schedule_by_dow()
    holiday = {date(2031, 3, 10): SimpleNamespace(type=CalendarExceptionType.HOLIDAY_NO_WORK)}
    # 10 on hand / 4 a day = 2.5 working days after Fri 7 Mar:
    # Sat 8, (Sun 9 off), (Mon 10 holiday), Tue 11, runs out during Wed 12
    days_left, out_on = fs.run_out_date(10, 4, date(2031, 3, 7), schedule, holiday)
    assert days_left == pytest.approx(2.5)
    assert out_on == date(2031, 3, 12)


def test_run_out_date_whole_days_and_edge_cases():
    schedule = default_shop_schedule_by_dow()
    # 6 / 2 = 3 working days after Thu 6 Mar: Fri 7, Sat 8, Mon 10
    assert fs.run_out_date(6, 2, date(2031, 3, 6), schedule, {}) == (3.0, date(2031, 3, 10))
    assert fs.run_out_date(0, 2, date(2031, 3, 6), schedule, {}) == (0.0, date(2031, 3, 6))
    assert fs.run_out_date(5, 0, date(2031, 3, 6), schedule, {}) == (None, None)


def test_working_days_between_excludes_start_and_sundays():
    schedule = default_shop_schedule_by_dow()
    # Mon 3 Mar -> Mon 10 Mar: Tue..Sat + Mon = 6
    assert fs.shop_working_days_between(date(2031, 3, 3), date(2031, 3, 10), schedule, {}) == 6


# --- Consumable run-out list (DB) ---------------------------------------------


@pytest.fixture
def counter(app):
    user = User(
        email="fc_counter@test.local",
        password_hash=bcrypt.generate_password_hash("Passw0rd!").decode("utf-8"),
        full_name="Counter",
        role=UserRole.OFFICE_STAFF,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    db.session.commit()
    return user


def _count(user, on, quantities):
    st = Stocktake(
        counted_on=on,
        counted_by_id=user.id,
        created_at=datetime.combine(on, time(4, 0), tzinfo=timezone.utc),
    )
    db.session.add(st)
    db.session.flush()
    for tool, (prev, curr) in quantities.items():
        db.session.add(
            StocktakeLine(
                stocktake_id=st.id,
                tool_id=tool.id,
                previous_quantity=Decimal(prev),
                counted_quantity=Decimal(curr),
            )
        )
        tool.quantity_on_hand = Decimal(curr)
    db.session.commit()


def test_consumable_run_out_uses_last_three_periods(counter):
    tracked = Tool(name="FC Insert", code="FC-INS", category=ToolCategory.CONSUMABLE, unit="pcs")
    single = Tool(name="FC Grease", code="FC-GRS", category=ToolCategory.CONSUMABLE, unit="kg")
    never = Tool(name="FC Rag", code="FC-RAG", category=ToolCategory.CONSUMABLE, unit="pcs")
    db.session.add_all([tracked, single, never])
    db.session.commit()

    # Monday counts, 6 shop working days apart. Used 60, 12, 18, 6 ->
    # daily 10, 2, 3, 1; last three average 2.
    counts = [100, 40, 28, 10, 4]
    mondays = [date(2031, 3, 3), date(2031, 3, 10), date(2031, 3, 17), date(2031, 3, 24), date(2031, 3, 31)]
    prev = 0
    for i, (on, qty) in enumerate(zip(mondays, counts)):
        lines = {tracked: (prev, qty)}
        if i == 0:
            lines[single] = (0, 7)
        _count(counter, on, lines)
        prev = qty

    out = fs.consumable_run_out(today=date(2031, 4, 1))
    rows = {r["code"]: r for r in out["items"]}

    ins = rows["FC-INS"]
    assert ins["enoughData"] is True
    assert ins["periodsUsed"] == 3
    assert ins["dailyUsage"] == pytest.approx(2.0)
    assert ins["quantityOnHand"] == pytest.approx(4.0)
    assert ins["lastCountedOn"] == "2031-03-31"
    # Today Tue 1 Apr: 4 counted - 2/day x 1 shop day = 2 left -> 1 day -> Wed 2 Apr
    assert ins["shopDaysSinceCount"] == 1
    assert ins["estimatedOnHand"] == pytest.approx(2.0)
    assert ins["daysLeft"] == pytest.approx(1.0)
    assert ins["runOutDate"] == "2031-04-02"
    assert ins["likelyOut"] is False

    for code in ("FC-GRS", "FC-RAG"):
        assert rows[code]["enoughData"] is False
        assert rows[code]["notEnoughDataNote"] == "Not enough data"
        assert rows[code]["runOutDate"] is None


def test_delivery_after_last_count_pushes_run_out_later(counter):
    tool = Tool(name="FC Disc", code="FC-DSC", category=ToolCategory.CONSUMABLE, unit="pcs")
    db.session.add(tool)
    db.session.commit()

    # Mondays, 6 shop days apart, 12 used each time -> 2 a day
    prev = 0
    for on, qty in zip(
        [date(2031, 5, 5), date(2031, 5, 12), date(2031, 5, 19), date(2031, 5, 26)],
        [60, 48, 36, 24],
    ):
        _count(counter, on, {tool: (prev, qty)})
        prev = qty

    def row(today):
        out = fs.consumable_run_out(today=today)
        return next(r for r in out["items"] if r["code"] == "FC-DSC")

    # Wed 28 May: 24 - 2 x 2 shop days = 20 -> 10 shop days -> Mon 9 Jun
    before = row(date(2031, 5, 28))
    assert before["estimatedOnHand"] == pytest.approx(20.0)
    assert before["runOutDate"] == "2031-06-09"

    db.session.add(
        ToolEvent(
            tool_id=tool.id,
            worker_id=counter.id,
            type=ToolEventType.RECEIVE,
            quantity=Decimal("10"),
            received_on=date(2031, 5, 27),
        )
    )
    db.session.commit()

    # +10 delivered -> 30 -> 15 shop days -> Sat 14 Jun
    after = row(date(2031, 5, 28))
    assert after["deliveriesSinceCount"] == pytest.approx(10.0)
    assert after["estimatedOnHand"] == pytest.approx(30.0)
    assert after["daysLeft"] == pytest.approx(15.0)
    assert after["runOutDate"] == "2031-06-14"
    assert after["runOutDate"] > before["runOutDate"]

    # Weeks later the estimate is below zero -> likely out, no date
    late = row(date(2031, 7, 15))
    assert late["likelyOut"] is True
    assert late["estimatedOnHand"] == 0
    assert late["runOutDate"] is None
