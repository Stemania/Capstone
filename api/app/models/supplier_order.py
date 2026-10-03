"""Supplier purchase order grouping material lines from one or more job orders."""

import enum
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from app.extensions import db

PO_PREFIX = "BMSC-PO-"


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


def format_po_number(seq: int) -> str:
    return f"{PO_PREFIX}{seq:05d}"


class SupplierOrderStatus(enum.Enum):
    DRAFT = "DRAFT"
    ISSUED = "ISSUED"
    PARTIALLY_RECEIVED = "PARTIALLY_RECEIVED"
    RECEIVED = "RECEIVED"
    CANCELLED = "CANCELLED"


# Lines on these orders count as ordered for the job (material status, readiness).
PLACED_ORDER_STATUSES = (
    SupplierOrderStatus.ISSUED,
    SupplierOrderStatus.PARTIALLY_RECEIVED,
    SupplierOrderStatus.RECEIVED,
)


class SupplierOrder(db.Model):
    __tablename__ = "supplier_orders"
    __table_args__ = (
        # At most one open draft per supplier; "Order materials" adds to it.
        db.Index(
            "uq_supplier_orders_one_draft",
            "supplier_id",
            unique=True,
            postgresql_where=db.text("status = 'DRAFT'"),
        ),
    )

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    po_seq = db.Column(db.Integer, nullable=True, unique=True)
    po_number = db.Column(db.String(32), nullable=True, unique=True)
    supplier_id = db.Column(
        db.String(36), db.ForeignKey("suppliers.id"), nullable=False, index=True
    )
    status = db.Column(
        db.Enum(SupplierOrderStatus),
        nullable=False,
        default=SupplierOrderStatus.DRAFT,
        index=True,
    )
    date_issued = db.Column(db.Date, nullable=True)
    expected_delivery_date = db.Column(db.Date, nullable=True)
    # Expected date at issue, kept the first time Office Staff change it.
    original_expected_delivery_date = db.Column(db.Date, nullable=True)
    expected_delivery_note = db.Column(db.Text, nullable=True)
    # Date the last line arrived (set when the order becomes RECEIVED).
    received_date = db.Column(db.Date, nullable=True)
    notes = db.Column(db.Text, nullable=True)
    vat_rate = db.Column(db.Numeric(5, 2), nullable=True)
    prepared_by_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False)
    issued_by_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    supplier = db.relationship("Supplier")
    prepared_by = db.relationship("User", foreign_keys=[prepared_by_id])
    issued_by = db.relationship("User", foreign_keys=[issued_by_id])
    lines = db.relationship(
        "MaterialPurchase",
        back_populates="supplier_order",
        order_by="MaterialPurchase.created_at",
    )

    @property
    def active_lines(self):
        return [ln for ln in self.lines or [] if ln.cancelled_at is None]

    def days_overdue(self, today=None) -> int:
        """Most days late among lines still awaited past the expected date."""
        return max((ln.days_overdue(today) for ln in self.lines or []), default=0)

    @property
    def subtotal(self) -> Decimal:
        return sum((ln.line_total for ln in self.active_lines), Decimal("0"))

    def to_dict(self, include_lines=False):
        s = self.supplier
        data = {
            "id": self.id,
            "poNumber": self.po_number,
            "supplierId": self.supplier_id,
            "supplierName": s.name if s else None,
            "supplierLeadTimeDays": s.typical_lead_time_days if s else None,
            "status": self.status.value,
            "dateIssued": self.date_issued.isoformat() if self.date_issued else None,
            "expectedDeliveryDate": (
                self.expected_delivery_date.isoformat()
                if self.expected_delivery_date
                else None
            ),
            "originalExpectedDeliveryDate": (
                self.original_expected_delivery_date.isoformat()
                if self.original_expected_delivery_date
                else None
            ),
            "expectedDeliveryNote": self.expected_delivery_note,
            "receivedDate": self.received_date.isoformat() if self.received_date else None,
            "notes": self.notes,
            "vatRate": float(self.vat_rate) if self.vat_rate is not None else None,
            "preparedById": self.prepared_by_id,
            "preparedByName": self.prepared_by.full_name if self.prepared_by else None,
            "issuedById": self.issued_by_id,
            "issuedByName": self.issued_by.full_name if self.issued_by else None,
            "lineCount": len(self.active_lines),
            "jobCount": len({ln.job_order_id for ln in self.active_lines}),
            "subtotal": float(self.subtotal),
            "daysOverdue": self.days_overdue(),
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }
        if include_lines:
            data["lines"] = [ln.to_dict() for ln in self.lines or []]
        return data
