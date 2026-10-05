"""Reference to the shop's BIR-registered sales invoice for a job order (one per job).

The system does not issue invoices. Office Staff record the number, date and
amount from the official invoice. Invoices the system generated before this
(BMSC-INV-00001 style, with a sequence and VAT breakdown) keep those values as
recorded references.
"""

import uuid
from datetime import datetime, timezone

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


def _num(v):
    if v is None:
        return None
    return float(v)


class SalesInvoice(db.Model):
    __tablename__ = "sales_invoices"
    __table_args__ = (
        db.Index("ix_sales_invoices_client", "client_id"),
        db.Index("ix_sales_invoices_date", "invoice_date"),
    )

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    # Only set on invoices the system generated before invoices became references.
    invoice_seq = db.Column(db.Integer, nullable=True, unique=True)
    invoice_number = db.Column(db.String(64), nullable=False, unique=True)
    invoice_date = db.Column(db.Date, nullable=False)
    job_order_id = db.Column(
        db.String(36),
        db.ForeignKey("job_orders.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    client_id = db.Column(db.String(36), db.ForeignKey("clients.id"), nullable=False)
    description = db.Column(db.Text, nullable=True)
    subtotal = db.Column(db.Numeric(14, 2), nullable=False)
    vat_rate = db.Column(db.Numeric(5, 2), nullable=True)
    vat_amount = db.Column(db.Numeric(14, 2), nullable=False, default=0)
    # The invoice amount.
    total = db.Column(db.Numeric(14, 2), nullable=False)
    prepared_by_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow)

    job_order = db.relationship("JobOrder", back_populates="sales_invoice")
    client = db.relationship("Client")
    prepared_by = db.relationship("User")

    def to_dict(self):
        return {
            "id": self.id,
            "invoiceNumber": self.invoice_number,
            "invoiceDate": self.invoice_date.isoformat() if self.invoice_date else None,
            "jobOrderId": self.job_order_id,
            "clientId": self.client_id,
            "clientName": self.client.name if self.client else None,
            "amount": _num(self.total),
            "preparedById": self.prepared_by_id,
            "preparedByName": self.prepared_by.full_name if self.prepared_by else None,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }
