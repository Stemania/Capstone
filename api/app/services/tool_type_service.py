"""ToolType / ToolUnit CRUD and aggregates."""

from __future__ import annotations

import re
import uuid
from decimal import Decimal

from app.extensions import db
from app.models.tool_event import ToolEvent, ToolEventType
from app.models.tool_type import ToolType, ToolUnit, ToolUnitStatus
from app.utils.errors import AppError


def _uuid():
    return str(uuid.uuid4())


def list_tool_types(*, only_with_out=False, include_units=False):
    types = ToolType.query.order_by(ToolType.name).all()
    rows = [t.to_dict(include_units=include_units) for t in types]
    if only_with_out:
        rows = [r for r in rows if (r.get("outCount") or 0) > 0]
    return rows


def get_unit_by_asset_code(code: str):
    unit = ToolUnit.query.filter_by(asset_code=(code or "").strip()).first()
    if not unit:
        raise AppError("Tool unit not found", "NOT_FOUND", 404)
    return unit.to_dict()


def get_tool_type(type_id, include_units=True):
    t = ToolType.query.get(type_id)
    if not t:
        raise AppError("Tool type not found", "NOT_FOUND", 404)
    return t.to_dict(include_units=include_units)


def create_tool_type(data):
    name = (data.get("name") or "").strip()
    if not name:
        raise AppError("Name is required", "VALIDATION_ERROR", 400)
    code = (data.get("code") or "").strip() or f"TT-{uuid.uuid4().hex[:8].upper()}"
    if ToolType.query.filter_by(code=code).first():
        raise AppError("Tool type code already exists", "CONFLICT", 409)
    t = ToolType(
        name=name,
        code=code,
        description=(data.get("description") or None) or None,
        is_seed=bool(data.get("isSeed")),
    )
    db.session.add(t)
    db.session.commit()
    return t.to_dict(include_units=True)


def update_tool_type(type_id, data):
    t = ToolType.query.get(type_id)
    if not t:
        raise AppError("Tool type not found", "NOT_FOUND", 404)
    if "name" in data:
        name = (data.get("name") or "").strip()
        if not name:
            raise AppError("Name is required", "VALIDATION_ERROR", 400)
        t.name = name
    if "code" in data:
        code = (data.get("code") or "").strip()
        if not code:
            raise AppError("Code is required", "VALIDATION_ERROR", 400)
        clash = ToolType.query.filter(ToolType.code == code, ToolType.id != type_id).first()
        if clash:
            raise AppError("Tool type code already exists", "CONFLICT", 409)
        t.code = code
    if "description" in data:
        t.description = (data.get("description") or None) or None
    db.session.commit()
    return t.to_dict(include_units=True)


MAX_UNITS_AT_ONCE = 50


def _next_asset_codes(t, count):
    """The next free TYPECODE-001 style codes for a type (after the highest used)."""
    pattern = re.compile(rf"^{re.escape(t.code)}-(\d+)$")
    used = [int(m.group(1)) for u in (t.units or []) if (m := pattern.match(u.asset_code or ""))]
    n = max(used, default=0)
    codes = []
    while len(codes) < count:
        n += 1
        code = f"{t.code}-{n:03d}"
        if not ToolUnit.query.filter_by(asset_code=code).first():
            codes.append(code)
    return codes


def create_tool_unit(type_id, data):
    """Add one unit (with an optional asset code) or several numbered units."""
    t = ToolType.query.get(type_id)
    if not t:
        raise AppError("Tool type not found", "NOT_FOUND", 404)
    try:
        count = int(data.get("quantity") or 1)
    except (TypeError, ValueError) as exc:
        raise AppError("Quantity must be a whole number", "VALIDATION_ERROR", 400) from exc
    if count < 1 or count > MAX_UNITS_AT_ONCE:
        raise AppError(
            f"Add between 1 and {MAX_UNITS_AT_ONCE} units at a time", "VALIDATION_ERROR", 400
        )
    asset = (data.get("assetCode") or "").strip()
    if asset and count > 1:
        raise AppError(
            "Leave the asset code blank to add several units; they are numbered for you.",
            "VALIDATION_ERROR",
            400,
        )
    if asset and ToolUnit.query.filter_by(asset_code=asset).first():
        raise AppError("Asset code already exists", "CONFLICT", 409)
    status_raw = (data.get("status") or "AVAILABLE").upper()
    try:
        status = ToolUnitStatus(status_raw)
    except ValueError as exc:
        raise AppError("Invalid status", "VALIDATION_ERROR", 400) from exc
    if status == ToolUnitStatus.OUT:
        raise AppError(
            "Create units as AVAILABLE; workers scan to mark OUT",
            "VALIDATION_ERROR",
            400,
        )
    codes = [asset] if asset else _next_asset_codes(t, count)
    notes = (data.get("notes") or None) or None
    units = [
        ToolUnit(tool_type_id=t.id, asset_code=code, status=status, notes=notes) for code in codes
    ]
    db.session.add_all(units)
    db.session.commit()
    first = units[0].to_dict()
    first["created"] = [u.to_dict() for u in units]
    return first


