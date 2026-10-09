"""Moving-average forecasts (Chapter 1: moving average analysis) with back-tested
error, for monthly sales and job-order demand, and consumable run-out dates."""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, time, timedelta
from decimal import Decimal

from sqlalchemy.orm import joinedload

from app.models.job_order import JobOrder, JobOrderStatus, JobType
from app.models.operation import OperationStatus
from app.models.tool import Tool, ToolCategory
from app.services.schedule_calendar import (
    SHOP_TZ,
    default_shop_schedule_by_dow,
    effective_windows_for_date,
    load_calendar_exceptions,
    shop_local_to_utc,
    shop_now,
)

MONTHLY_WINDOW = 3
STOCKTAKE_WINDOW = 3
NOT_ENOUGH_HISTORY = "Not enough history yet"
NOT_ENOUGH_DATA = "Not enough data"


def _round(v, places=2):
    return None if v is None else round(float(v), places)


# --- Method ------------------------------------------------------------------


def moving_average(values, window=MONTHLY_WINDOW):
    """Average of the last ``window`` values, or None when there are fewer."""
    if len(values) < window:
        return None
    return sum(values[-window:]) / window


def backtest(values, window=MONTHLY_WINDOW):
    """Forecast every value that has ``window`` earlier values and compare.

    Returns (rows, mae, mape). MAPE skips periods whose actual value is 0,
    since a percentage of zero is undefined; it is None when every period is 0.
    """
    rows = []
    for i in range(window, len(values)):
        forecast = sum(values[i - window : i]) / window
        actual = values[i]
        error = abs(actual - forecast)
        rows.append(
            {
                "index": i,
                "forecast": forecast,
                "actual": actual,
                "absoluteError": error,
                "absolutePctError": (error / abs(actual) * 100.0) if actual else None,
            }
        )
    if not rows:
        return rows, None, None
    mae = sum(r["absoluteError"] for r in rows) / len(rows)
    pcts = [r["absolutePctError"] for r in rows if r["absolutePctError"] is not None]
    mape = (sum(pcts) / len(pcts)) if pcts else None
    return rows, mae, mape


# --- Monthly series ----------------------------------------------------------


def _month_start(d: date) -> date:
    return d.replace(day=1)


def _next_month(d: date) -> date:
    return (d.replace(day=28) + timedelta(days=4)).replace(day=1)


def _month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def monthly_series(dated_values, current_month: date):
    """[(month_start, total)] from the first month with data through the last
    complete month before ``current_month``; months with nothing are 0."""
    totals = defaultdict(float)
    for on, value in dated_values:
        m = _month_start(on)
        if m < current_month:
            totals[m] += float(value)
    if not totals:
        return []
    out = []
    m = min(totals)
    while m < current_month:
        out.append((m, totals.get(m, 0.0)))
        m = _next_month(m)
    return out


def monthly_forecast(dated_values, today: date | None = None, window=MONTHLY_WINDOW, places=2):
    """Moving-average forecast of the current month from complete past months."""
    today = today or shop_now().date()
    current = _month_start(today)
    series = monthly_series(dated_values, current)
    values = [v for _, v in series]
    rows, mae, mape = backtest(values, window)
    enough = len(series) >= window + 1
    by_month = {r["index"]: r for r in rows}
    return {
        "method": f"{window}-month moving average",
        "window": window,
        "monthsAvailable": len(series),
        "monthsNeeded": window + 1,
        "enoughHistory": enough,
        "notEnoughHistoryNote": None if enough else NOT_ENOUGH_HISTORY,
        "forecastMonth": _month_key(current),
        "forecast": _round(moving_average(values, window), places) if enough else None,
        "mae": _round(mae, places) if enough else None,
        "mapePct": _round(mape, 1) if enough else None,
        "backtestedMonths": len(rows),
        "months": [
            {
                "month": _month_key(m),
                "actual": _round(v, places),
                "forecast": _round(by_month[i]["forecast"], places) if i in by_month else None,
                "absoluteError": (
                    _round(by_month[i]["absoluteError"], places) if i in by_month else None
                ),
            }
            for i, (m, v) in enumerate(series)
        ],
    }


