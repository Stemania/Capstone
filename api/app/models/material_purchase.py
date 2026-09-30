"""Actual raw-material purchases linked to a job order (one row per line)."""

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


def _num(v):
    if v is None:
        return None
    return float(v)


class MaterialPurchase(db.Model):
    __tablename__ = "material_purchases"
    __table_args__ = (
        db.Index("ix_material_purchase_job", "job_order_id"),
        db.Index("ix_material_purchase_supplier", "supplier_id"),
        db.Index("ix_material_purchase_ordered", "date_ordered"),
    )

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    job_order_id = db.Column(
        db.String(36),
        db.ForeignKey("job_orders.id", ondelete="CASCADE"),
        nullable=False,
    )
    # id of an entry in job_orders.raw_materials; NULL = "Other material".
    planned_material_id = db.Column(db.String(36), nullable=True, index=True)
    material_name = db.Column(db.String(255), nullable=False)
    grade_or_spec = db.Column(db.String(255), nullable=True)
    quantity = db.Column(db.Numeric(12, 4), nullable=False)
    unit = db.Column(db.String(32), nullable=False, default="pcs")
    unit_cost = db.Column(db.Numeric(14, 4), nullable=False, default=Decimal("0"))
    supplier_id = db.Column(
        db.String(36), db.ForeignKey("suppliers.id"), nullable=False, index=True
    )
    # NULL = recorded without a PO (lines from before supplier orders).
    supplier_order_id = db.Column(
        db.String(36),
        db.ForeignKey("supplier_orders.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    # NULL while the line sits on a draft supplier order; set on issue.
    date_ordered = db.Column(db.Date, nullable=True)
    date_received = db.Column(db.Date, nullable=True)
    # Set automatically when the job's first operation starts (never by the worker).
    consumed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    cancelled_at = db.Column(db.DateTime(timezone=True), nullable=True)
    cancelled_by_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    job_order = db.relationship("JobOrder", back_populates="material_purchases")
    supplier = db.relationship("Supplier", back_populates="material_purchases")
    supplier_order = db.relationship("SupplierOrder", back_populates="lines")

    @property
    def line_total(self):
        return Decimal(str(self.quantity or 0)) * Decimal(str(self.unit_cost or 0))

    @property
    def is_draft(self) -> bool:
        from app.models.supplier_order import SupplierOrderStatus

        return (
            self.supplier_order is not None
            and self.supplier_order.status == SupplierOrderStatus.DRAFT
        )

    @property
    def counts_as_ordered(self) -> bool:
        """Placed with the supplier: not cancelled and not still on a draft PO."""
        return self.cancelled_at is None and not self.is_draft

    @property
    def status(self) -> str:
        """Derived, never stored: CANCELLED > DRAFT > CONSUMED > RECEIVED > ORDERED."""
        if self.cancelled_at:
            return "CANCELLED"
        if self.is_draft:
            return "DRAFT"
        if self.consumed_at:
            return "CONSUMED"
        if self.date_received:
            return "RECEIVED"
        return "ORDERED"

    def to_dict(self):
        job = self.job_order
        job_number = None
        if job and job.created_at:
            year = job.created_at.year
            short = (job.id or "")[:4].upper()
            job_number = f"JO-{year}-{short}"
        return {
            "id": self.id,
            "jobOrderId": self.job_order_id,
            "jobNumber": job_number,
            "jobTitle": job.title if job else None,
            "plannedMaterialId": self.planned_material_id,
            "materialName": self.material_name,
            "gradeOrSpec": self.grade_or_spec,
            "quantity": _num(self.quantity),
            "unit": self.unit,
            "unitCost": _num(self.unit_cost),
            "lineTotal": _num(self.line_total),
            "supplierId": self.supplier_id,
            "supplierName": self.supplier.name if self.supplier else None,
            "dateOrdered": self.date_ordered.isoformat() if self.date_ordered else None,
            "dateReceived": (
                self.date_received.isoformat() if self.date_received else None
            ),
            "consumedAt": self.consumed_at.isoformat() if self.consumed_at else None,
            "cancelledAt": self.cancelled_at.isoformat() if self.cancelled_at else None,
            "supplierOrderId": self.supplier_order_id,
            "poNumber": self.supplier_order.po_number if self.supplier_order else None,
            "orderStatus": (
                self.supplier_order.status.value if self.supplier_order else None
            ),
            "expectedDeliveryDate": (
                self.supplier_order.expected_delivery_date.isoformat()
                if self.supplier_order and self.supplier_order.expected_delivery_date
                else None
            ),
            "status": self.status,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }
