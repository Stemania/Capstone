"""Consumable replenishment forecast from purchase history (objective 4.3).

Consumables are not counted or scanned, so the forecast works from what the
shop bought and when. Purchases of a consumable are irregular and come in
uneven amounts, which is intermittent demand. The forecast uses the
Syntetos-Boylan Approximation of Croston's method: the size of a purchase and
the days between purchases are each smoothed with the same constant, and the
next purchase is expected one smoothed interval after the last one.

An item needs ``MIN_PURCHASES`` purchases (two intervals) before it gets a
forecast; with fewer it shows only when it was last bought.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from app.models.tool import Tool, ToolCategory
from app.services import consumable_purchase_service as purchases
from app.services.schedule_calendar import shop_now

ALPHA = 0.2
MIN_PURCHASES = 3
DUE_SOON_DAYS = 7
SPEND_MONTHS = 6


def _round(value, places=1):
    return round(float(value), places) if value is not None else None


def _month_key(d: date) -> str:
    return d.strftime("%Y-%m")


def _months_back(today: date, count: int) -> list[str]:
    keys, cursor = [], today.replace(day=1)
    for _ in range(count):
        keys.append(_month_key(cursor))
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    return list(reversed(keys))


def croston_sba(events: list[tuple[date, float]], alpha: float = ALPHA) -> dict | None:
    """Smoothed purchase size and interval for ``events`` (date, quantity), oldest first.

    One purchase per day (same-day purchases are added together). Returns None
    with fewer than ``MIN_PURCHASES`` purchases. ``typicalErrorDays`` is the
    mean absolute error of the one-step-ahead interval forecasts, once there
    are at least two forecasts to check.
    """
    if len(events) < MIN_PURCHASES:
        return None
    intervals = [(b[0] - a[0]).days for a, b in zip(events, events[1:])]
    size = float(events[0][1])
    interval = float(intervals[0])
    errors = []
    for _day, qty in events[1:]:
        size += alpha * (float(qty) - size)
    for gap in intervals[1:]:
        errors.append(abs(gap - interval))
        interval += alpha * (gap - interval)
    interval = max(interval, 1.0)
    rate = (1 - alpha / 2) * size / interval
    return {
        "usualQuantity": size,
        "everyDays": interval,
        "dailyRate": rate,
        "typicalErrorDays": (sum(errors) / len(errors)) if len(errors) >= 2 else None,
    }


def _status(count, days_until):
    if count == 0:
        return "NO_HISTORY"
    if count < MIN_PURCHASES:
        return "LEARNING"
    if days_until < 0:
        return "OVERDUE"
    if days_until <= DUE_SOON_DAYS:
        return "DUE_SOON"
    return "OK"


def replenishment(today: date | None = None) -> dict:
    """One row per offered consumable, with the summary the dashboards use."""
    today = today or shop_now().date()
    tools = (
        Tool.query.filter(Tool.category == ToolCategory.CONSUMABLE, Tool.active.is_(True))
        .order_by(Tool.name)
        .all()
    )
    rows = purchases.purchase_rows([t.id for t in tools])
    by_tool = defaultdict(list)
    for row in rows:
        by_tool[row["toolId"]].append(row)

    months = _months_back(today, SPEND_MONTHS)
    spend_by_month = {m: 0.0 for m in months}
    spend_30 = 0.0
    bought_30 = 0
    items = []
    for tool in tools:
        history = sorted(by_tool.get(tool.id, []), key=lambda r: r["purchasedOn"])
        per_day = defaultdict(float)
        for row in history:
            per_day[date.fromisoformat(row["purchasedOn"])] += row["quantity"]
            if (today - date.fromisoformat(row["purchasedOn"])).days < 30:
                bought_30 += 1
            if row["amount"] is not None:
                bought = date.fromisoformat(row["purchasedOn"])
                if _month_key(bought) in spend_by_month:
                    spend_by_month[_month_key(bought)] += row["amount"]
                if (today - bought).days < 30:
                    spend_30 += row["amount"]
        events = sorted(per_day.items())
        fit = croston_sba(events)
        last = history[-1] if history else None
        next_date = days_until = None
        if fit:
            next_date = events[-1][0] + timedelta(days=round(fit["everyDays"]))
            days_until = (next_date - today).days
        status = _status(len(events), days_until if days_until is not None else 0)
        costs = [r["unitCost"] for r in history if r["unitCost"] is not None]
        items.append(
            {
                "toolId": tool.id,
                "name": tool.name,
                "shopTerm": tool.shop_term,
                "sizeSpec": tool.size_spec,
                "unit": tool.unit,
                "purchases": len(events),
                "lastBoughtOn": last["purchasedOn"] if last else None,
                "lastQuantity": last["quantity"] if last else None,
                "lastUnitCost": costs[-1] if costs else None,
                "everyDays": _round(fit["everyDays"]) if fit else None,
                "usualQuantity": _round(fit["usualQuantity"]) if fit else None,
                "monthlyNeed": _round(fit["dailyRate"] * 30) if fit else None,
                "typicalErrorDays": _round(fit["typicalErrorDays"]) if fit else None,
                "nextPurchaseOn": next_date.isoformat() if next_date else None,
                "daysUntilNext": days_until,
                "status": status,
            }
        )

    order = {"OVERDUE": 0, "DUE_SOON": 1, "OK": 2, "LEARNING": 3, "NO_HISTORY": 4}
    items.sort(key=lambda r: (order[r["status"]], r["daysUntilNext"] if r["daysUntilNext"] is not None else 10**6, r["name"].lower()))
    return {
        "asOf": today.isoformat(),
        "items": items,
        "summary": {
            "tracked": sum(1 for r in items if r["purchases"]),
            "forecast": sum(1 for r in items if r["status"] in ("OK", "DUE_SOON", "OVERDUE")),
            "dueSoon": sum(1 for r in items if r["status"] == "DUE_SOON"),
            "overdue": sum(1 for r in items if r["status"] == "OVERDUE"),
            "spentLast30Days": round(spend_30, 2),
            "purchasesLast30Days": bought_30,
            "spendByMonth": [{"month": m, "amount": round(spend_by_month[m], 2)} for m in months],
        },
        "method": {
            "name": "Croston's method with the Syntetos-Boylan Approximation",
            "alpha": ALPHA,
            "minPurchases": MIN_PURCHASES,
            "dueSoonDays": DUE_SOON_DAYS,
        },
    }


def due_items(today: date | None = None) -> list[dict]:
    """Consumables due or overdue for buying, for the Office dashboard and supplier orders."""
    return [r for r in replenishment(today)["items"] if r["status"] in ("OVERDUE", "DUE_SOON")]
