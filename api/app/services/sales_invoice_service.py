"""Sales invoice references.

The shop issues its official BIR-registered sales invoice outside the system.
Office Staff record that invoice's number, date and amount against the job;
marking the job delivered requires one. A recorded invoice can be corrected
until the job is delivered, with a reason, and each correction is written to
the audit log with the old and new values.
"""

from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func

from app.extensions import db
from app.models.job_order import JobOrder, JobOrderStatus
from app.models.sales_invoice import SalesInvoice
from app.services.audit_service import write_audit_event
from app.services.schedule_calendar import shop_now
from app.utils.errors import AppError

CENT = Decimal("0.01")
MAX_NUMBER_LENGTH = 64

RECORDABLE_STATUSES = (JobOrderStatus.COMPLETED, JobOrderStatus.DELIVERED)


def _invoice_number(value) -> str:
    number = str(value or "").strip()
    if not number:
        raise AppError("invoiceNumber is required", "VALIDATION_ERROR", 400)
    if len(number) > MAX_NUMBER_LENGTH:
        raise AppError(
            f"invoiceNumber must be at most {MAX_NUMBER_LENGTH} characters",
            "VALIDATION_ERROR",
            400,
        )
    return number


def _assert_number_unused(number: str, exclude_id: str | None = None):
    q = SalesInvoice.query.filter(func.lower(SalesInvoice.invoice_number) == number.lower())
    if exclude_id:
        q = q.filter(SalesInvoice.id != exclude_id)
    other = q.first()
    if other is not None:
        raise AppError(
            f"Invoice number {number} is already recorded for another job.",
            "DUPLICATE_INVOICE_NUMBER",
            409,
        )


def _invoice_date(value) -> date:
    if not value:
        raise AppError("invoiceDate is required", "VALIDATION_ERROR", 400)
    try:
        d = date.fromisoformat(str(value)[:10])
    except ValueError as exc:
        raise AppError("Invalid invoiceDate (YYYY-MM-DD)", "VALIDATION_ERROR", 400) from exc
    if d > shop_now().date():
        raise AppError("invoiceDate cannot be in the future", "VALIDATION_ERROR", 400)
    return d


def _amount(value) -> Decimal:
    if value is None or value == "":
        raise AppError("amount is required", "VALIDATION_ERROR", 400)
    try:
        d = Decimal(str(value))
    except Exception as exc:
        raise AppError("amount must be a number", "VALIDATION_ERROR", 400) from exc
    if d < 0:
        raise AppError("amount cannot be negative", "VALIDATION_ERROR", 400)
    return d.quantize(CENT, rounding=ROUND_HALF_UP)


def _snapshot(invoice: SalesInvoice) -> dict:
    return {
        "invoiceNumber": invoice.invoice_number,
        "invoiceDate": invoice.invoice_date.isoformat() if invoice.invoice_date else None,
        "amount": float(invoice.total) if invoice.total is not None else None,
    }


def record_invoice(job: JobOrder, data: dict, recorded_by_id: str) -> SalesInvoice:
    """Record the job's BIR-registered sales invoice. Amount defaults to the job amount."""
    if job.sales_invoice is not None:
        raise AppError(
            f"Sales invoice {job.sales_invoice.invoice_number} is already recorded for this job.",
            "INVOICE_EXISTS",
            409,
        )
    if job.status not in RECORDABLE_STATUSES:
        raise AppError(
            "A sales invoice can only be recorded once the job is completed.",
            "INVALID_TRANSITION",
            409,
        )

    number = _invoice_number(data.get("invoiceNumber"))
    invoice_date = _invoice_date(data.get("invoiceDate"))
    raw_amount = data.get("amount")
    if raw_amount is None or raw_amount == "":
        raw_amount = job.amount
    if raw_amount is None:
        raise AppError(
            "This job has no amount. Enter the invoice amount.", "VALIDATION_ERROR", 400
        )
    amount = _amount(raw_amount)
    _assert_number_unused(number)

    try:
        invoice = SalesInvoice(
            invoice_number=number,
            invoice_date=invoice_date,
            job_order=job,
            client_id=job.client_id,
            subtotal=amount,
            vat_amount=Decimal("0.00"),
            total=amount,
            prepared_by_id=recorded_by_id,
        )
        db.session.add(invoice)
        db.session.commit()
        return invoice
    except Exception:
        db.session.rollback()
        raise


def correct_invoice(job: JobOrder, data: dict) -> SalesInvoice:
    """Correct the recorded invoice before delivery. A reason is required."""
    invoice = job.sales_invoice
    if invoice is None:
        raise AppError("No sales invoice has been recorded for this job", "NOT_FOUND", 404)
    if job.status == JobOrderStatus.DELIVERED or job.delivered_at:
        raise AppError(
            "The job has been delivered, so its sales invoice is locked.",
            "INVOICE_LOCKED",
            409,
        )
    reason = str(data.get("reason") or "").strip()
    if not reason:
        raise AppError("Enter the reason for the correction", "VALIDATION_ERROR", 400)

    before = _snapshot(invoice)
    if "invoiceNumber" in data:
        number = _invoice_number(data.get("invoiceNumber"))
        if number != invoice.invoice_number:
            _assert_number_unused(number, exclude_id=invoice.id)
        invoice.invoice_number = number
    if "invoiceDate" in data:
        invoice.invoice_date = _invoice_date(data.get("invoiceDate"))
    if "amount" in data and _amount(data.get("amount")) != invoice.total:
        amount = _amount(data.get("amount"))
        invoice.subtotal = amount
        invoice.vat_rate = None
        invoice.vat_amount = Decimal("0.00")
        invoice.total = amount
    after = _snapshot(invoice)
    if after == before:
        raise AppError("Nothing was changed", "VALIDATION_ERROR", 400)

    try:
        write_audit_event(
            "SALES_INVOICE_CORRECTED",
            "SalesInvoice",
            invoice.id,
            before=before,
            after={**after, "reason": reason},
        )
        db.session.commit()
        return invoice
    except Exception:
        db.session.rollback()
        raise
