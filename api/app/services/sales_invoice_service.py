"""Sales invoice issued once per job order after it is COMPLETED."""

from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func

from app.extensions import db
from app.models.job_order import JobOrder, JobOrderStatus
from app.models.sales_invoice import SalesInvoice, format_invoice_number
from app.utils.errors import AppError

CENT = Decimal("0.01")
DEFAULT_VAT_RATE = Decimal("12")

INVOICEABLE_STATUSES = (JobOrderStatus.COMPLETED, JobOrderStatus.DELIVERED)


def _money(value, field) -> Decimal:
    if value is None or value == "":
        raise AppError(f"{field} is required", "VALIDATION_ERROR", 400)
    try:
        d = Decimal(str(value))
    except Exception as exc:
        raise AppError(f"{field} must be a number", "VALIDATION_ERROR", 400) from exc
    if d < 0:
        raise AppError(f"{field} cannot be negative", "VALIDATION_ERROR", 400)
    return d.quantize(CENT, rounding=ROUND_HALF_UP)


def _parse_date(value) -> date:
    if not value:
        return date.today()
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as exc:
        raise AppError("Invalid invoiceDate (YYYY-MM-DD)", "VALIDATION_ERROR", 400) from exc


def default_description(job: JobOrder) -> str:
    return (job.description or "").strip() or job.title


def _next_seq() -> int:
    current = db.session.query(func.max(SalesInvoice.invoice_seq)).scalar()
    return int(current or 0) + 1


def issue_invoice(job: JobOrder, data: dict, prepared_by_id: str) -> SalesInvoice:
    """Issue the job's invoice. Amount defaults from job.amount; staff may override."""
    if job.sales_invoice is not None:
        raise AppError(
            f"Invoice {job.sales_invoice.invoice_number} was already issued for this job.",
            "INVOICE_EXISTS",
            409,
        )
    if job.status not in INVOICEABLE_STATUSES:
        raise AppError(
            "A sales invoice can only be issued once the job is completed.",
            "INVALID_TRANSITION",
            409,
        )

    raw_subtotal = data.get("subtotal")
    if raw_subtotal is None or raw_subtotal == "":
        raw_subtotal = job.amount
    if raw_subtotal is None:
        raise AppError(
            "This job has no amount. Enter the invoice subtotal.",
            "VALIDATION_ERROR",
            400,
        )
    subtotal = _money(raw_subtotal, "subtotal")

    vat_rate = None
    vat_amount = Decimal("0.00")
    if data.get("vatRate") not in (None, "", 0, "0"):
        vat_rate = Decimal(str(data.get("vatRate")))
        if vat_rate < 0 or vat_rate > 100:
            raise AppError("vatRate must be between 0 and 100", "VALIDATION_ERROR", 400)
        vat_amount = (subtotal * vat_rate / Decimal("100")).quantize(
            CENT, rounding=ROUND_HALF_UP
        )

    description = (data.get("description") or "").strip() or default_description(job)

    try:
        seq = _next_seq()
        invoice = SalesInvoice(
            invoice_seq=seq,
            invoice_number=format_invoice_number(seq),
            invoice_date=_parse_date(data.get("invoiceDate")),
            job_order=job,
            client_id=job.client_id,
            description=description,
            subtotal=subtotal,
            vat_rate=vat_rate,
            vat_amount=vat_amount,
            total=subtotal + vat_amount,
            prepared_by_id=prepared_by_id,
        )
        db.session.add(invoice)
        db.session.commit()
        return invoice
    except Exception:
        db.session.rollback()
        raise
