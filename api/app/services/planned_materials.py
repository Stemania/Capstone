"""Planned materials: what a job needs, listed by Office Staff when encoding it.

Each line is a catalog material with an optional grade and size, a quantity,
and a unit. Supplier order lines point back at a planned line through
``planned_material_id``, so the job shows what is still to order. A planned
line that already has order lines cannot be removed, cannot change material,
and cannot drop below what has been ordered (draft or issued).
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from app.extensions import db
from app.utils.errors import AppError

MAX_PLANNED_MATERIALS = 30
_TEXT_LIMIT = 255


def _bad(message: str):
    return AppError(message, "VALIDATION_ERROR", 400)


def _ordered_by_planned_id(job) -> dict[str, Decimal]:
    """Quantity on draft or issued order lines per planned line (cancelled lines excluded)."""
    out: dict[str, Decimal] = {}
    for p in (job.material_purchases or []) if job is not None else []:
        if not p.planned_material_id or p.cancelled_at is not None:
            continue
        out[p.planned_material_id] = out.get(p.planned_material_id, Decimal("0")) + Decimal(
            str(p.quantity or 0)
        )
    return out


def _fmt(qty: Decimal) -> str:
    return f"{qty.normalize():f}"


def parse_planned_materials(items, job=None) -> list[dict]:
    """Validate a planned-materials list from the job order form.

    ``job`` is the job being edited (None when creating). Returns the list to
    store in ``job.raw_materials``; new lines get their id from the model.
    """
    from app.models.material_catalog import MaterialCatalogItem
    from app.services.material_purchase_service import check_material_unit

    if items is None:
        return []
    if not isinstance(items, list):
        raise _bad("Materials needed must be a list.")
    if len(items) > MAX_PLANNED_MATERIALS:
        raise _bad(f"List at most {MAX_PLANNED_MATERIALS} materials.")

    existing = {
        m.get("id"): m
        for m in ((job.raw_materials if job is not None else None) or [])
        if isinstance(m, dict) and m.get("id")
    }
    ordered = _ordered_by_planned_id(job)

    out: list[dict] = []
    kept_ids: set[str] = set()
    for i, raw in enumerate(items, start=1):
        if not isinstance(raw, dict):
            raise _bad(f"Material {i} is not valid.")
        line_id = raw.get("id") if raw.get("id") in existing else None
        before = existing.get(line_id) if line_id else None

        catalog_id = raw.get("materialCatalogId")
        item = db.session.get(MaterialCatalogItem, catalog_id) if catalog_id else None
        # A line kept from before may point at a material since retired from the catalog.
        keeps_material = before is not None and before.get("materialCatalogId") == catalog_id
        if item is None or (not item.active and not keeps_material):
            raise _bad(f"Pick material {i} from the catalog.")

        try:
            qty = Decimal(str(raw.get("quantity")))
        except (InvalidOperation, TypeError, ValueError):
            raise _bad(f"Enter a quantity for {item.name}.")
        if not qty.is_finite() or qty <= 0:
            raise _bad(f"Enter a quantity for {item.name}.")

        unit = (raw.get("unit") or "").strip() or item.default_unit or "pcs"
        check_material_unit(unit)

        grade = (raw.get("gradeOrSpec") or "").strip() or None
        size = (raw.get("sizeSpec") or "").strip() or None
        if (grade and len(grade) > _TEXT_LIMIT) or (size and len(size) > _TEXT_LIMIT):
            raise _bad(f"The grade or size of {item.name} is too long.")

        on_order = ordered.get(line_id, Decimal("0")) if line_id else Decimal("0")
        if on_order > 0:
            if not keeps_material:
                raise AppError(
                    f"{before.get('name')} is already on a supplier order, so its material "
                    "can't be changed.",
                    "PLANNED_MATERIAL_ORDERED",
                    409,
                )
            if qty < on_order:
                raise AppError(
                    f"{item.name} already has {_fmt(on_order)} {unit} on order; the planned "
                    "quantity can't be lower than that.",
                    "PLANNED_MATERIAL_ORDERED",
                    409,
                )

        line = {
            "materialCatalogId": item.id,
            "name": item.name,
            "gradeOrSpec": grade,
            "sizeSpec": size,
            "quantity": float(qty),
            "unit": unit,
        }
        if line_id:
            line["id"] = line_id
            kept_ids.add(line_id)
        out.append(line)

    for planned_id, qty in ordered.items():
        if planned_id in existing and planned_id not in kept_ids and qty > 0:
            raise AppError(
                f"{existing[planned_id].get('name')} is already on a supplier order, so it "
                "can't be removed from the materials needed.",
                "PLANNED_MATERIAL_ORDERED",
                409,
            )
    return out


def require_planned_line(job, planned_id):
    """The planned line an order line is for; None when the order line isn't tied to one."""
    if not planned_id:
        return None
    for m in job.raw_materials or []:
        if isinstance(m, dict) and m.get("id") == planned_id:
            return m
    raise _bad("That planned material is not on this job.")
