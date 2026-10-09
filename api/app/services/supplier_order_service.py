"""Supplier purchase orders: one printable PO grouping job material lines from
several jobs and consumable restock lines."""

from __future__ import annotations

from collections import OrderedDict
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models.job_order import JobOrder, JobOrderStatus, MaterialStatus
from app.models.material_purchase import MaterialPurchase
from app.models.supplier import Supplier
from app.models.supplier_order import (
    SupplierOrder,
    SupplierOrderStatus,
    format_po_number,
)
from app.services import material_delay_service as delay_service
from app.services import material_purchase_service as mp_service
from app.services.schedule_calendar import next_shop_working_day
from app.utils.errors import AppError

CENT = Decimal("0.01")

# Materials are not ordered for jobs that are already finished.
CLOSED_JOB_STATUSES = (JobOrderStatus.COMPLETED, JobOrderStatus.DELIVERED)
RECEIVABLE_STATUSES = (SupplierOrderStatus.ISSUED, SupplierOrderStatus.PARTIALLY_RECEIVED)


def _parse_date(value, field):
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as exc:
        raise AppError(f"Invalid {field} (YYYY-MM-DD)", "VALIDATION_ERROR", 400) from exc


def _decimal(value, field, *, positive=False):
    if value is None or value == "":
        raise AppError(f"{field} is required", "VALIDATION_ERROR", 400)
    try:
        d = Decimal(str(value))
    except Exception as exc:
        raise AppError(f"{field} must be a number", "VALIDATION_ERROR", 400) from exc
    if d < 0 or (positive and d == 0):
        raise AppError(
            f"{field} must be greater than zero" if positive else f"{field} cannot be negative",
            "VALIDATION_ERROR",
            400,
        )
    return d


# Reading


def list_orders(*, status=None, supplier_id=None):
    """status may also be OVERDUE: orders with a line past its expected date."""
    q = SupplierOrder.query.options(
        joinedload(SupplierOrder.supplier), joinedload(SupplierOrder.lines)
    )
    if status == "OVERDUE":
        q = q.filter(
            SupplierOrder.status.in_(
                [SupplierOrderStatus.ISSUED, SupplierOrderStatus.PARTIALLY_RECEIVED]
            )
        )
        if supplier_id:
            q = q.filter(SupplierOrder.supplier_id == supplier_id)
        rows = q.order_by(SupplierOrder.expected_delivery_date.asc()).all()
        return [o for o in rows if o.days_overdue() > 0]
    if status:
        try:
            q = q.filter(SupplierOrder.status == SupplierOrderStatus(status))
        except ValueError as exc:
            raise AppError("Invalid status", "VALIDATION_ERROR", 400) from exc
    if supplier_id:
        q = q.filter(SupplierOrder.supplier_id == supplier_id)
    return q.order_by(SupplierOrder.created_at.desc()).all()


def get_order(order_id) -> SupplierOrder:
    order = SupplierOrder.query.get(order_id)
    if not order:
        raise AppError("Supplier order not found", "NOT_FOUND", 404)
    return order


def get_line(order: SupplierOrder, line_id) -> MaterialPurchase:
    line = MaterialPurchase.query.get(line_id)
    if not line or line.supplier_order_id != order.id:
        raise AppError("Line not found on this supplier order", "NOT_FOUND", 404)
    return line


def ordering_context(job_id=None):
    """Open jobs that need materials (To order), the earliest required first,
    with what is already on draft or issued orders, plus low-stock consumables.
    Office Staff type each material line when ordering."""
    q = JobOrder.query.options(
        joinedload(JobOrder.material_purchases), joinedload(JobOrder.client)
    ).filter(
        JobOrder.status.notin_(CLOSED_JOB_STATUSES),
        JobOrder.material_status != MaterialStatus.NOT_REQUIRED,
    )
    if job_id:
        q = q.filter(JobOrder.id == job_id)
    jobs = []
    for job in q.order_by(JobOrder.due_date.asc()).all():
        active = [p for p in job.material_purchases or [] if p.cancelled_at is None]
        jobs.append(
            {
                "id": job.id,
                "jobNumber": job.job_number,
                "title": job.title,
                "clientName": job.client.name if job.client else None,
                "dueDate": job.due_date.isoformat() if job.due_date else None,
                "materialStatus": job.material_status.value,
                "issuedLineCount": sum(1 for p in active if not p.is_draft),
                "draftLineCount": sum(1 for p in active if p.is_draft),
                "notOrderedYet": not mp_service.placed_lines(job),
            }
        )
    return {
        "jobs": jobs,
        "lowStockConsumables": [] if job_id else low_stock_consumables(),
    }


