"""Monthly sales and job-order demand forecasts (3-month moving average, simple
exponential smoothing and Holt's trend, picked by back-test error; see
``forecast_methods``), and consumable run-out dates with reorder points."""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, time, timedelta
from decimal import Decimal

from sqlalchemy.orm import joinedload

from app.models.job_order import JobOrder, JobOrderStatus, JobType
from app.models.operation import OperationStatus
from app.models.tool import Tool, ToolCategory
from app.services import forecast_methods as fm
from app.services.schedule_calendar import (
    SHOP_TZ,
    default_shop_schedule_by_dow,
    effective_windows_for_date,
    load_calendar_exceptions,
    shop_local_to_utc,
    shop_now,
)

MONTHLY_WINDOW = 3
# 3 months to fit the first forecast plus 3 back-tested months to compare methods.
MIN_FORECAST_MONTHS = fm.MIN_TRAIN + 3
FORECAST_HORIZON_MONTHS = 3
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


def first_full_month(history_start: date) -> date:
    """The first calendar month fully inside the history.

    The month the records begin in counts only when they begin on its first
    working day (Monday to Saturday); otherwise it is partial and left out.
    """
    first = _month_start(history_start)
    first_working = first
    while first_working.weekday() == 6:
        first_working += timedelta(days=1)
    return first if history_start <= first_working else _next_month(first)


def full_month_series(dated_values, current_month: date, start_month: date):
    """[(month_start, total)] for every complete month from ``start_month`` up to
    the month before ``current_month``; months with nothing are 0."""
    totals = defaultdict(float)
    for on, value in dated_values:
        m = _month_start(on)
        if start_month <= m < current_month:
            totals[m] += float(value)
    out = []
    m = start_month
    while m < current_month:
        out.append((m, totals.get(m, 0.0)))
        m = _next_month(m)
    return out


