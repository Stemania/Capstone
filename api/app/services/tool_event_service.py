"""Inventory item (tool) custody and stock movements."""

from __future__ import annotations

import io
import uuid
from decimal import Decimal

import qrcode
from sqlalchemy import case, func

from app.extensions import db
from app.models.tool import Tool, ToolCategory
from app.models.tool_event import ToolEvent, ToolEventType
from app.utils.errors import AppError


def _dec(v, default="0") -> Decimal:
    if v is None or v == "":
        return Decimal(default)
    return Decimal(str(v))


def _parse_quantity(raw, *, default=Decimal("1")) -> Decimal:
    if raw is None or raw == "":
        return default
    try:
        qty = Decimal(str(raw))
    except Exception as exc:
        raise AppError("quantity must be a number", "VALIDATION_ERROR", 400) from exc
    if qty <= 0:
        raise AppError("quantity must be greater than zero", "VALIDATION_ERROR", 400)
    return qty


def worker_outstanding_quantity(tool_id, worker_id) -> Decimal:
    """Net borrowed quantity still held by a worker for a returnable item."""
    borrowed = (
        db.session.query(func.coalesce(func.sum(ToolEvent.quantity), 0))
        .filter(
            ToolEvent.tool_id == tool_id,
            ToolEvent.worker_id == worker_id,
            ToolEvent.type == ToolEventType.BORROW,
        )
        .scalar()
    )
    returned = (
        db.session.query(func.coalesce(func.sum(ToolEvent.quantity), 0))
        .filter(
            ToolEvent.tool_id == tool_id,
            ToolEvent.worker_id == worker_id,
            ToolEvent.type == ToolEventType.RETURN,
        )
        .scalar()
    )
    return _dec(borrowed) - _dec(returned)


def list_outstanding_holders(tool_id):
    """Workers with positive outstanding returnable quantity for this item type."""
    borrow_sum = func.coalesce(
        func.sum(
            case((ToolEvent.type == ToolEventType.BORROW, ToolEvent.quantity), else_=0)
        ),
        0,
    )
    return_sum = func.coalesce(
        func.sum(
            case((ToolEvent.type == ToolEventType.RETURN, ToolEvent.quantity), else_=0)
        ),
        0,
    )
    rows = (
        db.session.query(
            ToolEvent.worker_id,
            borrow_sum.label("borrowed"),
            return_sum.label("returned"),
            func.min(
                case(
                    (ToolEvent.type == ToolEventType.BORROW, ToolEvent.created_at),
                    else_=None,
                )
            ).label("first_borrow"),
        )
        .filter(
            ToolEvent.tool_id == tool_id,
            ToolEvent.type.in_([ToolEventType.BORROW, ToolEventType.RETURN]),
        )
        .group_by(ToolEvent.worker_id)
        .all()
    )
    holders = []
    from app.models.user import User

    for row in rows:
        outstanding = _dec(row.borrowed) - _dec(row.returned)
        if outstanding <= 0:
            continue
        user = User.query.get(row.worker_id)
        holders.append(
            {
                "holderId": row.worker_id,
                "holderName": user.full_name if user else None,
                "quantity": float(outstanding),
                "since": row.first_borrow.isoformat() if row.first_borrow else None,
            }
        )
    holders.sort(key=lambda h: -(h["quantity"] or 0))
    return holders


def get_current_custody(tool_id):
    """
    Legacy single-holder shape: primary outstanding holder for returnables.
    Consumables have no custody.
    """
    tool = Tool.query.get(tool_id)
    if not tool or tool.category == ToolCategory.CONSUMABLE:
        return None
    holders = list_outstanding_holders(tool_id)
    if not holders:
        return None
    top = holders[0]
    return {
        "holderId": top["holderId"],
        "holderName": top["holderName"],
        "since": top["since"],
        "quantity": top["quantity"],
    }


def create_tool(data):
    name = (data.get("name") or "").strip()
    if not name:
        raise AppError("Name is required", "VALIDATION_ERROR", 400)

    code = (data.get("code") or "").strip() or f"TOOL-{uuid.uuid4().hex[:8].upper()}"
    if Tool.query.filter_by(code=code).first():
        raise AppError("Tool code already exists", "CONFLICT", 409)

    cat_raw = (data.get("category") or "RETURNABLE_TOOL").upper()
    try:
        category = ToolCategory(cat_raw)
    except ValueError as exc:
        raise AppError(
            "category must be RETURNABLE_TOOL or CONSUMABLE",
            "VALIDATION_ERROR",
            400,
        ) from exc

    qty = _parse_quantity(data.get("quantityOnHand"), default=Decimal("0"))
    if qty < 0:
        raise AppError("quantityOnHand cannot be negative", "VALIDATION_ERROR", 400)

    min_stock = data.get("minimumStock")
    minimum = None if min_stock in (None, "") else _parse_quantity(min_stock, default=Decimal("0"))

    tool = Tool(
        name=name,
        code=code,
        category=category,
        unit=(data.get("unit") or "pcs").strip() or "pcs",
        quantity_on_hand=qty,
        minimum_stock=minimum,
        size_spec=(data.get("sizeSpec") or None) or None,
    )
    db.session.add(tool)
    db.session.commit()
    return tool


def generate_qr_png(tool_code):
    qr = qrcode.QRCode(version=1, box_size=10, border=4)
    qr.add_data(tool_code)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    return buffer