def update_tool_unit(unit_id, data):
    unit = ToolUnit.query.get(unit_id)
    if not unit:
        raise AppError("Tool unit not found", "NOT_FOUND", 404)
    if "assetCode" in data:
        asset = (data.get("assetCode") or "").strip()
        if not asset:
            raise AppError("Asset code is required", "VALIDATION_ERROR", 400)
        clash = ToolUnit.query.filter(
            ToolUnit.asset_code == asset, ToolUnit.id != unit_id
        ).first()
        if clash:
            raise AppError("Asset code already exists", "CONFLICT", 409)
        unit.asset_code = asset
    if "notes" in data:
        unit.notes = (data.get("notes") or None) or None
    if "status" in data:
        status_raw = str(data.get("status") or "").upper()
        try:
            status = ToolUnitStatus(status_raw)
        except ValueError as exc:
            raise AppError("Invalid status", "VALIDATION_ERROR", 400) from exc
        # Office can set repair/retired/available; OUT is via scan
        if status == ToolUnitStatus.OUT and unit.status != ToolUnitStatus.OUT:
            raise AppError(
                "Mark a unit OUT by scanning borrow, not by edit",
                "VALIDATION_ERROR",
                400,
            )
        if status in (ToolUnitStatus.AVAILABLE, ToolUnitStatus.UNDER_REPAIR, ToolUnitStatus.RETIRED):
            if unit.status == ToolUnitStatus.OUT and status != ToolUnitStatus.OUT:
                # Force clear custody when taking out of OUT via office edit
                unit.current_holder_id = None
                unit.held_since = None
            unit.status = status
        else:
            unit.status = status
    db.session.commit()
    return unit.to_dict()


def get_tool_unit(unit_id):
    unit = ToolUnit.query.get(unit_id)
    if not unit:
        raise AppError("Tool unit not found", "NOT_FOUND", 404)
    return unit


# Borrowing and returning are the history that must be kept; a unit or type
# with any of it is retired instead of deleted.
_HISTORY_EVENTS = (ToolEventType.BORROW, ToolEventType.RETURN)


def _has_borrow_history(unit_ids) -> bool:
    if not unit_ids:
        return False
    return (
        ToolEvent.query.filter(
            ToolEvent.tool_unit_id.in_(list(unit_ids)), ToolEvent.type.in_(_HISTORY_EVENTS)
        ).first()
        is not None
    )


def _delete_units(units):
    ids = [u.id for u in units]
    if ids:
        ToolEvent.query.filter(ToolEvent.tool_unit_id.in_(ids)).delete(synchronize_session=False)
    for u in units:
        db.session.delete(u)


def remove_tool_unit(unit_id):
    """Delete a unit that was never borrowed; retire one that was, so its
    borrow history stays. A unit that is out must be returned first."""
    unit = get_tool_unit(unit_id)
    if unit.status == ToolUnitStatus.OUT:
        raise AppError(
            f"{unit.asset_code} is borrowed out. Have it returned before removing it.",
            "CONFLICT",
            409,
        )
    if _has_borrow_history([unit.id]):
        unit.status = ToolUnitStatus.RETIRED
        db.session.commit()
        return {"result": "RETIRED", "unit": unit.to_dict()}
    _delete_units([unit])
    db.session.commit()
    return {"result": "DELETED", "id": unit_id}


def remove_tool_type(type_id):
    """Delete a tool type and its units when none were ever borrowed."""
    t = ToolType.query.get(type_id)
    if not t:
        raise AppError("Tool type not found", "NOT_FOUND", 404)
    units = list(t.units or [])
    if any(u.status == ToolUnitStatus.OUT for u in units):
        raise AppError(
            "A unit of this tool is borrowed out. Have it returned before removing the tool.",
            "CONFLICT",
            409,
        )
    if _has_borrow_history([u.id for u in units]):
        raise AppError(
            f"{t.name} has borrowing history, so it is kept. Retire its units instead; "
            "retired units can no longer be borrowed.",
            "CONFLICT",
            409,
        )
    _delete_units(units)
    db.session.delete(t)
    db.session.commit()
    return {"result": "DELETED", "id": type_id}