def monthly_forecast(
    dated_values,
    today: date | None = None,
    window=MONTHLY_WINDOW,
    places=2,
    history_start: date | None = None,
    horizon=FORECAST_HORIZON_MONTHS,
):
    """Forecast of the current month and the next ones from complete past months.

    The three methods in ``forecast_methods`` are back-tested on the same
    months and the one with the lowest MAPE (MAE when MAPE is undefined) is
    used. The current month is in progress and the first month of the history
    is usually partial; neither is used as history.
    """
    today = today or shop_now().date()
    current = _month_start(today)
    dated_values = list(dated_values)
    start = history_start or (min(on for on, _ in dated_values) if dated_values else None)
    start_month = first_full_month(start) if start else current
    series = full_month_series(dated_values, current, start_month) if start else []
    values = [v for _, v in series]
    so_far = sum(float(v) for on, v in dated_values if _month_start(on) == current and on <= today)

    excluded = []
    if start and _month_start(start) < start_month:
        excluded.append({"month": _month_key(_month_start(start)), "reason": "PARTIAL_FIRST_MONTH"})
    excluded.append({"month": _month_key(current), "reason": "IN_PROGRESS"})

    enough = len(series) >= MIN_FORECAST_MONTHS
    results = fm.evaluate(values) if enough else {}
    chosen, metric = fm.select_method(results) if enough else (None, None)
    best = results.get(chosen) if chosen else None
    enough = enough and best is not None

    horizon_rows = []
    if enough:
        for h in range(1, horizon + 1):
            point = max(fm.forecast(chosen, values, h), 0.0)
            lower, upper = fm.interval(point, best["rmse"], h)
            m = current
            for _ in range(h - 1):
                m = _next_month(m)
            horizon_rows.append(
                {
                    "month": _month_key(m),
                    "forecast": _round(point, places),
                    "lower": _round(lower, places),
                    "upper": _round(upper, places),
                }
            )
    by_index = {r["index"]: r for r in best["rows"]} if best else {}

    return {
        "method": fm.METHOD_NAMES[chosen] if enough else None,
        "methodKey": chosen if enough else None,
        "errorMetric": metric if enough else None,
        "parameters": fm.parameters(chosen, values) if enough else {},
        "window": window,
        "monthsAvailable": len(series),
        "monthsNeeded": MIN_FORECAST_MONTHS,
        "enoughHistory": enough,
        "notEnoughHistoryNote": None if enough else NOT_ENOUGH_HISTORY,
        "forecastMonth": _month_key(current),
        "forecast": horizon_rows[0]["forecast"] if enough else None,
        "mae": _round(best["mae"], places) if enough else None,
        "mapePct": _round(best["mapePct"], 1) if enough else None,
        "backtestedMonths": best["backtestedMonths"] if enough else 0,
        "intervalLevelPct": fm.INTERVAL_LEVEL,
        "horizon": horizon_rows,
        "currentMonthSoFar": _round(so_far, places),
        "excludedMonths": excluded,
        "methods": [
            {
                "key": m,
                "name": fm.METHOD_NAMES[m],
                "mae": _round(results[m]["mae"], places),
                "mapePct": _round(results[m]["mapePct"], 1),
                "backtestedMonths": results[m]["backtestedMonths"],
                "selected": m == chosen,
            }
            for m in fm.METHOD_ORDER
        ]
        if enough
        else [],
        "months": [
            {
                "month": _month_key(m),
                "actual": _round(v, places),
                "forecast": _round(by_index[i]["forecast"], places) if i in by_index else None,
                "absoluteError": (
                    _round(abs(by_index[i]["actual"] - by_index[i]["forecast"]), places)
                    if i in by_index
                    else None
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
        "description": "Monthly income from Completed and For Delivery jobs, by completion month.",
        **monthly_forecast(dated, today),
    }


def demand_forecast(today: date | None = None):
    """Monthly job orders received (PO date, else creation date), overall and by job type.

    Every job type uses the overall start of the history, so a type with no
    orders in the early months counts them as 0 instead of starting later.
    """
    jobs = JobOrder.query.filter(JobOrder.status != JobOrderStatus.CANCELLED).all()
    overall = []
    by_type = defaultdict(list)
    for job in jobs:
        on = _job_received_date(job)
        overall.append((on, 1))
        by_type[job.job_type.value if job.job_type else "UNSPECIFIED"].append((on, 1))
    start = min((on for on, _ in overall), default=None)
    result = {
        "label": "demandForecast",
        "description": "Job orders received per month, by PO date (creation date when there is none).",
        **monthly_forecast(overall, today, places=1, history_start=start),
    }
    result["byJobType"] = [
        {
            "jobType": jt.value,
            **monthly_forecast(by_type.get(jt.value, []), today, places=1, history_start=start),
        }
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


# --- Reorder point -------------------------------------------------------------

# z for a 95% chance of not running out during the lead time (cycle service level).
SERVICE_LEVEL_Z = 1.65
SERVICE_LEVEL_PCT = 95
DEFAULT_LEAD_TIME_DAYS = 7
STOCK_OK = "OK"
STOCK_REORDER = "REORDER_NOW"
STOCK_OUT = "LIKELY_OUT"
STOCK_NO_DATA = "NO_DATA"


def safety_stock(daily_usages, lead_working_days, z=SERVICE_LEVEL_Z):
    """z x sample standard deviation of daily usage x sqrt(lead time in working days).

    Needs at least two usage periods; with fewer it is 0.
    """
    n = len(daily_usages)
    if n < 2 or not lead_working_days or lead_working_days <= 0:
        return 0.0
    mean = sum(daily_usages) / n
    sd = math.sqrt(sum((u - mean) ** 2 for u in daily_usages) / (n - 1))
    return z * sd * math.sqrt(lead_working_days)


def reorder_point(daily_usage, lead_working_days, safety=0.0):
    """Usage expected during the supplier lead time plus safety stock."""
    if daily_usage is None:
        return None
    return float(daily_usage) * float(lead_working_days or 0) + float(safety or 0)


def stock_status(estimated_on_hand, daily_usage, reorder_pt):
    """OK, REORDER_NOW (at or below the reorder point), LIKELY_OUT (nothing left)
    or NO_DATA (no usage history yet)."""
    if daily_usage is None or estimated_on_hand is None:
        return STOCK_NO_DATA
    if estimated_on_hand <= 0:
        return STOCK_OUT
    if reorder_pt is not None and estimated_on_hand <= reorder_pt:
        return STOCK_REORDER
    return STOCK_OK


def _restock_lead_times():
    """{tool id: (measured lead days list, last supplier's stated lead days)} from
    consumable restock lines (cancelled ones left out)."""
    from app.models.material_purchase import MaterialPurchase

    out = defaultdict(lambda: {"measured": [], "stated": None, "last": None})
    lines = (
        MaterialPurchase.query.options(joinedload(MaterialPurchase.supplier))
        .filter(MaterialPurchase.tool_id.isnot(None), MaterialPurchase.cancelled_at.is_(None))
        .all()
    )
    for line in lines:
        row = out[line.tool_id]
        if line.date_ordered and line.date_received and line.date_received >= line.date_ordered:
            row["measured"].append((line.date_received - line.date_ordered).days)
        on = line.date_ordered or (line.created_at.date() if line.created_at else None)
        if line.supplier and line.supplier.typical_lead_time_days is not None:
            if row["last"] is None or (on and on >= row["last"]):
                row["last"] = on
                row["stated"] = line.supplier.typical_lead_time_days
    return out


def lead_time_for(info):
    """(calendar days, source): measured average, else the supplier's stated
    lead time, else the default."""
    if info and info["measured"]:
        return sum(info["measured"]) / len(info["measured"]), "MEASURED"
    if info and info["stated"] is not None:
        return float(info["stated"]), "SUPPLIER"
    return float(DEFAULT_LEAD_TIME_DAYS), "DEFAULT"


def consumable_run_out(today: date | None = None):
    """Every consumable: moving-average daily usage over its last 3 stocktake
    periods, days left and the run-out date on the shop calendar, and the
    reorder point (usage during the lead time + safety stock)."""
    from app.services import stocktake_service as st_svc

    today = today or shop_now().date()
    end_of_today_utc = shop_local_to_utc(today + timedelta(days=1), time(0, 0))
    schedule = default_shop_schedule_by_dow()
    lead_info = _restock_lead_times()
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
        lead_days, lead_source = lead_time_for(lead_info.get(tool.id))
        lead_working = shop_working_days_between(
            today, today + timedelta(days=math.ceil(lead_days)), schedule
        )
        row.update(
            {
                "leadTimeDays": _round(lead_days, 1),
                "leadTimeSource": lead_source,
                "leadTimeWorkingDays": lead_working,
                "safetyStock": None,
                "reorderPoint": None,
                "status": STOCK_NO_DATA,
            }
        )
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
            safety = safety_stock([p["dailyUsage"] for p in periods], lead_working)
            rop = reorder_point(usage, lead_working, safety)
            row["safetyStock"] = _round(safety, 2)
            row["reorderPoint"] = _round(rop, 2)
            row["status"] = stock_status(max(estimate, 0.0), usage, rop)
        items.append(row)

    status_order = {STOCK_OUT: 0, STOCK_REORDER: 1, STOCK_OK: 2, STOCK_NO_DATA: 3}
    items.sort(
        key=lambda r: (
            status_order[r["status"]],
            r["runOutDate"] is None,
            r["runOutDate"] or "",
            r["name"] or "",
        )
    )
    return {
        "label": "consumableRunOut",
        "method": f"Moving average of the last {STOCKTAKE_WINDOW} stocktake periods",
        "description": (
            "Daily usage = average of the last 3 stocktake periods. Reorder point = "
            "daily usage x lead time + safety stock."
        ),
        "serviceLevelPct": SERVICE_LEVEL_PCT,
        "defaultLeadTimeDays": DEFAULT_LEAD_TIME_DAYS,
        "today": today.isoformat(),
        "items": items,
    }
