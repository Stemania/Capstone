"""Office periodic stock counts for consumables."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func

from app.extensions import db
from app.models.stocktake import Stocktake, StocktakeLine
from app.models.tool import Tool, ToolCategory
from app.models.tool_event import ToolEvent, ToolEventType
from app.services.schedule_calendar import shop_local_to_utc, shop_now
from app.utils.errors import AppError


def _dec(v, default="0") -> Decimal:
    if v is None or v == "":
        return Decimal(default)
    return Decimal(str(v))


def _num(v, places=2):
    if v is None:
        return None
    return round(float(v), places)


def last_stocktake_global():
    return Stocktake.query.order_by(Stocktake.counted_on.desc(), Stocktake.created_at.desc()).first()


def last_line_for_tool(tool_id):
    return (
        db.session.query(StocktakeLine)
        .join(Stocktake)
        .filter(StocktakeLine.tool_id == tool_id)
        .order_by(Stocktake.counted_on.desc(), Stocktake.created_at.desc())
        .first()
    )


def stocktake_form():
    """Consumables with system qty and previous count context for the count UI."""
    last = last_stocktake_global()
    tools = (
        Tool.query.filter_by(category=ToolCategory.CONSUMABLE)
        .order_by(Tool.name)
        .all()
    )
    items = []
    for tool in tools:
        prev_line = last_line_for_tool(tool.id)
        prev_st = prev_line.stocktake if prev_line else None
        items.append(
            {
                "toolId": tool.id,
                "name": tool.name,
                "code": tool.code,
                "unit": tool.unit,
                "sizeSpec": tool.size_spec,
                "quantityOnHand": _num(tool.quantity_on_hand),
                "minimumStock": _num(tool.minimum_stock),
                "lowStock": tool.low_stock,
                "lastCountedOn": prev_st.counted_on.isoformat()
                if prev_st and prev_st.counted_on
                else None,
                "lastCountedQuantity": _num(prev_line.counted_quantity) if prev_line else None,
            }
        )
    return {
        "previousStocktakeOn": last.counted_on.isoformat() if last and last.counted_on else None,
        "previousCountedByName": last.counted_by.full_name if last and last.counted_by else None,
        "items": items,
    }


def list_stocktakes(page=1, per_page=20):
    return Stocktake.query.order_by(
        Stocktake.counted_on.desc(), Stocktake.created_at.desc()
    ).paginate(page=page, per_page=per_page, error_out=False)


def get_stocktake(stocktake_id):
    st = Stocktake.query.get(stocktake_id)
    if not st:
        raise AppError("Stocktake not found", "NOT_FOUND", 404)
    return st


def submit_stocktake(counted_by_id, lines_data, counted_on=None, notes=None):
    """
    Record a consumable count session and set quantity_on_hand to counted values.
    Does not create ADJUST events — deliveries stay as positive ADJUST between counts.
    """
    if not lines_data or not isinstance(lines_data, list):
        raise AppError("lines are required", "VALIDATION_ERROR", 400)

    if counted_on:
        try:
            on_date = date.fromisoformat(str(counted_on)[:10])
        except ValueError as exc:
            raise AppError("countedOn must be YYYY-MM-DD", "VALIDATION_ERROR", 400) from exc
    else:
        on_date = shop_now().date()

    # One stocktake per calendar day keeps consecutive-pair math unambiguous.
    existing = Stocktake.query.filter_by(counted_on=on_date).first()
    if existing:
        raise AppError(
            f"A stocktake for {on_date.isoformat()} already exists",
            "CONFLICT",
            409,
        )

    by_id = {}
    for raw in lines_data:
        tool_id = raw.get("toolId")
        if not tool_id:
            raise AppError("Each line needs toolId", "VALIDATION_ERROR", 400)
        if tool_id in by_id:
            raise AppError("Duplicate toolId in lines", "VALIDATION_ERROR", 400)
        try:
            qty = Decimal(str(raw.get("countedQuantity")))
        except Exception as exc:
            raise AppError("countedQuantity must be a number", "VALIDATION_ERROR", 400) from exc
        if qty < 0:
            raise AppError("countedQuantity cannot be negative", "VALIDATION_ERROR", 400)
        by_id[tool_id] = qty

    tools = Tool.query.filter(
        Tool.id.in_(list(by_id.keys())),
        Tool.category == ToolCategory.CONSUMABLE,
    ).all()
    if len(tools) != len(by_id):
        raise AppError(
            "All lines must be consumable inventory items",
            "VALIDATION_ERROR",
            400,
        )

    st = Stocktake(
        counted_on=on_date,
        counted_by_id=counted_by_id,
        notes=(notes or "").strip() or None,
        created_at=datetime.now(timezone.utc),
    )
    db.session.add(st)
    db.session.flush()

    for tool in tools:
        counted = by_id[tool.id]
        previous = _dec(tool.quantity_on_hand)
        db.session.add(
            StocktakeLine(
                stocktake_id=st.id,
                tool_id=tool.id,
                previous_quantity=previous,
                counted_quantity=counted,
            )
        )
        tool.quantity_on_hand = counted

    db.session.commit()
    return st


def positive_adjustments_between(tool_id, start_utc, end_utc) -> Decimal:
    """Deliveries / positive ADJUST only (reason prefix '+')."""
    events = (
        ToolEvent.query.filter(
            ToolEvent.tool_id == tool_id,
            ToolEvent.type == ToolEventType.ADJUST,
            ToolEvent.created_at > start_utc,
            ToolEvent.created_at <= end_utc,
        ).all()
    )
    total = Decimal("0")
    for ev in events:
        reason = (ev.reason or "").strip()
        if reason.startswith("+"):
            total += _dec(ev.quantity)
    return total


def consecutive_stocktake_pairs(tool_id):
    """List of (prev_line, curr_line) ordered by count date ascending."""
    lines = (
        db.session.query(StocktakeLine)
        .join(Stocktake)
        .filter(StocktakeLine.tool_id == tool_id)
        .order_by(Stocktake.counted_on.asc(), Stocktake.created_at.asc())
        .all()
    )
    pairs = []
    for i in range(1, len(lines)):
        pairs.append((lines[i - 1], lines[i]))
    return pairs


def _stocktake_boundary_utc(st: Stocktake, *, end_of_day: bool):
    """Map count date to UTC bounds for ADJUST windowing."""
    if end_of_day:
        # Inclusive end of counted_on in shop time
        return shop_local_to_utc(st.counted_on, time(23, 59, 59))
    return shop_local_to_utc(st.counted_on, time(0, 0))


def consumption_for_pair(prev_line: StocktakeLine, curr_line: StocktakeLine) -> Decimal:
    """consumed = previous_count + additions - current_count (floored at 0)."""
    prev_st = prev_line.stocktake
    curr_st = curr_line.stocktake
    # Window: after previous count day start through end of current count day
    start_utc = _stocktake_boundary_utc(prev_st, end_of_day=False)
    # Use created_at of stocktakes when available for tighter delivery windows
    if prev_st.created_at:
        start_utc = prev_st.created_at
    end_utc = curr_st.created_at or _stocktake_boundary_utc(curr_st, end_of_day=True)

    additions = positive_adjustments_between(prev_line.tool_id, start_utc, end_utc)
    raw = _dec(prev_line.counted_quantity) + additions - _dec(curr_line.counted_quantity)
    return max(raw, Decimal("0"))


def consumable_consumption_in_period(tool_id, period_from: date, period_to: date):
    """
    Sum consumption for consecutive pairs whose current count date falls in [from, to].
    Returns (consumed_qty, working_days_covered).
    """
    from app.services.inventory_service import _working_days

    total = Decimal("0")
    day_from = None
    day_to = None
    for prev_line, curr_line in consecutive_stocktake_pairs(tool_id):
        curr_on = curr_line.stocktake.counted_on
        if curr_on < period_from or curr_on > period_to:
            continue
        total += consumption_for_pair(prev_line, curr_line)
        prev_on = prev_line.stocktake.counted_on
        if day_from is None or prev_on < day_from:
            day_from = prev_on
        if day_to is None or curr_on > day_to:
            day_to = curr_on
    if day_from is None or day_to is None:
        return float(total), 0
    return float(total), _working_days(day_from, day_to)


def consumable_consumption_lookback(tool_id, lookback_days: int):
    today = shop_now().date()
    period_from = today - timedelta(days=max(1, lookback_days) - 1)
    return consumable_consumption_in_period(tool_id, period_from, today)
