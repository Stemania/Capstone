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
    material_name = db.Column(db.String(255), nullable=False)
    grade_or_spec = db.Column(db.String(255), nullable=True)
    quantity = db.Column(db.Numeric(12, 4), nullable=False)
    unit = db.Column(db.String(32), nullable=False, default="pcs")
    unit_cost = db.Column(db.Numeric(14, 4), nullable=False, default=Decimal("0"))
    supplier_id = db.Column(
        db.String(36), db.ForeignKey("suppliers.id"), nullable=False, index=True
    )
    date_ordered = db.Column(db.Date, nullable=False)
    date_received = db.Column(db.Date, nullable=True)
    # Set automatically when the job's first operation starts (never by the worker).
    consumed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    job_order = db.relationship("JobOrder", back_populates="material_purchases")
    supplier = db.relationship("Supplier", back_populates="material_purchases")

    @property
    def line_total(self):
        return Decimal(str(self.quantity or 0)) * Decimal(str(self.unit_cost or 0))

    @property
    def status(self) -> str:
        """Derived, never stored: CONSUMED > RECEIVED > ORDERED."""
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
            "status": self.status,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }
