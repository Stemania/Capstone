"""Inventory purchase suggestions and usage analytics (read-only aggregations)."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, time, timedelta
from decimal import Decimal

from sqlalchemy import case, func

from app.extensions import db
from app.models.tool import Tool, ToolCategory
from app.models.tool_event import ToolEvent, ToolEventType
from app.models.user import User
from app.services.schedule_calendar import shop_local_to_utc, shop_now
from app.utils.errors import AppError


def _num(v, places=2):
    if v is None:
        return None
    return round(float(v), places)


def _parse_period(from_s, to_s):
    today = shop_now().date()
    if to_s:
        try:
            period_to = date.fromisoformat(to_s)
        except ValueError as exc:
            raise AppError("Invalid 'to' date (YYYY-MM-DD)", "VALIDATION_ERROR", 400) from exc
    else:
        period_to = today
    if from_s:
        try:
            period_from = date.fromisoformat(from_s)
        except ValueError as exc:
            raise AppError("Invalid 'from' date (YYYY-MM-DD)", "VALIDATION_ERROR", 400) from exc
    else:
        period_from = period_to - timedelta(days=29)
    if period_from > period_to:
        raise AppError("'from' must be on or before 'to'", "VALIDATION_ERROR", 400)
    start_utc = shop_local_to_utc(period_from, time(0, 0))
    end_utc = shop_local_to_utc(period_to + timedelta(days=1), time(0, 0))
    return period_from, period_to, start_utc, end_utc


def _working_days(d_from: date, d_to: date) -> int:
    n = 0
    d = d_from
    while d <= d_to:
        if d.weekday() < 6:
            n += 1
        d += timedelta(days=1)
    return n


def consumption_qty_expr():
    """Quantity that leaves stock: ISSUE full, BORROW full (RETURN is restock)."""
    return case(
        (
            ToolEvent.type.in_([ToolEventType.ISSUE, ToolEventType.BORROW]),
            ToolEvent.quantity,
        ),
        else_=0,
    )


def item_consumption_rate(tool_id, start_utc, end_utc, working_days):
    total = (
        db.session.query(func.coalesce(func.sum(consumption_qty_expr()), 0))
        .filter(
            ToolEvent.tool_id == tool_id,
            ToolEvent.created_at >= start_utc,
            ToolEvent.created_at < end_utc,
            ToolEvent.type.in_([ToolEventType.ISSUE, ToolEventType.BORROW]),
        )
        .scalar()
    )
    total = float(total or 0)
    per_day = (total / working_days) if working_days else None
    return total, per_day


def purchase_suggestions(lookback_days=30):
    """
    Low-stock items with suggested order qty and recent consumption.
    Suggestion only — never places an order.
    """
    today = shop_now().date()
    period_from = today - timedelta(days=max(1, int(lookback_days)) - 1)
    period_to = today
    start_utc = shop_local_to_utc(period_from, time(0, 0))
    end_utc = shop_local_to_utc(period_to + timedelta(days=1), time(0, 0))
    wd = _working_days(period_from, period_to)

    items = []
    for tool in Tool.query.order_by(Tool.name).all():
        if tool.minimum_stock is None:
            continue
        on_hand = Decimal(str(tool.quantity_on_hand or 0))
        minimum = Decimal(str(tool.minimum_stock))
        if on_hand > minimum:
            continue
        consumed, per_day = item_consumption_rate(tool.id, start_utc, end_utc, wd)
        # Restock toward 2× minimum, at least the shortfall
        target = minimum * 2
        suggested = max(minimum - on_hand, target - on_hand, Decimal("0"))
        items.append(
            {
                "toolId": tool.id,
                "name": tool.name,
                "code": tool.code,
                "category": tool.category.value,
                "sizeSpec": tool.size_spec,
                "unit": tool.unit,
                "quantityOnHand": _num(on_hand),
                "minimumStock": _num(minimum),
                "suggestedOrderQuantity": _num(suggested),
                "recentConsumptionQuantity": _num(consumed),
                "consumptionPerWorkingDay": _num(per_day, 4),
                "lookbackWorkingDays": wd,
            }
        )
    items.sort(key=lambda r: (r["quantityOnHand"] or 0) / max(r["minimumStock"] or 1, 1e-9))
    return {
        "label": "purchaseSuggestions",
        "description": (
            "Low-stock inventory suggestions for Office review. "
            "Not an automatic purchase order."
        ),
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "workingDaysInSample": wd,
        "itemCount": len(items),
        "items": items,
    }


def usage_by_worker(from_s=None, to_s=None):
    period_from, period_to, start_utc, end_utc = _parse_period(from_s, to_s)
    wd = _working_days(period_from, period_to)

    events = (
        ToolEvent.query.filter(
            ToolEvent.created_at >= start_utc,
            ToolEvent.created_at < end_utc,
            ToolEvent.type.in_(
                [ToolEventType.ISSUE, ToolEventType.BORROW, ToolEventType.RETURN]
            ),
        )
        .all()
    )

    # (worker_id, tool_id) -> stats
    buckets = defaultdict(
        lambda: {
            "issueQty": 0.0,
            "borrowQty": 0.0,
            "returnQty": 0.0,
            "eventCount": 0,
            "tool": None,
            "worker": None,
        }
    )
    for ev in events:
        key = (ev.worker_id, ev.tool_id)
        st = buckets[key]
        st["eventCount"] += 1
        st["tool"] = ev.tool
        st["worker"] = ev.worker
        q = float(ev.quantity or 0)
        if ev.type == ToolEventType.ISSUE:
            st["issueQty"] += q
        elif ev.type == ToolEventType.BORROW:
            st["borrowQty"] += q
        elif ev.type == ToolEventType.RETURN:
            st["returnQty"] += q

    rows = []
    for (wid, tid), st in buckets.items():
        tool = st["tool"]
        worker = st["worker"]
        consumed = st["issueQty"] + st["borrowQty"]
        rows.append(
            {
                "workerId": wid,
                "workerName": worker.full_name if worker else None,
                "toolId": tid,
                "toolName": tool.name if tool else None,
                "toolCode": tool.code if tool else None,
                "category": tool.category.value if tool and tool.category else None,
                "sizeSpec": tool.size_spec if tool else None,
                "unit": tool.unit if tool else None,
                "eventCount": st["eventCount"],
                "issueQuantity": _num(st["issueQty"]),
                "borrowQuantity": _num(st["borrowQty"]),
                "returnQuantity": _num(st["returnQty"]),
                "netConsumptionQuantity": _num(consumed),
            }
        )
    rows.sort(key=lambda r: (-(r["netConsumptionQuantity"] or 0), r["workerName"] or ""))

    # Outstanding unreturned (current, not period-bound)
    from app.services.tool_event_service import worker_outstanding_quantity

    outstanding = []
    returnable = Tool.query.filter_by(category=ToolCategory.RETURNABLE_TOOL).all()
    all_workers = User.query.all()
    for worker in all_workers:
        total_out = 0.0
        by_item = []
        for tool in returnable:
            q = float(worker_outstanding_quantity(tool.id, worker.id))
            if q > 0:
                total_out += q
                by_item.append(
                    {
                        "toolId": tool.id,
                        "toolName": tool.name,
                        "toolCode": tool.code,
                        "quantity": _num(q),
                    }
                )
        if total_out > 0:
            outstanding.append(
                {
                    "workerId": worker.id,
                    "workerName": worker.full_name,
                    "totalOutstandingQuantity": _num(total_out),
                    "items": by_item,
                }
            )
    outstanding.sort(key=lambda r: -(r["totalOutstandingQuantity"] or 0))

    return {
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "workingDaysInPeriod": wd,
        "byWorkerItem": rows,
        "outstandingUnreturned": outstanding,
    }


def usage_by_item(from_s=None, to_s=None):
    period_from, period_to, start_utc, end_utc = _parse_period(from_s, to_s)
    wd = _working_days(period_from, period_to)

    tools = Tool.query.order_by(Tool.name).all()
    rows = []
    for tool in tools:
        consumed, per_day = item_consumption_rate(tool.id, start_utc, end_utc, wd)
        issue_qty = (
            db.session.query(func.coalesce(func.sum(ToolEvent.quantity), 0))
            .filter(
                ToolEvent.tool_id == tool.id,
                ToolEvent.created_at >= start_utc,
                ToolEvent.created_at < end_utc,
                ToolEvent.type == ToolEventType.ISSUE,
            )
            .scalar()
        )
        borrow_qty = (
            db.session.query(func.coalesce(func.sum(ToolEvent.quantity), 0))
            .filter(
                ToolEvent.tool_id == tool.id,
                ToolEvent.created_at >= start_utc,
                ToolEvent.created_at < end_utc,
                ToolEvent.type == ToolEventType.BORROW,
            )
            .scalar()
        )
        rows.append(
            {
                "toolId": tool.id,
                "name": tool.name,
                "code": tool.code,
                "category": tool.category.value,
                "sizeSpec": tool.size_spec,
                "unit": tool.unit,
                "quantityOnHand": _num(tool.quantity_on_hand),
                "minimumStock": _num(tool.minimum_stock),
                "lowStock": tool.low_stock,
                "issueQuantity": _num(issue_qty),
                "borrowQuantity": _num(borrow_qty),
                "consumptionQuantity": _num(consumed),
                "consumptionPerWorkingDay": _num(per_day, 4),
            }
        )
    rows.sort(key=lambda r: -(r["consumptionQuantity"] or 0))
    return {
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "workingDaysInPeriod": wd,
        "items": rows,
    }
