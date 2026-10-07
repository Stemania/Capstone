"""Material purchase lines on job orders."""

from __future__ import annotations

from datetime import date, timedelta
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
    if status_s and status_s not in PURCHASE_STATUSES + ("OVERDUE",):
        raise AppError(
            "status must be ORDERED, RECEIVED, CONSUMED or OVERDUE", "VALIDATION_ERROR", 400
        )

    # Job materials only: consumable restock is stock on the consumables list.
    q = MaterialPurchase.query.options(
        joinedload(MaterialPurchase.supplier),
        joinedload(MaterialPurchase.job_order),
        joinedload(MaterialPurchase.supplier_order),
    ).filter(MaterialPurchase.job_order_id.isnot(None))
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

    # Inventory shows material placed with a supplier: no draft or cancelled lines.
    rows = [
        r
        for r in q.order_by(
            MaterialPurchase.date_ordered.desc(),
            MaterialPurchase.created_at.desc(),
        ).all()
        if r.counts_as_ordered
    ]

    buckets = {s: _empty_bucket() for s in PURCHASE_STATUSES}
    for r in rows:
        _add_to_bucket(buckets[r.status], r)

    if status_s == "OVERDUE":
        items = [r for r in rows if r.days_overdue() > 0]
    else:
        items = [r for r in rows if not status_s or r.status == status_s]
    total_spend = sum((r.line_total for r in rows), Decimal("0"))
    return {
        "items": [r.to_dict() for r in items],
        "summary": {
            "purchaseCount": len(rows),
            "overdueCount": sum(1 for r in rows if r.days_overdue() > 0),
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


def placed_lines(job: JobOrder) -> list[MaterialPurchase]:
    """Lines placed with a supplier: not cancelled and not on a draft PO."""
    return [p for p in (job.material_purchases or []) if p.counts_as_ordered]


def outstanding_lines(job: JobOrder) -> list[MaterialPurchase]:
    """Placed purchase lines still ORDERED (not delivered)."""
    return [p for p in placed_lines(job) if p.date_received is None]


def needing_planned_materials(raw_materials) -> list[dict]:
    """Planned materials the shop has to buy: everything not marked From stock."""
    return [
        m
        for m in (raw_materials or [])
        if isinstance(m, dict) and m.get("id") and not m.get("fromStock")
    ]


def _planned_coverage(job: JobOrder) -> list[tuple[dict, bool, bool]]:
    """(planned material, fully ordered, fully received) for each material to buy.

    Only placed lines linked to that planned material count toward it.
    """
    placed = placed_lines(job)
    rows = []
    for m in needing_planned_materials(job.raw_materials):
        linked = [p for p in placed if p.planned_material_id == m["id"]]
        ordered_qty = sum((Decimal(str(p.quantity or 0)) for p in linked), Decimal("0"))
        planned_qty = m.get("quantity")
        ordered = bool(linked) and (
            planned_qty is None or ordered_qty >= Decimal(str(planned_qty))
        )
        received = ordered and all(p.date_received is not None for p in linked)
        rows.append((m, ordered, received))
    return rows


def unordered_planned_materials(job: JobOrder) -> list[str]:
    """Names of planned materials not yet fully on a placed order."""
    return [m.get("name") or "Material" for m, ordered, _ in _planned_coverage(job) if not ordered]


def unreceived_planned_materials(job: JobOrder) -> list[str]:
    """Names of planned materials ordered but not fully received."""
    return [
        m.get("name") or "Material"
        for m, ordered, received in _planned_coverage(job)
        if ordered and not received
    ]


def line_expected_arrival(p: MaterialPurchase, today: date | None = None) -> dict:
    """A received line arrives on its received date; a PO line on its order's
    expected delivery date; a line recorded without a PO on date ordered plus
    the supplier's stated lead time. Otherwise the arrival is unknown (None).

    A line still awaited after that date is overdue: it is still pending and
    is expected tomorrow at the earliest."""
    from app.services.schedule_calendar import shop_now

    today = today or shop_now().date()
    lead = p.supplier.typical_lead_time_days if p.supplier else None
    order_expected = p.supplier_order.expected_delivery_date if p.supplier_order else None
    days_overdue = 0
    if p.date_received is not None:
        arrival, basis = p.date_received, "RECEIVED"
    elif order_expected is not None:
        arrival, basis = order_expected, "LEAD_TIME"
    elif lead is not None and p.date_ordered is not None:
        arrival, basis = p.date_ordered + timedelta(days=lead), "LEAD_TIME"
    else:
        arrival, basis = None, "UNKNOWN"
    if basis == "LEAD_TIME" and arrival < today:
        days_overdue = (today - arrival).days
        arrival = today + timedelta(days=1)
    return {
        "purchaseId": p.id,
        "materialName": p.material_name,
        "gradeOrSpec": p.grade_or_spec,
        "supplierName": p.supplier.name if p.supplier else None,
        "poNumber": p.supplier_order.po_number if p.supplier_order else None,
        "dateOrdered": p.date_ordered.isoformat() if p.date_ordered else None,
        "leadTimeDays": lead,
        "dateReceived": p.date_received.isoformat() if p.date_received else None,
        "expectedArrival": arrival.isoformat() if arrival else None,
        "basis": basis,
        "fromOrderDeliveryDate": basis == "LEAD_TIME" and order_expected is not None,
        "daysOverdue": days_overdue,
    }


def derived_material_expected(job: JobOrder) -> dict | None:
    """Job's material-ready date from its purchase lines: the latest line arrival.

    None when material is not required or no purchase is recorded yet. When any
    line's arrival is unknown the job's date is unknown too (expectedDate None)
    and ``missingLeadTimeSuppliers`` names the suppliers to fix.
    """
    if job.material_status == MaterialStatus.NOT_REQUIRED:
        return None
    lines = placed_lines(job)
    if not lines:
        return None
    rows = [line_expected_arrival(p) for p in lines]
    unknown = [r for r in rows if r["expectedArrival"] is None]
    missing = sorted({r["supplierName"] or "Unnamed supplier" for r in unknown})
    latest = None if unknown else max(rows, key=lambda r: r["expectedArrival"])
    return {
        "expectedDate": latest["expectedArrival"] if latest else None,
        "allReceived": all(r["basis"] == "RECEIVED" for r in rows),
        "limitingLine": latest,
        "missingLeadTimeSuppliers": missing,
        "lines": rows,
    }


def has_unordered_materials(job: JobOrder) -> bool:
    """True while some material the job needs is not on a placed order."""
    if job.material_status == MaterialStatus.NOT_REQUIRED:
        return False
    return bool(unordered_planned_materials(job)) or (
        job.material_status == MaterialStatus.TO_ORDER and not placed_lines(job)
    )


def lead_time_floor(today: date | None = None) -> tuple[date | None, int | None]:
    """(today + longest stated lead time among active suppliers, that lead time).

    (None, None) when no active supplier states a lead time.
    """
    from app.services.schedule_calendar import shop_now

    lead = (
        db.session.query(db.func.max(Supplier.typical_lead_time_days))
        .filter(Supplier.active.is_(True))
        .scalar()
    )
    if lead is None:
        return None, None
    today = today or shop_now().date()
    return today + timedelta(days=int(lead)), int(lead)


def lead_time_floor_reason(floor: date, lead: int) -> str:
    return (
        f"materials not ordered yet — earliest {floor.isoformat()} "
        f"(today + {lead} day longest supplier lead time)"
    )


def scheduling_material_floor(job: JobOrder) -> tuple[date | None, str | None]:
    """Earliest date the first operation may start, as far as materials go.

    The later of the placed lines' arrival and, while anything is still
    unordered, today plus the longest active supplier lead time.
    """
    ready, reason = material_readiness_date(job)
    if not has_unordered_materials(job):
        return ready, reason
    floor, lead = lead_time_floor()
    if floor is None or (ready is not None and ready >= floor):
        return ready, reason
    return floor, lead_time_floor_reason(floor, lead)


def assert_material_date_known(job: JobOrder) -> None:
    """Refuse to schedule while a line's arrival cannot be worked out."""
    derived = derived_material_expected(job)
    if derived and derived["missingLeadTimeSuppliers"]:
        names = ", ".join(derived["missingLeadTimeSuppliers"])
        raise AppError(
            f"Material arrival is unknown: {names} has no lead time. Set the "
            "supplier's lead time, or an expected delivery date on the supplier "
            "order, before proposing a schedule.",
            "MATERIAL_DATE_UNKNOWN",
            400,
        )


def job_supplier_orders(job: JobOrder) -> list[dict]:
    """The job's supplier orders (drafts included, cancelled lines excluded),
    plus one entry per supplier for lines recorded without a PO."""
    groups: dict = {}
    for p in job.material_purchases or []:
        if p.cancelled_at is not None:
            continue
        order = p.supplier_order
        key = ("order", order.id) if order else ("no_po", p.supplier_id)
        g = groups.get(key)
        if g is None:
            supplier = order.supplier if order else p.supplier
            g = groups[key] = {
                "supplierOrderId": order.id if order else None,
                "poNumber": order.po_number if order else None,
                "supplierName": supplier.name if supplier else None,
                "status": order.status.value if order else None,
                "expectedDeliveryDate": (
                    order.expected_delivery_date.isoformat()
                    if order and order.expected_delivery_date
                    else None
                ),
                "lineCount": 0,
                "daysOverdue": 0,
            }
        g["lineCount"] += 1
        g["daysOverdue"] = max(g["daysOverdue"], p.days_overdue())
    return list(groups.values())


def material_readiness_date(job: JobOrder) -> tuple[date | None, str | None]:
    """(date, reason) the scheduler should wait for, or (None, None).

    Worked out from the placed purchase lines only. Returns (None, reason) when
    a line's arrival is unknown.
    """
    if job.material_status == MaterialStatus.NOT_REQUIRED:
        return None, None
    derived = derived_material_expected(job)
    if derived:
        if derived["expectedDate"] is None:
            names = ", ".join(derived["missingLeadTimeSuppliers"])
            return None, f"material arrival unknown — {names} has no lead time"
        d = date.fromisoformat(derived["expectedDate"])
        line = derived["limitingLine"]
        if derived["allReceived"]:
            return d, f"material received {d.isoformat()}"
        name = line["materialName"]
        supplier = line["supplierName"] or "supplier"
        if line["basis"] == "RECEIVED":
            detail = f"{name} received {line['dateReceived']}"
        elif line.get("daysOverdue"):
            days = line["daysOverdue"]
            source = line["poNumber"] or f"ordered {line['dateOrdered']}"
            detail = (
                f"{name} from {supplier}, {source} overdue by {days} day"
                f"{'' if days == 1 else 's'}; expected tomorrow at the earliest"
            )
        elif line["fromOrderDeliveryDate"]:
            detail = f"{name} from {supplier}, {line['poNumber']} expected delivery"
        else:
            detail = (
                f"{name} from {supplier}, ordered {line['dateOrdered']} "
                f"+ {line['leadTimeDays']} day lead time"
            )
        return d, f"material expected {d.isoformat()} — {detail}"
    if job.material_received_date:
        return job.material_received_date, (
            f"material received {job.material_received_date.isoformat()}"
        )
    return None, None


def job_has_started(job: JobOrder) -> bool:
    return any(op.actual_start for op in (job.operations or []))


def material_start_block(job: JobOrder, *, for_worker: bool = False) -> dict | None:
    """Why the job's first operation cannot start yet for materials, or None.

    Unless material is NOT_REQUIRED, every planned material (other than From
    stock) must be fully ordered and received, and every placed line must have
    arrived, whatever the job-level status says. Returns {"code", "message"}.
    """
    if job.material_status == MaterialStatus.NOT_REQUIRED:
        return None

    unordered = unordered_planned_materials(job)
    if unordered:
        if for_worker:
            message = (
                "The materials for this job have not all been ordered yet. "
                "Please check with the office."
            )
        else:
            message = (
                f"Not all planned materials are ordered for job {job.job_number}: "
                f"{', '.join(unordered)}. Order them on an issued supplier order, or "
                "mark them From stock if the shop already has them."
            )
        return {"code": "MATERIALS_NOT_ORDERED", "message": message}
    unreceived = unreceived_planned_materials(job)
    if unreceived:
        if for_worker:
            message = (
                "The materials for this job have not all arrived yet. "
                "Please wait for the office to receive them before starting."
            )
        else:
            message = (
                f"Planned materials not yet received: {', '.join(unreceived)}. "
                "Mark them received before starting the first operation."
            )
        return {"code": "MATERIALS_NOT_RECEIVED", "message": message}

    outstanding = outstanding_lines(job)
    if not outstanding:
        if placed_lines(job):
            return None
        if for_worker:
            message = (
                "The materials for this job have not been ordered yet. "
                "Please check with the office."
            )
        else:
            message = (
                f"No material has been ordered for job {job.job_number} "
                f"({job.title}). Order it on an issued supplier order, or set "
                "material to Not required if the shop already has it."
            )
        return {"code": "MATERIALS_NOT_ORDERED", "message": message}
    if for_worker:
        message = (
            "The materials for this job have not arrived yet. "
            "Please wait for the office to receive them before starting."
        )
    else:
        names = ", ".join(
            f"{p.material_name}{f' ({p.grade_or_spec})' if p.grade_or_spec else ''}"
            for p in outstanding
        )
        message = (
            f"Materials not yet received for this job: {names}. "
            "Mark them received before starting the first operation."
        )
    return {"code": "MATERIALS_NOT_RECEIVED", "message": message}


def material_wait(job: JobOrder, *, for_worker: bool = False) -> dict | None:
    """"Waiting for materials": a released job that has not started and whose
    first operation the start gate would refuse. {"code", "message"} or None."""
    from app.models.job_order import JobOrderStatus

    if job.status in (
        JobOrderStatus.DRAFT,
        JobOrderStatus.COMPLETED,
        JobOrderStatus.DELIVERED,
    ):
        return None
    if job_has_started(job):
        return None
    return material_start_block(job, for_worker=for_worker)


def material_wait_fields(job: JobOrder, *, for_worker: bool = False) -> dict:
    wait = material_wait(job, for_worker=for_worker)
    return {
        "waitingForMaterials": wait is not None,
        "materialWaitCode": wait["code"] if wait else None,
        "materialWaitReason": wait["message"] if wait else None,
    }


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


def apply_planned_materials_rule(job: JobOrder, previous_raw_materials) -> None:
    """Re-derive material status after the planned list changed.

    Materials to buy make the job To order; none make it Not required. A job
    the Admin marked Not required while it still had materials to buy keeps
    that choice.
    """
    admin_override = (
        job.material_status == MaterialStatus.NOT_REQUIRED
        and bool(needing_planned_materials(previous_raw_materials))
    )
    if admin_override:
        return
    if not needing_planned_materials(job.raw_materials) and not placed_lines(job):
        job.material_status = MaterialStatus.NOT_REQUIRED
        job.material_received_date = None
        return
    job.material_status = MaterialStatus.TO_ORDER
    sync_job_material_from_purchases(job)


def sync_job_material_from_purchases(job: JobOrder):
    """
    Derive job material_status from purchase lines.
    - Any purchases → at least ORDERED (unless already RECEIVED / NOT_REQUIRED)
    - All lines have date_received → RECEIVED + material_received_date = max(received)
    - No placed lines left (all cancelled / still on a draft PO) → back to TO_ORDER
    - Any planned material not fully on a placed order → TO_ORDER
    Only placed lines count (see ``placed_lines``).
    """
    if job.material_status == MaterialStatus.NOT_REQUIRED:
        return

    lines = placed_lines(job)
    if unordered_planned_materials(job):
        job.material_status = MaterialStatus.TO_ORDER
        job.material_received_date = None
        return
    if not lines:
        if job.material_status in (MaterialStatus.ORDERED, MaterialStatus.RECEIVED):
            job.material_status = MaterialStatus.TO_ORDER
            job.material_received_date = None
        return

    all_received = all(p.date_received is not None for p in lines)
    if all_received:
        job.material_status = MaterialStatus.RECEIVED
        job.material_received_date = max(p.date_received for p in lines)
        return

    if job.material_status in (MaterialStatus.TO_ORDER, MaterialStatus.RECEIVED):
        # Partially received or newly ordered: stay / move to ORDERED
        job.material_status = MaterialStatus.ORDERED
        job.material_received_date = None


def _planned_material(job: JobOrder, planned_id):
    """The job's planned-material entry for ``planned_id``; None for Other material."""
    if not planned_id:
        return None
    for item in job.raw_materials or []:
        if isinstance(item, dict) and item.get("id") == planned_id:
            if item.get("fromStock"):
                raise AppError(
                    f"{item.get('name') or 'This material'} is marked From stock, "
                    "so it is not bought for this job.",
                    "PLANNED_MATERIAL_FROM_STOCK",
                    400,
                )
            return item
    raise AppError(
        "Planned material not found on this job", "VALIDATION_ERROR", 400
    )


def _check_planned_unit(planned, unit):
    if planned and planned.get("unit") and unit != planned["unit"]:
        raise AppError(
            f"Unit must be {planned['unit']} to match the planned material",
            "VALIDATION_ERROR",
            400,
        )


def build_draft_line(job: JobOrder, supplier: Supplier, data: dict) -> MaterialPurchase:
    """Validate one line for a draft supplier order (not added to the session).

    Only the job's planned materials can be ordered; anything extra is added to
    the job's planned materials first."""
    planned_id = data.get("plannedMaterialId") or data.get("planned_material_id")
    if not planned_id:
        raise AppError(
            "Only the job's planned materials can be ordered. "
            "Add the material to the job's planned materials first.",
            "PLANNED_MATERIAL_REQUIRED",
            400,
        )
    planned = _planned_material(job, planned_id)
    name = planned["name"]

    qty = _parse_decimal(data.get("quantity"), "quantity")
    if qty <= 0:
        raise AppError("quantity must be greater than zero", "VALIDATION_ERROR", 400)
    unit_cost = _parse_decimal(
        data.get("unitCost") if data.get("unitCost") is not None else data.get("unit_cost", 0),
        "unitCost",
    )
    default_unit = (planned or {}).get("unit") or "pcs"
    unit = (data.get("unit") or default_unit).strip() or default_unit
    _check_planned_unit(planned, unit)
    grade = (
        data.get("gradeOrSpec") or data.get("grade_or_spec") or ""
    ).strip() or None

    return MaterialPurchase(
        job_order=job,
        planned_material_id=planned["id"] if planned else None,
        material_name=name,
        grade_or_spec=grade,
        quantity=qty,
        unit=unit,
        unit_cost=unit_cost,
        supplier_id=supplier.id,
    )


def create_purchase(job: JobOrder, data: dict, actor_id: str) -> MaterialPurchase:
    """A job's purchase line goes onto the supplier's open draft order."""
    from app.services import supplier_order_service as so_service

    supplier_id = data.get("supplierId") or data.get("supplier_id")
    _order, lines = so_service.add_lines_to_draft(
        supplier_id, [{**data, "jobOrderId": job.id}], actor_id
    )
    return lines[0]


def _refuse_po_line_edit(purchase: MaterialPurchase):
    if purchase.supplier_order is not None:
        raise AppError(
            "This line belongs to a supplier order. Change it on the supplier order.",
            "ON_SUPPLIER_ORDER",
            409,
        )


def update_purchase(purchase: MaterialPurchase, data: dict) -> MaterialPurchase:
    """Edit a line recorded without a PO."""
    _refuse_po_line_edit(purchase)
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
    if "plannedMaterialId" in data or "planned_material_id" in data:
        planned = _planned_material(
            job, data.get("plannedMaterialId") or data.get("planned_material_id")
        )
        purchase.planned_material_id = planned["id"] if planned else None
    if {"plannedMaterialId", "planned_material_id", "unit"} & set(data):
        _check_planned_unit(
            _planned_material(job, purchase.planned_material_id), purchase.unit
        )

    _consume_if_job_started(purchase)
    sync_job_material_from_purchases(job)
    db.session.commit()
    return purchase


def _check_receive_date(purchase: MaterialPurchase, when: date):
    if purchase.date_ordered is not None and when < purchase.date_ordered:
        raise AppError(
            f"Date received cannot be before the order date of "
            f"{purchase.material_name} ({purchase.date_ordered.isoformat()})",
            "VALIDATION_ERROR",
            400,
        )


def _receive_consumable(p: MaterialPurchase, when: date, actor_id: str):
    """A consumable line adds its quantity to stock, like Receive delivery,
    with the RECEIVE event linked to the line (and so to its PO)."""
    from app.models.tool_event import ToolEvent, ToolEventType

    tool = p.tool
    tool.quantity_on_hand = Decimal(str(tool.quantity_on_hand or 0)) + Decimal(str(p.quantity))
    db.session.add(
        ToolEvent(
            tool_id=tool.id,
            worker_id=actor_id,
            type=ToolEventType.RECEIVE,
            quantity=p.quantity,
            reason=p.supplier_order.po_number if p.supplier_order else None,
            supplier=p.supplier.name if p.supplier else None,
            received_on=when,
            material_purchase_id=p.id,
        )
    )


def receive_lines(
    lines: list[MaterialPurchase], received_date=None, *, actor_id=None
) -> list[MaterialPurchase]:
    """Receive whole lines on one date. The only receiving path: updates each
    supplier order's status, each job's material status, and the stock of
    consumable lines (once: a received line cannot be received again)."""
    from app.services.supplier_order_service import recompute_order_status

    when = _parse_date(received_date) or date.today()
    if any(p.is_consumable for p in lines) and not actor_id:
        raise AppError("Receiving consumables needs the receiver", "VALIDATION_ERROR", 400)
    for p in lines:
        if p.cancelled_at is not None:
            raise AppError(
                f"{p.material_name} was cancelled and cannot be received.",
                "LINE_CANCELLED",
                409,
            )
        if p.is_draft:
            raise AppError(
                f"{p.material_name} is on a draft supplier order. Issue the order first.",
                "ORDER_NOT_ISSUED",
                409,
            )
        if p.date_received is not None:
            raise AppError(
                f"{p.material_name} was already received.", "ALREADY_RECEIVED", 409
            )
        _check_receive_date(p, when)
    if len({p.id for p in lines}) != len(lines):
        raise AppError("A line is listed twice.", "VALIDATION_ERROR", 400)
    for p in lines:
        p.date_received = when
        if p.is_consumable:
            _receive_consumable(p, when, actor_id)
        _consume_if_job_started(p)
    for order in {p.supplier_order for p in lines if p.supplier_order is not None}:
        recompute_order_status(order)
    for job in {p.job_order for p in lines if p.job_order is not None}:
        sync_job_material_from_purchases(job)
    db.session.commit()

    from app.services import material_delay_service

    jobs_by_order = {}
    for p in lines:
        if p.job_order is not None:
            jobs_by_order.setdefault(p.supplier_order, set()).add(p.job_order)
    for order, jobs in jobs_by_order.items():
        material_delay_service.reschedule_jobs(jobs, material_delay_service.RECEIVED, order)
    return lines


def mark_purchase_received(purchase: MaterialPurchase, received_date=None):
    receive_lines([purchase], received_date)
    return purchase


def receive_all_outstanding(job: JobOrder, received_date=None) -> int:
    """Job-level "Material received": receive every outstanding placed line."""
    if not placed_lines(job):
        raise AppError(
            "No material has been ordered for this job yet.", "NO_PURCHASE_LINES", 409
        )
    outstanding = outstanding_lines(job)
    receive_lines(outstanding, received_date)
    return len(outstanding)


def delete_purchase(purchase: MaterialPurchase):
    """Delete a line recorded without a PO (PO lines are removed or cancelled
    on their supplier order)."""
    _refuse_po_line_edit(purchase)
    job = purchase.job_order
    db.session.delete(purchase)
    db.session.flush()
    # Refresh relationship
    db.session.refresh(job)
    sync_job_material_from_purchases(job)
    db.session.commit()