def _consumable_on_order() -> dict:
    """Quantity per consumable on draft or issued lines not yet received."""
    rows = (
        MaterialPurchase.query.join(SupplierOrder)
        .filter(
            MaterialPurchase.tool_id.isnot(None),
            MaterialPurchase.cancelled_at.is_(None),
            MaterialPurchase.date_received.is_(None),
            SupplierOrder.status.in_(
                [SupplierOrderStatus.DRAFT, *RECEIVABLE_STATUSES]
            ),
        )
        .all()
    )
    out: dict = {}
    for ln in rows:
        out[ln.tool_id] = out.get(ln.tool_id, Decimal("0")) + Decimal(str(ln.quantity))
    return out


def low_stock_consumables() -> list[dict]:
    """Consumables at or below minimum stock with the suggested order quantity,
    and what is already on a draft or open supplier order."""
    from app.services.inventory_service import purchase_suggestions

    on_order = _consumable_on_order()
    rows = []
    for item in purchase_suggestions()["items"]:
        ordered = on_order.get(item["toolId"], Decimal("0"))
        suggested = Decimal(str(item["suggestedOrderQuantity"] or 0))
        rows.append(
            {
                "toolId": item["toolId"],
                "name": item["name"],
                "code": item["code"],
                "sizeSpec": item["sizeSpec"],
                "shopTerm": item.get("shopTerm"),
                "unit": item["unit"],
                "quantityOnHand": item["quantityOnHand"],
                "minimumStock": item["minimumStock"],
                "suggestedOrderQuantity": item["suggestedOrderQuantity"],
                "onOrderQuantity": float(ordered),
                "remainingSuggestedQuantity": float(max(suggested - ordered, Decimal("0"))),
            }
        )
    return rows


# Drafts


def _draft_for(supplier: Supplier, actor_id: str) -> SupplierOrder:
    order = SupplierOrder.query.filter_by(
        supplier_id=supplier.id, status=SupplierOrderStatus.DRAFT
    ).first()
    if order:
        return order
    order = SupplierOrder(
        supplier_id=supplier.id,
        status=SupplierOrderStatus.DRAFT,
        prepared_by_id=actor_id,
    )
    db.session.add(order)
    db.session.flush()
    return order


def _require_draft(order: SupplierOrder):
    if order.status != SupplierOrderStatus.DRAFT:
        raise AppError(
            "This supplier order was issued; its lines are locked. To change it, "
            "cancel the order and issue a new one.",
            "ORDER_LOCKED",
            409,
        )


def _build_consumable_line(supplier: Supplier, data: dict) -> MaterialPurchase:
    """A consumable restock line: chosen from the consumables list, not tied to a job."""
    from app.models.tool import Tool, ToolCategory

    tool = Tool.query.get(data.get("toolId") or "")
    if not tool or tool.category != ToolCategory.CONSUMABLE:
        raise AppError("Consumable not found", "NOT_FOUND", 404)
    unit = (data.get("unit") or tool.unit or "pcs").strip()
    if unit != tool.unit:
        raise AppError(
            f"Unit must be {tool.unit} to match the consumable", "VALIDATION_ERROR", 400
        )
    grade = (data.get("gradeOrSpec") or "").strip() or tool.size_spec
    return MaterialPurchase(
        tool_id=tool.id,
        material_name=tool.name,
        grade_or_spec=grade,
        quantity=_decimal(data.get("quantity"), "quantity", positive=True),
        unit=tool.unit,
        unit_cost=_decimal(
            data.get("unitCost") if data.get("unitCost") is not None else 0, "unitCost"
        ),
        supplier_id=supplier.id,
    )


