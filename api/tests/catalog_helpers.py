"""Shared test helpers for catalog-based PO lines."""

from sqlalchemy import func

from app.extensions import db
from app.models.material_catalog import MaterialCatalogItem


def ensure_material(name, unit="pcs", *, active=True):
    """The catalog material a PO line must reference (created when missing)."""
    item = MaterialCatalogItem.query.filter(
        func.lower(MaterialCatalogItem.name) == name.lower()
    ).first()
    if item is None:
        item = MaterialCatalogItem(name=name, default_unit=unit, grades=[], active=active)
        db.session.add(item)
        db.session.commit()
    return item.id
