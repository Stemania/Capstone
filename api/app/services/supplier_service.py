"""Supplier CRUD."""

from __future__ import annotations

from app.extensions import db
from app.models.supplier import Supplier
from app.utils.errors import AppError


def list_suppliers(*, active_only=False, search=None):
    q = Supplier.query
    if active_only:
        q = q.filter_by(active=True)
    if search:
        q = q.filter(Supplier.name.ilike(f"%{search}%"))
    return q.order_by(Supplier.name).all()


def get_supplier(supplier_id):
    s = Supplier.query.get(supplier_id)
    if not s:
        raise AppError("Supplier not found", "NOT_FOUND", 404)
    return s


def _parse_lead_days(raw):
    if raw is None or raw == "":
        return None
    try:
        days = int(raw)
    except (TypeError, ValueError) as exc:
        raise AppError(
            "typicalLeadTimeDays must be an integer", "VALIDATION_ERROR", 400
        ) from exc
    if days < 0:
        raise AppError(
            "typicalLeadTimeDays cannot be negative", "VALIDATION_ERROR", 400
        )
    return days


def _apply_fields(supplier: Supplier, data: dict, *, creating: bool):
    if "name" in data or creating:
        name = (data.get("name") or "").strip()
        if not name:
            raise AppError("Name is required", "VALIDATION_ERROR", 400)
        supplier.name = name
    if "contactPerson" in data or "contact_person" in data:
        supplier.contact_person = (
            data.get("contactPerson") or data.get("contact_person") or None
        ) or None
        if supplier.contact_person:
            supplier.contact_person = str(supplier.contact_person).strip() or None
    if "phone" in data:
        supplier.phone = (data.get("phone") or "").strip() or None
    if "email" in data:
        supplier.email = (data.get("email") or "").strip() or None
    if "address" in data:
        supplier.address = (data.get("address") or "").strip() or None
    if "typicalLeadTimeDays" in data or "typical_lead_time_days" in data:
        supplier.typical_lead_time_days = _parse_lead_days(
            data.get("typicalLeadTimeDays", data.get("typical_lead_time_days"))
        )
    if "notes" in data:
        supplier.notes = (data.get("notes") or "").strip() or None
    if "active" in data:
        supplier.active = bool(data.get("active"))
    if supplier.typical_lead_time_days is None:
        raise AppError(
            "Typical lead time (days) is required", "VALIDATION_ERROR", 400
        )


def create_supplier(data):
    s = Supplier(active=True, is_seed=False)
    _apply_fields(s, data, creating=True)
    if "active" in data:
        s.active = bool(data.get("active"))
    db.session.add(s)
    db.session.commit()
    return s


def update_supplier(supplier_id, data):
    s = get_supplier(supplier_id)
    try:
        _apply_fields(s, data, creating=False)
    except AppError:
        db.session.rollback()
        raise
    db.session.commit()
    return s