def add_lines_to_draft(supplier_id, lines: list, actor_id: str):
    """Add lines to the supplier's open draft, starting one if there is none.
    Each line is a job material (``jobOrderId`` + the typed material) or a
    consumable restock (``toolId``). Returns (order, created_lines)."""
    if not supplier_id:
        raise AppError("supplierId is required", "VALIDATION_ERROR", 400)
    supplier = Supplier.query.get(supplier_id)
    if not supplier:
        raise AppError("Supplier not found", "NOT_FOUND", 404)
    if not supplier.active:
        raise AppError("Supplier is inactive", "VALIDATION_ERROR", 400)
    if not lines:
        raise AppError("Add at least one line", "VALIDATION_ERROR", 400)

    try:
        order = _draft_for(supplier, actor_id)
        created = []
        for data in lines:
            if data.get("toolId") and data.get("jobOrderId"):
                raise AppError(
                    "A line is either a job material or a consumable, not both.",
                    "VALIDATION_ERROR",
                    400,
                )
            if data.get("toolId"):
                line = _build_consumable_line(supplier, data)
                line.supplier_order = order
                db.session.add(line)
                created.append(line)
                continue
            job = JobOrder.query.get(data.get("jobOrderId") or "")
            if not job:
                raise AppError(
                    "Each line needs a job order or a consumable", "VALIDATION_ERROR", 400
                )
            if job.status in CLOSED_JOB_STATUSES:
                raise AppError(
                    f"{job.job_number} is {job.status.value.lower()}; "
                    "materials cannot be ordered for it.",
                    "JOB_CLOSED",
                    409,
                )
            line = mp_service.build_draft_line(job, supplier, data)
            line.supplier_order = order
            if not job.supplier_id:
                job.supplier_id = supplier.id
            db.session.add(line)
            created.append(line)
        db.session.commit()
        return order, created
    except Exception:
        db.session.rollback()
        raise


def update_draft(order: SupplierOrder, data: dict) -> SupplierOrder:
    _require_draft(order)
    if "notes" in data:
        order.notes = (data.get("notes") or "").strip() or None
    if "vatRate" in data:
        raw = data.get("vatRate")
        if raw in (None, "", 0, "0"):
            order.vat_rate = None
        else:
            rate = _decimal(raw, "vatRate")
            if rate > 100:
                raise AppError("vatRate must be between 0 and 100", "VALIDATION_ERROR", 400)
            order.vat_rate = rate
    db.session.commit()
    return order


def update_draft_line(order: SupplierOrder, line: MaterialPurchase, data: dict):
    _require_draft(order)
    if "quantity" in data:
        line.quantity = _decimal(data.get("quantity"), "quantity", positive=True)
    if "unitCost" in data:
        line.unit_cost = _decimal(data.get("unitCost"), "unitCost")
    if "gradeOrSpec" in data:
        line.grade_or_spec = (data.get("gradeOrSpec") or "").strip() or None
    if line.planned_material_id is None and line.tool_id is None:
        if "materialName" in data:
            name = (data.get("materialName") or "").strip()
            if not name:
                raise AppError("materialName is required", "VALIDATION_ERROR", 400)
            line.material_name = name
        if "unit" in data:
            line.unit = (data.get("unit") or "pcs").strip() or "pcs"
    db.session.commit()
    return line


def remove_draft_line(order: SupplierOrder, line: MaterialPurchase):
    _require_draft(order)
    db.session.delete(line)
    db.session.commit()


# Issuing


def _jobs_of(lines) -> set:
    """Jobs with a material line among ``lines`` (consumable lines have none)."""
    return {ln.job_order for ln in lines if ln.job_order is not None}


def _next_po_seq(supplier_id: str, year: int) -> int:
    """Next number in the supplier's sequence for the year. Locks the
    supplier row so two orders issued at once cannot take the same number."""
    db.session.query(Supplier.id).filter(Supplier.id == supplier_id).with_for_update().one()
    current = (
        db.session.query(func.max(SupplierOrder.po_seq))
        .filter(SupplierOrder.supplier_id == supplier_id, SupplierOrder.po_year == year)
        .scalar()
    )
    return int(current or 0) + 1


def issue_order(order: SupplierOrder, actor_id: str, date_issued=None) -> SupplierOrder:
    """Office Staff issue the PO: number, date, expected delivery; lines lock.
    The issuer is the one who prepared it; "Approved by" is signed on paper."""
    _require_draft(order)
    if not order.active_lines:
        raise AppError("Add at least one line before issuing.", "VALIDATION_ERROR", 400)
    if order.supplier and not order.supplier.active:
        raise AppError(
            f"{order.supplier.name} is inactive. Reactivate it on the Suppliers page "
            "to issue this order.",
            "SUPPLIER_INACTIVE",
            400,
        )
    lead = order.supplier.typical_lead_time_days if order.supplier else None
    if lead is None:
        raise AppError(
            f"{order.supplier.name} has no lead time. Set it on the Suppliers page "
            "before issuing, so the expected delivery date can be worked out.",
            "SUPPLIER_LEAD_TIME_MISSING",
            400,
        )
    if not order.supplier.code:
        raise AppError(
            f"{order.supplier.name} has no supplier code. Set it on the Suppliers page "
            "before issuing; the PO number starts with it.",
            "SUPPLIER_CODE_MISSING",
            400,
        )
    issued = _parse_date(date_issued, "dateIssued") or date.today()
    try:
        seq = _next_po_seq(order.supplier_id, issued.year)
        order.po_seq = seq
        order.po_year = issued.year
        order.po_number = format_po_number(order.supplier.code, issued.year, seq)
        order.date_issued = issued
        order.expected_delivery_date = next_shop_working_day(issued + timedelta(days=lead))
        order.issued_by_id = actor_id
        order.prepared_by_id = actor_id
        order.status = SupplierOrderStatus.ISSUED
        for line in order.active_lines:
            line.date_ordered = issued
        db.session.flush()
        for job in _jobs_of(order.active_lines):
            mp_service.sync_job_material_from_purchases(job)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    delay_service.reschedule_for_order(order, delay_service.ISSUED)
    return order


