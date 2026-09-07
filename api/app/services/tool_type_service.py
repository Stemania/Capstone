"""ToolType / ToolUnit CRUD and aggregates."""

from __future__ import annotations

import uuid
from decimal import Decimal

from app.extensions import db
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


def create_tool_unit(type_id, data):
    t = ToolType.query.get(type_id)
    if not t:
        raise AppError("Tool type not found", "NOT_FOUND", 404)
    asset = (data.get("assetCode") or "").strip()
    if not asset:
        # Auto: TYPECODE-001
        n = len(t.units) + 1
        asset = f"{t.code}-{n:03d}"
    if ToolUnit.query.filter_by(asset_code=asset).first():
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
    unit = ToolUnit(
        tool_type_id=t.id,
        asset_code=asset,
        status=status,
        notes=(data.get("notes") or None) or None,
    )
    db.session.add(unit)
    db.session.commit()
    return unit.to_dict()


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
