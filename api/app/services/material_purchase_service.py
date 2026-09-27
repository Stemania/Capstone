"""Material purchase lines on job orders."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.extensions import db
from app.models.job_order import JobOrder, MaterialStatus
from app.models.material_purchase import MaterialPurchase
from app.models.supplier import Supplier
from app.utils.errors import AppError


def _parse_date(value):
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as exc:
        raise AppError("Invalid date (YYYY-MM-DD)", "VALIDATION_ERROR", 400) from exc


def _parse_decimal(value, field):
    if value is None or value == "":
        raise AppError(f"{field} is required", "VALIDATION_ERROR", 400)
    try:
        d = Decimal(str(value))
    except Exception as exc:
        raise AppError(f"{field} must be a number", "VALIDATION_ERROR", 400) from exc
    if d < 0:
        raise AppError(f"{field} cannot be negative", "VALIDATION_ERROR", 400)
    return d


def list_purchases_for_job(job_order_id):
    return (
        MaterialPurchase.query.filter_by(job_order_id=job_order_id)
        .order_by(MaterialPurchase.date_ordered.asc(), MaterialPurchase.created_at.asc())
        .all()
    )


def list_purchases(
    *,
    from_s=None,
    to_s=None,
    supplier_id=None,
    material=None,
    status=None,
):
    """
    Cross-job purchase lines for inventory view.
    Date filter applies to date_ordered. status: ORDERED | RECEIVED | CONSUMED
    (RECEIVED = on hand: delivered, job not started yet).
    Summary covers every status so the On order / On hand / Consumed cards stay
    visible while the table is filtered.
    """
    from sqlalchemy.orm import joinedload

    status_s = (status or "").strip().upper()
    if status_s and status_s not in PURCHASE_STATUSES:
        raise AppError(
            "status must be ORDERED, RECEIVED, or CONSUMED", "VALIDATION_ERROR", 400
        )

    q = MaterialPurchase.query.options(
        joinedload(MaterialPurchase.supplier),
        joinedload(MaterialPurchase.job_order),
    )
    d0 = _parse_date(from_s)
    d1 = _parse_date(to_s)
    if d0:
        q = q.filter(MaterialPurchase.date_ordered >= d0)
    if d1:
        q = q.filter(MaterialPurchase.date_ordered <= d1)
    if supplier_id:
        q = q.filter(MaterialPurchase.supplier_id == supplier_id)
    if material:
        q = q.filter(MaterialPurchase.material_name.ilike(f"%{material.strip()}%"))

    rows = q.order_by(
        MaterialPurchase.date_ordered.desc(),
        MaterialPurchase.created_at.desc(),
    ).all()

    buckets = {s: _empty_bucket() for s in PURCHASE_STATUSES}
    for r in rows:
        _add_to_bucket(buckets[r.status], r)

    items = [r for r in rows if not status_s or r.status == status_s]
    total_spend = sum((r.line_total for r in rows), Decimal("0"))
    return {
        "items": [r.to_dict() for r in items],
        "summary": {
            "purchaseCount": len(rows),
            "totalSpend": float(total_spend),
            "awaitingDeliveryCount": buckets["ORDERED"]["count"],
            "onOrder": _bucket_out(buckets["ORDERED"]),
            "onHand": _bucket_out(buckets["RECEIVED"]),
            "consumed": _bucket_out(buckets["CONSUMED"]),
        },
    }


PURCHASE_STATUSES = ("ORDERED", "RECEIVED", "CONSUMED")


def _empty_bucket():
    return {"count": 0, "value": Decimal("0"), "byUnit": {}}


def _add_to_bucket(bucket, row: MaterialPurchase):
    bucket["count"] += 1
    bucket["value"] += row.line_total
    unit = row.unit or "pcs"
    bucket["byUnit"][unit] = bucket["byUnit"].get(unit, Decimal("0")) + Decimal(
        str(row.quantity or 0)
    )


def _bucket_out(bucket):
    return {
        "count": bucket["count"],
        "value": float(bucket["value"]),
        "quantityByUnit": [
            {"unit": u, "quantity": float(q)}
            for u, q in sorted(bucket["byUnit"].items())
        ],
    }


def outstanding_lines(job: JobOrder) -> list[MaterialPurchase]:
    """Purchase lines still ORDERED (not delivered)."""
    return [p for p in (job.material_purchases or []) if p.date_received is None]


def job_has_started(job: JobOrder) -> bool:
    return any(op.actual_start for op in (job.operations or []))


def consume_received_lines(job: JobOrder, when) -> int:
    """Mark every RECEIVED line consumed (job's first operation started)."""
    n = 0
    for p in job.material_purchases or []:
        if p.date_received is not None and p.consumed_at is None:
            p.consumed_at = when
            n += 1
    return n


def _consume_if_job_started(purchase: MaterialPurchase):
    """A line delivered after the job already started goes straight to CONSUMED."""
    from datetime import datetime, timezone

    if (
        purchase.date_received is not None
        and purchase.consumed_at is None
        and purchase.job_order is not None
        and job_has_started(purchase.job_order)
    ):
        purchase.consumed_at = datetime.now(timezone.utc)


def sync_job_material_from_purchases(job: JobOrder):
    """
    Derive job material_status from purchase lines.
    - Any purchases → at least ORDERED (unless already RECEIVED / NOT_REQUIRED)
    - All lines have date_received → RECEIVED + material_received_date = max(received)
    """
    lines = list(job.material_purchases or [])
    if not lines:
        return

    if job.material_status == MaterialStatus.NOT_REQUIRED:
        return

    all_received = all(p.date_received is not None for p in lines)
    if all_received:
        job.material_status = MaterialStatus.RECEIVED
        job.material_received_date = max(p.date_received for p in lines)
        return

    if job.material_status in (MaterialStatus.TO_ORDER, MaterialStatus.RECEIVED):
        # Partially received or newly ordered: stay / move to ORDERED
        job.material_status = MaterialStatus.ORDERED
        if not any(p.date_received for p in lines):
            # clear received date if nothing arrived yet but we had been RECEIVED
            pass


def create_purchase(job: JobOrder, data: dict) -> MaterialPurchase:
    name = (data.get("materialName") or data.get("material_name") or "").strip()
    if not name:
        raise AppError("materialName is required", "VALIDATION_ERROR", 400)

    supplier_id = data.get("supplierId") or data.get("supplier_id")
    if not supplier_id:
        raise AppError("supplierId is required", "VALIDATION_ERROR", 400)
    supplier = Supplier.query.get(supplier_id)
    if not supplier:
        raise AppError("Supplier not found", "NOT_FOUND", 404)
    if not supplier.active:
        raise AppError("Supplier is inactive", "VALIDATION_ERROR", 400)

    date_ordered = _parse_date(data.get("dateOrdered") or data.get("date_ordered"))
    if not date_ordered:
        raise AppError("dateOrdered is required", "VALIDATION_ERROR", 400)
    date_received = _parse_date(data.get("dateReceived") or data.get("date_received"))
    if date_received and date_received < date_ordered:
        raise AppError(
            "dateReceived cannot be before dateOrdered", "VALIDATION_ERROR", 400
        )

    qty = _parse_decimal(data.get("quantity"), "quantity")
    if qty <= 0:
        raise AppError("quantity must be greater than zero", "VALIDATION_ERROR", 400)
    unit_cost = _parse_decimal(
        data.get("unitCost") if data.get("unitCost") is not None else data.get("unit_cost", 0),
        "unitCost",
    )
    unit = (data.get("unit") or "pcs").strip() or "pcs"
    grade = (
        data.get("gradeOrSpec") or data.get("grade_or_spec") or ""
    ).strip() or None

    # Default job supplier from first purchase if unset
    if not job.supplier_id:
        job.supplier_id = supplier.id

    purchase = MaterialPurchase(
        job_order_id=job.id,
        material_name=name,
        grade_or_spec=grade,
        quantity=qty,
        unit=unit,
        unit_cost=unit_cost,
        supplier_id=supplier.id,
        date_ordered=date_ordered,
        date_received=date_received,
    )
    db.session.add(purchase)
    db.session.flush()
    _consume_if_job_started(purchase)
    sync_job_material_from_purchases(job)
    db.session.commit()
    return purchase


def update_purchase(purchase: MaterialPurchase, data: dict) -> MaterialPurchase:
    job = purchase.job_order
    if "materialName" in data or "material_name" in data:
        name = (data.get("materialName") or data.get("material_name") or "").strip()
        if not name:
            raise AppError("materialName is required", "VALIDATION_ERROR", 400)
        purchase.material_name = name
    if "gradeOrSpec" in data or "grade_or_spec" in data:
        purchase.grade_or_spec = (
            data.get("gradeOrSpec") or data.get("grade_or_spec") or ""
        ).strip() or None
    if "quantity" in data:
        qty = _parse_decimal(data.get("quantity"), "quantity")
        if qty <= 0:
            raise AppError("quantity must be greater than zero", "VALIDATION_ERROR", 400)
        purchase.quantity = qty
    if "unit" in data:
        purchase.unit = (data.get("unit") or "pcs").strip() or "pcs"
    if "unitCost" in data or "unit_cost" in data:
        purchase.unit_cost = _parse_decimal(
            data.get("unitCost", data.get("unit_cost")), "unitCost"
        )
    if "supplierId" in data or "supplier_id" in data:
        sid = data.get("supplierId") or data.get("supplier_id")
        supplier = Supplier.query.get(sid)
        if not supplier:
            raise AppError("Supplier not found", "NOT_FOUND", 404)
        purchase.supplier_id = supplier.id
    if "dateOrdered" in data or "date_ordered" in data:
        d = _parse_date(data.get("dateOrdered") or data.get("date_ordered"))
        if not d:
            raise AppError("dateOrdered is required", "VALIDATION_ERROR", 400)
        purchase.date_ordered = d
    if "dateReceived" in data or "date_received" in data:
        new_received = _parse_date(
            data.get("dateReceived") if "dateReceived" in data else data.get("date_received")
        )
        if new_received is None and purchase.consumed_at is not None:
            raise AppError(
                "This material was already consumed when the job started; "
                "its received date cannot be cleared.",
                "VALIDATION_ERROR",
                400,
            )
        purchase.date_received = new_received
    if purchase.date_received and purchase.date_ordered:
        if purchase.date_received < purchase.date_ordered:
            raise AppError(
                "dateReceived cannot be before dateOrdered", "VALIDATION_ERROR", 400
            )

    _consume_if_job_started(purchase)
    sync_job_material_from_purchases(job)
    db.session.commit()
    return purchase


def _check_receive_date(purchase: MaterialPurchase, when: date):
    if when < purchase.date_ordered:
        raise AppError(
            f"Date received cannot be before the order date of "
            f"{purchase.material_name} ({purchase.date_ordered.isoformat()})",
            "VALIDATION_ERROR",
            400,
        )


def _receive_line(purchase: MaterialPurchase, when: date):
    purchase.date_received = when
    _consume_if_job_started(purchase)


def mark_purchase_received(purchase: MaterialPurchase, received_date=None):
    when = _parse_date(received_date) or date.today()
    _check_receive_date(purchase, when)
    _receive_line(purchase, when)
    sync_job_material_from_purchases(purchase.job_order)
    db.session.commit()
    return purchase


def receive_all_outstanding(job: JobOrder, received_date=None) -> int:
    """Job-level "Material received": receive every outstanding purchase line."""
    if not job.material_purchases:
        raise AppError("Record the purchase first.", "NO_PURCHASE_LINES", 409)
    when = _parse_date(received_date) or date.today()
    outstanding = outstanding_lines(job)
    for p in outstanding:
        _check_receive_date(p, when)
    for p in outstanding:
        _receive_line(p, when)
    sync_job_material_from_purchases(job)
    db.session.commit()
    return len(outstanding)


def delete_purchase(purchase: MaterialPurchase):
    job = purchase.job_order
    db.session.delete(purchase)
    db.session.flush()
    # Refresh relationship
    db.session.refresh(job)
    lines = list(job.material_purchases or [])
    if lines:
        sync_job_material_from_purchases(job)
    db.session.commit()