# After issue: lines are locked. The order is received whole or cancelled whole.


def recompute_order_status(order: SupplierOrder):
    if order.status in (SupplierOrderStatus.DRAFT, SupplierOrderStatus.CANCELLED):
        return
    active = order.active_lines
    if not active:
        order.status = SupplierOrderStatus.CANCELLED
        order.received_date = None
        return
    received = [ln for ln in active if ln.date_received is not None]
    if len(received) == len(active):
        order.status = SupplierOrderStatus.RECEIVED
        order.received_date = max(ln.date_received for ln in received)
    elif received:
        order.status = SupplierOrderStatus.PARTIALLY_RECEIVED
        order.received_date = None
    else:
        order.status = SupplierOrderStatus.ISSUED
        order.received_date = None


def _cancel_lines(lines, actor_id):
    now = datetime.now(timezone.utc)
    for ln in lines:
        ln.cancelled_at = now
        ln.cancelled_by_id = actor_id


def cancel_order(order: SupplierOrder, actor_id: str) -> SupplierOrder:
    """Cancel the whole order; its jobs' materials go back to to-order. To
    change an issued order, cancel it and issue a new one."""
    if order.status in (SupplierOrderStatus.RECEIVED, SupplierOrderStatus.CANCELLED):
        raise AppError("This supplier order is closed.", "ORDER_CLOSED", 409)
    if any(ln.date_received for ln in order.active_lines):
        raise AppError(
            "Part of this order was received earlier. Complete it with Receive order.",
            "PARTLY_RECEIVED",
            409,
        )
    lines = order.active_lines
    _cancel_lines(lines, actor_id)
    order.status = SupplierOrderStatus.CANCELLED
    for job in _jobs_of(lines):
        mp_service.sync_job_material_from_purchases(job)
    db.session.commit()
    delay_service.reschedule_for_order(order, delay_service.CANCELLED)
    return order


EXPECTED_DELIVERY_CHANGED = "EXPECTED_DELIVERY_CHANGED"


def change_expected_delivery(order: SupplierOrder, new_date, note) -> dict:
    """Office Staff record a new expected delivery date from the supplier.

    Unreceived lines arrive on the order's expected date, so the change covers
    all of them. The date at issue is kept the first time. A later date moves
    affected jobs (step 8); an earlier one moves nothing.
    """
    from app.services.audit_service import write_audit_event

    if order.status not in RECEIVABLE_STATUSES:
        raise AppError(
            "Only an issued supplier order that is not fully received can have "
            "its expected delivery date changed.",
            "ORDER_NOT_OPEN",
            409,
        )
    new = _parse_date(new_date, "expectedDeliveryDate")
    if new is None:
        raise AppError("Choose the new expected delivery date.", "VALIDATION_ERROR", 400)
    new = next_shop_working_day(new)
    note = (note or "").strip()
    if not note:
        raise AppError(
            "Add a note, for example \u201cSupplier confirmed delivery on 15 Oct\u201d.",
            "VALIDATION_ERROR",
            400,
        )
    if order.date_issued and new < order.date_issued:
        raise AppError(
            f"The expected delivery date cannot be before the issue date "
            f"({order.date_issued.isoformat()}).",
            "VALIDATION_ERROR",
            400,
        )
    old = order.expected_delivery_date
    if new == old:
        raise AppError(
            "That is already the expected delivery date.", "VALIDATION_ERROR", 400
        )
    try:
        if order.original_expected_delivery_date is None:
            order.original_expected_delivery_date = old
        order.expected_delivery_date = new
        order.expected_delivery_note = note
        write_audit_event(
            EXPECTED_DELIVERY_CHANGED,
            "SupplierOrder",
            order.id,
            before={"expectedDeliveryDate": old.isoformat() if old else None},
            after={"expectedDeliveryDate": new.isoformat(), "note": note},
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    outcomes = []
    if old is None or new > old:
        outcomes = delay_service.reschedule_for_order(
            order, delay_service.EXPECTED_DATE_CHANGED
        )
    return {
        "order": order,
        "movedJobs": [o for o in outcomes if o["outcome"] == "MOVED"],
        "notMovedJobs": [o for o in outcomes if o["outcome"] == "NO_SLOT"],
    }


def expected_delivery_history(order: SupplierOrder) -> list[dict]:
    """Every expected-date change on the order with its note, newest first."""
    from app.models.audit_log import AuditLog

    rows = (
        AuditLog.query.options(joinedload(AuditLog.user))
        .filter(
            AuditLog.entity_type == "SupplierOrder",
            AuditLog.entity_id == order.id,
            AuditLog.action == EXPECTED_DELIVERY_CHANGED,
        )
        .order_by(AuditLog.created_at.desc())
        .all()
    )
    return [
        {
            "from": (r.before_json or {}).get("expectedDeliveryDate"),
            "to": (r.after_json or {}).get("expectedDeliveryDate"),
            "note": (r.after_json or {}).get("note"),
            "changedByName": r.user.full_name if r.user else None,
            "changedAt": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


def receive_order(order: SupplierOrder, received_date=None, *, actor_id=None):
    """Deliveries arrive complete: receive every open line on one date. Also
    completes an order partly received before this rule."""
    if order.status not in RECEIVABLE_STATUSES:
        raise AppError(
            "Only an issued supplier order can be received.", "ORDER_NOT_ISSUED", 409
        )
    lines = [ln for ln in order.active_lines if ln.date_received is None]
    if not lines:
        raise AppError("Every line on this order is already received.", "ALREADY_RECEIVED", 409)
    mp_service.receive_lines(lines, received_date, actor_id=actor_id)
    return order


# Printing


def _money(v: Decimal) -> Decimal:
    return v.quantize(CENT, rounding=ROUND_HALF_UP)


def print_data(order: SupplierOrder) -> dict:
    """The printed PO. Lines with the same material, grade and unit print as one
    row; the system keeps them separate per job. Consumable restock lines print
    alongside, without a job number. A draft has no PO number yet, so it cannot
    be printed."""
    if order.status == SupplierOrderStatus.DRAFT:
        raise AppError("Issue the order before printing.", "ORDER_NOT_ISSUED", 409)
    groups: "OrderedDict[tuple, dict]" = OrderedDict()
    for ln in order.active_lines:
        key = (
            ln.is_consumable,
            (ln.material_name or "").strip().lower(),
            (ln.grade_or_spec or "").strip().lower(),
            (ln.unit or "").strip().lower(),
        )
        row = groups.get(key)
        if row is None:
            row = groups[key] = {
                "materialName": ln.material_name,
                "gradeOrSpec": ln.grade_or_spec,
                "unit": ln.unit,
                "isConsumable": ln.is_consumable,
                "amount": Decimal("0"),
                "quantity": Decimal("0"),
                "jobNumbers": [],
                "lineCount": 0,
            }
        qty = Decimal(str(ln.quantity or 0))
        row["quantity"] += qty
        row["amount"] += qty * Decimal(str(ln.unit_cost or 0))
        row["lineCount"] += 1
        jn = ln.job_order.job_number if ln.job_order else None
        if jn and jn not in row["jobNumbers"]:
            row["jobNumbers"].append(jn)

    rows = []
    subtotal = Decimal("0")
    for row in groups.values():
        amount = _money(row["amount"])
        unit_cost = (
            _money(amount / row["quantity"]) if row["quantity"] else Decimal("0")
        )
        subtotal += amount
        rows.append(
            {
                **row,
                "quantity": float(row["quantity"]),
                "unitCost": float(unit_cost),
                "amount": float(amount),
            }
        )
    vat_amount = (
        _money(subtotal * Decimal(str(order.vat_rate)) / Decimal("100"))
        if order.vat_rate
        else Decimal("0")
    )
    s = order.supplier
    return {
        "order": order.to_dict(),
        "supplier": {
            "name": s.name,
            "contactPerson": s.contact_person,
            "phone": s.phone,
            "email": s.email,
            "address": s.address,
        }
        if s
        else None,
        "rows": rows,
        "subtotal": float(subtotal),
        "vatRate": float(order.vat_rate) if order.vat_rate else None,
        "vatAmount": float(vat_amount),
        "total": float(subtotal + vat_amount),
    }