def scan_tool(code, worker_id, job_order_id=None, intent=None, quantity=None):
    tool = Tool.query.filter_by(code=code).first()
    if not tool:
        raise AppError("Tool not found", "NOT_FOUND", 404)

    qty = _parse_quantity(quantity, default=Decimal("1"))
    on_hand = _dec(tool.quantity_on_hand)

    if tool.category == ToolCategory.CONSUMABLE:
        if intent and intent.upper() not in ("ISSUE",):
            if intent.upper() == "RETURN":
                raise AppError(
                    "Consumables cannot be returned — use Issue",
                    "VALIDATION_ERROR",
                    400,
                )
            if intent.upper() == "BORROW":
                raise AppError(
                    "Consumables are issued, not borrowed",
                    "VALIDATION_ERROR",
                    400,
                )
        event_type = ToolEventType.ISSUE
        if on_hand < qty:
            raise AppError(
                f"Insufficient stock ({float(on_hand)} {tool.unit} on hand)",
                "CONFLICT",
                409,
            )
        tool.quantity_on_hand = on_hand - qty
    else:
        # RETURNABLE_TOOL
        outstanding = worker_outstanding_quantity(tool.id, worker_id)
        if intent:
            intent = intent.upper()
            if intent not in ("BORROW", "RETURN"):
                raise AppError(
                    "intent must be BORROW or RETURN for returnable tools",
                    "VALIDATION_ERROR",
                    400,
                )
            event_type = ToolEventType(intent)
        else:
            event_type = (
                ToolEventType.RETURN if outstanding > 0 else ToolEventType.BORROW
            )

        if event_type == ToolEventType.BORROW:
            if on_hand < qty:
                raise AppError(
                    f"Insufficient stock ({float(on_hand)} {tool.unit} available)",
                    "CONFLICT",
                    409,
                )
            tool.quantity_on_hand = on_hand - qty
        else:
            if outstanding < qty:
                raise AppError(
                    f"You only hold {float(outstanding)} of this item",
                    "CONFLICT",
                    409,
                )
            tool.quantity_on_hand = on_hand + qty

    try:
        event = ToolEvent(
            tool_id=tool.id,
            worker_id=worker_id,
            type=event_type,
            quantity=qty,
            job_order_id=job_order_id,
        )
        db.session.add(event)
        db.session.commit()
        return event
    except Exception:
        db.session.rollback()
        raise


def adjust_stock(tool_id, worker_id, quantity_delta, reason):
    """Admin/Office stock correction. quantity_delta may be positive or negative."""
    tool = Tool.query.get(tool_id)
    if not tool:
        raise AppError("Tool not found", "NOT_FOUND", 404)
    reason = (reason or "").strip()
    if not reason:
        raise AppError("reason is required for adjustments", "VALIDATION_ERROR", 400)
    try:
        delta = Decimal(str(quantity_delta))
    except Exception as exc:
        raise AppError("quantity must be a number", "VALIDATION_ERROR", 400) from exc
    if delta == 0:
        raise AppError("quantity delta cannot be zero", "VALIDATION_ERROR", 400)

    new_qty = _dec(tool.quantity_on_hand) + delta
    if new_qty < 0:
        raise AppError(
            "Adjustment would make quantity on hand negative",
            "VALIDATION_ERROR",
            400,
        )
    tool.quantity_on_hand = new_qty
    event = ToolEvent(
        tool_id=tool.id,
        worker_id=worker_id,
        type=ToolEventType.ADJUST,
        quantity=abs(delta),
        reason=f"{'+' if delta > 0 else '-'}{abs(delta)}: {reason}",
    )
    db.session.add(event)
    db.session.commit()
    return event


def list_held_tools(worker_id):
    """Returnable item types with positive outstanding quantity for this worker."""
    tools = Tool.query.filter_by(category=ToolCategory.RETURNABLE_TOOL).all()
    held = []
    for tool in tools:
        outstanding = worker_outstanding_quantity(tool.id, worker_id)
        if outstanding <= 0:
            continue
        # earliest unmatched borrow approx = latest borrow time among events
        latest_borrow = (
            ToolEvent.query.filter_by(
                tool_id=tool.id, worker_id=worker_id, type=ToolEventType.BORROW
            )
            .order_by(ToolEvent.created_at.desc())
            .first()
        )
        held.append(
            {
                "id": tool.id,
                "name": tool.name,
                "code": tool.code,
                "category": tool.category.value,
                "sizeSpec": tool.size_spec,
                "unit": tool.unit,
                "quantity": float(outstanding),
                "quantityOnHand": float(_dec(tool.quantity_on_hand)),
                "since": latest_borrow.created_at.isoformat()
                if latest_borrow and latest_borrow.created_at
                else None,
            }
        )
    held.sort(key=lambda r: r["name"])
    return held


def list_tool_events(tool_id=None, page=1, per_page=50):
    query = ToolEvent.query.order_by(ToolEvent.created_at.desc())
    if tool_id:
        query = query.filter_by(tool_id=tool_id)
    return query.paginate(page=page, per_page=per_page, error_out=False)


def list_worker_tool_events(worker_id, page=1, per_page=50):
    return (
        ToolEvent.query.filter_by(worker_id=worker_id)
        .order_by(ToolEvent.created_at.desc())
        .paginate(page=page, per_page=per_page, error_out=False)
    )
