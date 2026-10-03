"""Move a scheduled job later when its materials will arrive after its first
operation's start. Runs after a supplier order is issued, received or
cancelled, or its expected delivery date changes.

Only jobs with no started operation move, and no operation is ever placed
earlier than it was. When the whole job cannot be placed, nothing changes.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.extensions import db
from app.models.job_order import JobOrder, JobOrderStatus
from app.models.material_purchase import MaterialPurchase
from app.models.schedule_move import DelayKind, MaterialCause, ScheduleMove
from app.services import material_purchase_service as mp_service
from app.services import staff_alert_service
from app.services.schedule_calendar import ensure_utc, utc_to_shop

log = logging.getLogger(__name__)

ISSUED = "ISSUED"
RECEIVED = "RECEIVED"
CANCELLED = "CANCELLED"
EXPECTED_DATE_CHANGED = "EXPECTED_DATE_CHANGED"
OVERDUE = "OVERDUE"

_TRIGGER_TEXT = {
    OVERDUE: "{po} overdue",
    ISSUED: "{po} issued",
    RECEIVED: "{po} received",
    CANCELLED: "{po} cancelled",
    EXPECTED_DATE_CHANGED: "{po} expected delivery changed",
}


def _po_label(order) -> str:
    return (order.po_number if order is not None else None) or "Supplier order"


def _first_operation(job: JobOrder):
    scheduled = [op for op in job.operations or [] if op.scheduled_start]
    return min(scheduled, key=lambda op: op.sequence_no or 0) if scheduled else None


def _limiting_purchase(job: JobOrder, floor_date):
    """The purchase line whose arrival sets the material date, if one does."""
    ready, _ = mp_service.material_readiness_date(job)
    if ready is None or ready != floor_date:
        return None
    derived = mp_service.derived_material_expected(job)
    line = derived["limitingLine"] if derived else None
    return db.session.get(MaterialPurchase, line["purchaseId"]) if line else None


def _responsible_order(job: JobOrder, floor_date, trigger_order):
    """The order whose line sets the material date; the triggering order when
    the date comes from unordered materials (supplier lead time)."""
    purchase = _limiting_purchase(job, floor_date)
    if purchase is not None and purchase.supplier_order is not None:
        return purchase.supplier_order
    return trigger_order


def responsible_supplier_id(job: JobOrder, floor_date, order):
    """Supplier of the line that sets the material date (with or without a PO),
    else the responsible order's supplier."""
    purchase = _limiting_purchase(job, floor_date)
    if purchase is not None:
        return purchase.supplier_id
    return order.supplier_id if order is not None else None


def material_cause(job: JobOrder, floor_date) -> str:
    """SUPPLIER_LATE when the line setting the material date arrives (or is
    expected) after the date its supplier promised, or is overdue; otherwise
    NOT_ORDERED (not ordered, or ordered too late for the planned start)."""
    purchase = _limiting_purchase(job, floor_date)
    if purchase is None:
        return MaterialCause.NOT_ORDERED
    if purchase.days_overdue() > 0:
        return MaterialCause.SUPPLIER_LATE
    arrival = purchase.date_received or purchase.current_expected_date
    promised = purchase.promised_date
    if arrival and promised and arrival > promised:
        return MaterialCause.SUPPLIER_LATE
    return MaterialCause.NOT_ORDERED


def _fmt(dt) -> str:
    return utc_to_shop(ensure_utc(dt)).strftime("%d %b %Y %H:%M")


def record_move(
    job: JobOrder,
    kind: str,
    old_start,
    new_start,
    reason: str,
    order=None,
    supplier_id=None,
    cause=None,
) -> None:
    """Store a move on the job (original start kept from the first move) and in
    the move history. Does not commit."""
    now = datetime.now(timezone.utc)
    if job.material_delay_original_start is None:
        job.material_delay_original_start = old_start
    job.material_delay_reason = reason
    job.material_delay_supplier_order_id = order.id if order is not None else None
    job.material_delayed_at = now
    job.delay_kind = kind
    db.session.add(
        ScheduleMove(
            job_order_id=job.id,
            kind=kind,
            previous_start=old_start,
            new_start=new_start,
            reason=reason,
            supplier_order_id=job.material_delay_supplier_order_id,
            supplier_id=supplier_id or (order.supplier_id if order is not None else None),
            material_cause=(cause or MaterialCause.NOT_ORDERED) if kind == DelayKind.MATERIAL else None,
            moved_at=now,
        )
    )