def _job_completion_date(job) -> date | None:
    ends = [
        o.actual_end
        for o in (job.operations or [])
        if o.actual_end and o.status == OperationStatus.COMPLETED
    ]
    return max(ends).astimezone(SHOP_TZ).date() if ends else None


def _job_received_date(job) -> date:
    if job.po_date:
        return job.po_date
    return job.created_at.astimezone(SHOP_TZ).date()


def sales_forecast(today: date | None = None):
    """Monthly income from completed and delivered jobs, by completion month."""
    jobs = (
        JobOrder.query.options(joinedload(JobOrder.operations))
        .filter(JobOrder.status.in_((JobOrderStatus.COMPLETED, JobOrderStatus.DELIVERED)))
        .all()
    )
    dated = []
    for job in jobs:
        done = _job_completion_date(job)
        if done is not None:
            dated.append((done, float(job.amount or 0)))
    return {
        "label": "salesForecast",
        "description": (
            "Estimate: monthly income from Completed and For Delivery jobs by completion "
            "month; next month is the average of the previous 3 complete months."
        ),
        **monthly_forecast(dated, today),
    }


def demand_forecast(today: date | None = None):
    """Monthly job orders received (PO date, else creation date), overall and by job type."""
    jobs = JobOrder.query.all()
    overall = []
    by_type = defaultdict(list)
    for job in jobs:
        on = _job_received_date(job)
        overall.append((on, 1))
        by_type[job.job_type.value if job.job_type else "UNSPECIFIED"].append((on, 1))
    result = {
        "label": "demandForecast",
        "description": (
            "Estimate: job orders received per month by PO date (creation date when "
            "there is no PO date); next month is the average of the previous 3 complete months."
        ),
        **monthly_forecast(overall, today, places=1),
    }
    result["byJobType"] = [
        {"jobType": jt.value, **monthly_forecast(by_type.get(jt.value, []), today, places=1)}
        for jt in JobType
    ]
    return result


# --- Consumable run-out --------------------------------------------------------


def shop_working_dates_after(start: date, count: int, schedule=None, exceptions=None):
    """The next ``count`` shop working days strictly after ``start``."""
    schedule = schedule or default_shop_schedule_by_dow()
    out = []
    d = start
    span = max(14, count * 2 + 14)
    while len(out) < count:
        if exceptions is None:
            chunk = load_calendar_exceptions(d + timedelta(days=1), d + timedelta(days=span))
        else:
            chunk = exceptions
        end = d + timedelta(days=span)
        while d < end and len(out) < count:
            d += timedelta(days=1)
            if effective_windows_for_date(d, schedule, chunk):
                out.append(d)
    return out


def shop_working_days_between(after: date, through: date, schedule=None, exceptions=None) -> int:
    """Shop working days in (after, through]."""
    if through <= after:
        return 0
    schedule = schedule or default_shop_schedule_by_dow()
    if exceptions is None:
        exceptions = load_calendar_exceptions(after + timedelta(days=1), through)
    n = 0
    d = after
    while d < through:
        d += timedelta(days=1)
        if effective_windows_for_date(d, schedule, exceptions):
            n += 1
    return n


def run_out_date(on_hand: float, daily_usage: float, start: date, schedule=None, exceptions=None):
    """(days_left, run_out_date) counting shop working days forward from ``start``.

    The stock lasts ``on_hand / daily_usage`` working days after ``start``;
    it runs out on the working day in which that total is reached.
    """
    if daily_usage is None or daily_usage <= 0:
        return None, None
    days_left = max(float(on_hand), 0.0) / float(daily_usage)
    if days_left == 0:
        return 0.0, start
    nth = math.ceil(days_left)
    return days_left, shop_working_dates_after(start, nth, schedule, exceptions)[-1]


