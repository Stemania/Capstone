"""Material catalog: common raw materials suggested on order lines."""

from __future__ import annotations

from sqlalchemy import String, cast, func

from app.extensions import db
from app.models.material_catalog import MATERIAL_UNITS, MaterialCatalogItem
from app.utils.errors import AppError


def list_items(*, search=None, include_inactive=False):
    q = MaterialCatalogItem.query
    if not include_inactive:
        q = q.filter(MaterialCatalogItem.active.is_(True))
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(
            MaterialCatalogItem.name.ilike(like)
            | MaterialCatalogItem.shop_term.ilike(like)
            | MaterialCatalogItem.category.ilike(like)
            | cast(MaterialCatalogItem.grades, String).ilike(like)
        )
    return q.order_by(func.lower(MaterialCatalogItem.name)).all()


def get_item(item_id):
    item = db.session.get(MaterialCatalogItem, item_id)
    if not item:
        raise AppError("Material not found", "NOT_FOUND", 404)
    return item


def _clean(value):
    return (str(value).strip() if value is not None else "") or None


def _apply(item: MaterialCatalogItem, data: dict, *, creating: bool):
    if "name" in data or creating:
        name = _clean(data.get("name"))
        if not name:
            raise AppError("Name is required", "VALIDATION_ERROR", 400)
        taken = MaterialCatalogItem.query.filter(
            func.lower(MaterialCatalogItem.name) == name.lower(),
            MaterialCatalogItem.id != item.id,
        ).first()
        if taken:
            raise AppError(f"{name} is already in the catalog", "CONFLICT", 409)
        item.name = name
    if "shopTerm" in data:
        item.shop_term = _clean(data.get("shopTerm"))
    if "category" in data:
        item.category = _clean(data.get("category"))
    if "defaultUnit" in data or creating:
        unit = _clean(data.get("defaultUnit")) or "pcs"
        if unit not in MATERIAL_UNITS:
            raise AppError(
                f"Unit must be one of {', '.join(MATERIAL_UNITS)}", "VALIDATION_ERROR", 400
            )
        item.default_unit = unit
    if "grades" in data:
        raw = data.get("grades") or []
        if not isinstance(raw, list):
            raise AppError("grades must be a list", "VALIDATION_ERROR", 400)
        grades, seen = [], set()
        for g in raw:
            g = _clean(g)
            if g and g.lower() not in seen:
                seen.add(g.lower())
                grades.append(g)
        item.grades = grades
    if "active" in data:
        item.active = bool(data.get("active"))


def create_item(data):
    item = MaterialCatalogItem(active=True, grades=[])
    _apply(item, data, creating=True)
    db.session.add(item)
    db.session.commit()
    return item


def update_item(item_id, data):
    item = get_item(item_id)
    try:
        _apply(item, data, creating=False)
    except AppError:
        db.session.rollback()
        raise
    db.session.commit()
    return item