def reschedule_job(job: JobOrder, trigger: str, trigger_order=None) -> dict:
    """Re-plan one job for its material date. Does not commit."""
    from app.services.schedule_service import (
        propose_schedule,
        resolve_material_not_before_utc,
    )

    outcome = {"jobId": job.id, "jobNumber": job.job_number, "outcome": "UNCHANGED"}
    if job.status != JobOrderStatus.SCHEDULED or mp_service.job_has_started(job):
        return outcome
    first = _first_operation(job)
    if first is None:
        return outcome
    floor_date, floor_reason = mp_service.scheduling_material_floor(job)
    floor_utc = resolve_material_not_before_utc(job.material_status, None, floor_date)
    old_start = ensure_utc(first.scheduled_start)
    if floor_utc is None or old_start >= floor_utc:
        return outcome

    proposal = propose_schedule(
        list(job.operations),
        job.due_date,
        exclude_job_id=job.id,
        material_not_before_utc=floor_utc,
        material_constraint_reason=floor_reason,
        never_earlier=True,
    )
    results = {r.get("id"): r for r in proposal["operations"]}
    failed = [r for r in proposal["operations"] if not r.get("scheduled")]
    if failed or any(op.id not in results for op in job.operations):
        outcome.update(
            outcome="NO_SLOT",
            materialDate=floor_date.isoformat(),
            message="; ".join(r.get("message") or "" for r in failed) or None,
        )
        return outcome

    for op in job.operations:
        r = results[op.id]
        start = datetime.fromisoformat(r["scheduledStart"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(r["scheduledEnd"].replace("Z", "+00:00"))
        if op.scheduled_start and ensure_utc(start) < ensure_utc(op.scheduled_start):
            raise RuntimeError("material reschedule tried to move an operation earlier")
        op.scheduled_start = start
        op.scheduled_end = end
        if r.get("machineUnitId"):
            op.machine_unit_id = r["machineUnitId"]

    new_start = ensure_utc(first.scheduled_start)
    order = _responsible_order(job, floor_date, trigger_order)
    if trigger == OVERDUE:
        trigger_text = f"{order.po_number} overdue" if order is not None and order.po_number else "Delivery overdue"
    else:
        trigger_text = _TRIGGER_TEXT.get(trigger, "{po} changed").format(po=_po_label(trigger_order))
    record_move(
        job,
        DelayKind.MATERIAL,
        old_start,
        new_start,
        f"{trigger_text}: first operation moved from {_fmt(old_start)} to "
        f"{_fmt(new_start)} ({floor_reason})",
        order,
        supplier_id=responsible_supplier_id(job, floor_date, order),
        cause=material_cause(job, floor_date),
    )
    outcome.update(
        outcome="MOVED",
        previousStart=old_start.isoformat(),
        newStart=new_start.isoformat(),
        materialDate=floor_date.isoformat(),
        supplierOrderId=job.material_delay_supplier_order_id,
    )
    return outcome


def reschedule_jobs(jobs, trigger: str, trigger_order=None) -> list[dict]:
    """Re-plan each job after a supplier order change, committing per job.

    A failure on one job is logged and rolled back without undoing the order
    change, which has already been committed.
    """
    outcomes = []
    for job_id in sorted({j.id for j in jobs if j is not None}):
        try:
            job = db.session.get(JobOrder, job_id)
            if job is None:
                continue
            outcome = reschedule_job(job, trigger, trigger_order)
            if outcome["outcome"] == "MOVED":
                # A still-overdue delivery moves the job again each day; alert once.
                key = (
                    f"material-delay-overdue:{job.id}:{job.material_delay_supplier_order_id or ''}"
                    if trigger == OVERDUE
                    else None
                )
                staff_alert_service.material_delay_alert(job, outcome, dedupe_key=key)
            db.session.commit()
            outcomes.append(outcome)
        except Exception:
            db.session.rollback()
            log.exception("Material reschedule failed for job %s", job_id)
    return outcomes


def reschedule_for_order(order, trigger: str) -> list[dict]:
    """Every job with a line on ``order``."""
    jobs = {ln.job_order for ln in order.lines or []}
    return reschedule_jobs(jobs, trigger, order)
