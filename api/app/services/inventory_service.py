"""Inventory purchase suggestions and usage analytics."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, time, timedelta
from decimal import Decimal

from sqlalchemy import func

from app.extensions import db
from app.models.tool import Tool, ToolCategory
from app.models.tool_event import ToolEvent, ToolEventType
from app.models.tool_type import ToolType, ToolUnit, ToolUnitStatus
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


def purchase_suggestions(lookback_days=30):
    """Low-stock consumables only (tools are individual units, not qty reorder)."""
    from app.services import stocktake_service as st_svc

    today = shop_now().date()
    period_from = today - timedelta(days=max(1, int(lookback_days)) - 1)
    period_to = today
    wd = _working_days(period_from, period_to)

    items = []
    for tool in (
        Tool.query.filter_by(category=ToolCategory.CONSUMABLE).order_by(Tool.name).all()
    ):
        if tool.minimum_stock is None:
            continue
        on_hand = Decimal(str(tool.quantity_on_hand or 0))
        minimum = Decimal(str(tool.minimum_stock))
        if on_hand > minimum:
            continue

        consumed, pair_wd = st_svc.consumable_consumption_in_period(
            tool.id, period_from, period_to
        )
        rate_days = pair_wd or wd
        per_day = (consumed / rate_days) if rate_days else None
        target = minimum * 2
        suggested = max(minimum - on_hand, target - on_hand, Decimal("0"))
        items.append(
            {
                "toolId": tool.id,
                "name": tool.name,
                "code": tool.code,
                "category": tool.category.value,
                "sizeSpec": tool.size_spec,
                "shopTerm": tool.shop_term,
                "unit": tool.unit,
                "quantityOnHand": _num(on_hand),
                "minimumStock": _num(minimum),
                "suggestedOrderQuantity": _num(suggested),
                "recentConsumptionQuantity": _num(consumed),
                "consumptionPerWorkingDay": _num(per_day, 4),
                "lookbackWorkingDays": wd,
                "consumptionSource": "STOCKTAKE",
            }
        )
    items.sort(key=lambda r: (r["quantityOnHand"] or 0) / max(r["minimumStock"] or 1, 1e-9))
    return {
        "label": "purchaseSuggestions",
        "description": (
            "Low-stock consumable suggestions from stocktakes. "
            "Not an automatic purchase order."
        ),
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "workingDaysInSample": wd,
        "itemCount": len(items),
        "items": items,
    }


def usage_by_worker(from_s=None, to_s=None):
    """Per-unit borrow/return activity (individually tracked tools)."""
    period_from, period_to, start_utc, end_utc = _parse_period(from_s, to_s)
    wd = _working_days(period_from, period_to)

    events = (
        ToolEvent.query.filter(
            ToolEvent.created_at >= start_utc,
            ToolEvent.created_at < end_utc,
            ToolEvent.tool_unit_id.isnot(None),
            ToolEvent.type.in_([ToolEventType.BORROW, ToolEventType.RETURN]),
        ).all()
    )

    buckets = defaultdict(
        lambda: {
            "borrowQty": 0.0,
            "returnQty": 0.0,
            "eventCount": 0,
            "unit": None,
            "worker": None,
        }
    )
    for ev in events:
        key = (ev.worker_id, ev.tool_unit_id)
        st = buckets[key]
        st["eventCount"] += 1
        st["unit"] = ev.tool_unit
        st["worker"] = ev.worker
        q = float(ev.quantity or 0)
        if ev.type == ToolEventType.BORROW:
            st["borrowQty"] += q
        elif ev.type == ToolEventType.RETURN:
            st["returnQty"] += q

    rows = []
    for (wid, _uid), st in buckets.items():
        unit = st["unit"]
        worker = st["worker"]
        rows.append(
            {
                "workerId": wid,
                "workerName": worker.full_name if worker else None,
                "toolUnitId": unit.id if unit else None,
                "toolId": unit.id if unit else None,
                "toolName": unit.tool_type.name if unit and unit.tool_type else None,
                "toolCode": unit.asset_code if unit else None,
                "assetCode": unit.asset_code if unit else None,
                "category": "TOOL_UNIT",
                "sizeSpec": None,
                "unit": "pcs",
                "eventCount": st["eventCount"],
                "borrowQuantity": _num(st["borrowQty"]),
                "returnQuantity": _num(st["returnQty"]),
                "netBorrowQuantity": _num(st["borrowQty"]),
            }
        )
    rows.sort(key=lambda r: (-(r["netBorrowQuantity"] or 0), r["workerName"] or ""))

    outstanding = []
    out_units = ToolUnit.query.filter_by(status=ToolUnitStatus.OUT).all()
    by_worker = defaultdict(list)
    for u in out_units:
        if not u.current_holder_id:
            continue
        by_worker[u.current_holder_id].append(u)
    for wid, units in by_worker.items():
        user = User.query.get(wid)
        outstanding.append(
            {
                "workerId": wid,
                "workerName": user.full_name if user else None,
                "totalOutstandingQuantity": _num(len(units)),
                "items": [
                    {
                        "toolId": u.id,
                        "toolName": u.tool_type.name if u.tool_type else u.asset_code,
                        "toolCode": u.asset_code,
                        "quantity": 1,
                    }
                    for u in units
                ],
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
    """Borrow counts per tool type in period."""
    period_from, period_to, start_utc, end_utc = _parse_period(from_s, to_s)
    wd = _working_days(period_from, period_to)

    types = ToolType.query.order_by(ToolType.name).all()
    rows = []
    for tt in types:
        unit_ids = [u.id for u in tt.units]
        if not unit_ids:
            borrow_qty = 0.0
        else:
            borrow_qty = float(
                db.session.query(func.coalesce(func.sum(ToolEvent.quantity), 0))
                .filter(
                    ToolEvent.tool_unit_id.in_(unit_ids),
                    ToolEvent.created_at >= start_utc,
                    ToolEvent.created_at < end_utc,
                    ToolEvent.type == ToolEventType.BORROW,
                )
                .scalar()
                or 0
            )
        per_day = (borrow_qty / wd) if wd else None
        rows.append(
            {
                "toolId": tt.id,
                "name": tt.name,
                "code": tt.code,
                "category": "TOOL_UNIT",
                "sizeSpec": None,
                "unit": "pcs",
                "quantityOnHand": tt.to_dict()["availableCount"],
                "minimumStock": None,
                "lowStock": False,
                "borrowQuantity": _num(borrow_qty),
                "consumptionQuantity": _num(borrow_qty),
                "consumptionPerWorkingDay": _num(per_day, 4),
            }
        )
    rows.sort(key=lambda r: -(r["consumptionQuantity"] or 0))
    return {
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "workingDaysInPeriod": wd,
        "items": rows,
    }


def usage_consumables(from_s=None, to_s=None):
    from app.services import stocktake_service as st_svc

    period_from, period_to, _start_utc, _end_utc = _parse_period(from_s, to_s)
    wd = _working_days(period_from, period_to)

    tools = (
        Tool.query.filter_by(category=ToolCategory.CONSUMABLE).order_by(Tool.name).all()
    )
    rows = []
    for tool in tools:
        consumed, pair_wd = st_svc.consumable_consumption_in_period(
            tool.id, period_from, period_to
        )
        rate_days = pair_wd or wd
        per_day = (consumed / rate_days) if rate_days else None
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
                "consumptionQuantity": _num(consumed),
                "consumptionPerWorkingDay": _num(per_day, 4) if per_day is not None else None,
                "stocktakeWorkingDays": pair_wd,
            }
        )
    rows.sort(key=lambda r: -(r["consumptionQuantity"] or 0))
    return {
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "workingDaysInPeriod": wd,
        "note": (
            "Consumable usage is measured between stocktakes, not per person. "
            "Consumption = previous count + deliveries − current count."
        ),
        "items": rows,
    }