def consumable_run_out(today: date | None = None):
    """Every consumable: moving-average daily usage over its last 3 stocktake
    periods, days left and the run-out date on the shop calendar."""
    from app.services import stocktake_service as st_svc

    today = today or shop_now().date()
    end_of_today_utc = shop_local_to_utc(today + timedelta(days=1), time(0, 0))
    schedule = default_shop_schedule_by_dow()
    items = []
    for tool in (
        Tool.query.filter_by(category=ToolCategory.CONSUMABLE).order_by(Tool.name).all()
    ):
        pairs = st_svc.consecutive_stocktake_pairs(tool.id)
        periods = []
        for prev_line, curr_line in pairs[-STOCKTAKE_WINDOW:]:
            prev_on = prev_line.stocktake.counted_on
            curr_on = curr_line.stocktake.counted_on
            days = shop_working_days_between(prev_on, curr_on, schedule)
            if days <= 0:
                continue
            used = float(st_svc.consumption_for_pair(prev_line, curr_line))
            periods.append(
                {
                    "from": prev_on.isoformat(),
                    "to": curr_on.isoformat(),
                    "workingDays": days,
                    "used": _round(used, 2),
                    "dailyUsage": used / days,
                }
            )
        on_hand = float(Decimal(str(tool.quantity_on_hand or 0)))
        last_line = pairs[-1][1] if pairs else None
        last_count = last_line.stocktake.counted_on if last_line else None
        row = {
            "toolId": tool.id,
            "name": tool.name,
            "code": tool.code,
            "sizeSpec": tool.size_spec,
            "unit": tool.unit,
            "quantityOnHand": _round(on_hand, 2),
            "minimumStock": _round(tool.minimum_stock, 2),
            "lowStock": tool.low_stock,
            "lastCountedOn": last_count.isoformat() if last_count else None,
            "periodsUsed": len(periods),
            "periods": [{k: v for k, v in p.items() if k != "dailyUsage"} for p in periods],
            "enoughData": bool(periods),
            "notEnoughDataNote": None if periods else NOT_ENOUGH_DATA,
            "dailyUsage": None,
            "lastCountQuantity": None,
            "deliveriesSinceCount": None,
            "shopDaysSinceCount": None,
            "estimatedOnHand": None,
            "daysLeft": None,
            "runOutDate": None,
            "likelyOut": False,
        }
        if periods:
            usage = sum(p["dailyUsage"] for p in periods) / len(periods)
            counted = float(last_line.counted_quantity or 0)
            delivered = float(
                st_svc.receive_additions_between(
                    tool.id, last_line.stocktake.created_at, end_of_today_utc
                )
            )
            days_since = shop_working_days_between(last_count, today, schedule)
            estimate = counted + delivered - usage * days_since
            row["dailyUsage"] = _round(usage, 4)
            row["lastCountQuantity"] = _round(counted, 2)
            row["deliveriesSinceCount"] = _round(delivered, 2)
            row["shopDaysSinceCount"] = days_since
            row["estimatedOnHand"] = _round(max(estimate, 0.0), 2)
            if usage > 0 and estimate <= 0:
                row["daysLeft"] = 0.0
                row["likelyOut"] = True
            else:
                days_left, out_on = run_out_date(estimate, usage, today, schedule)
                row["daysLeft"] = _round(days_left, 1)
                row["runOutDate"] = out_on.isoformat() if out_on else None
        items.append(row)

    items.sort(
        key=lambda r: (
            not r["enoughData"],
            not r["likelyOut"],
            r["runOutDate"] is None,
            r["runOutDate"] or "",
            r["name"] or "",
        )
    )
    return {
        "label": "consumableRunOut",
        "method": f"Moving average of the last {STOCKTAKE_WINDOW} stocktake periods",
        "description": (
            "Estimate: daily usage per item is the moving average of its last 3 stocktake "
            "periods (previous count + deliveries − current count, per shop working day). "
            "Today's quantity = last count + deliveries since − daily usage × shop days "
            "since the count. Days left = that estimate ÷ daily usage, counted forward on "
            "the shop calendar from today to give the run-out date."
        ),
        "today": today.isoformat(),
        "items": items,
    }
