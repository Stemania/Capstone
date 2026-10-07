"""Purchase lines: job materials (linked to a job order) or consumable restock
(linked to a consumable, not to a job). One row per line."""

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
        db.CheckConstraint(
            "(job_order_id IS NULL) <> (tool_id IS NULL)",
            name="ck_material_purchase_job_or_consumable",
        ),
    )

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    # Exactly one of job_order_id (job material) or tool_id (consumable restock).
    job_order_id = db.Column(
        db.String(36),
        db.ForeignKey("job_orders.id", ondelete="CASCADE"),
        nullable=True,
    )
    tool_id = db.Column(
        db.String(36),
        db.ForeignKey("tools.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
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
    tool = db.relationship("Tool")
    supplier = db.relationship("Supplier", back_populates="material_purchases")
    supplier_order = db.relationship("SupplierOrder", back_populates="lines")

    @property
    def is_consumable(self) -> bool:
        return self.tool_id is not None

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

    @property
    def current_expected_date(self):
        """The supplier order's expected delivery date (as edited), or for a line
        recorded without a PO, date ordered plus the supplier's lead time
        (moved to the next shop working day)."""
        from datetime import timedelta

        from app.services.schedule_calendar import next_shop_working_day

        if self.supplier_order is not None:
            return self.supplier_order.expected_delivery_date
        lead = self.supplier.typical_lead_time_days if self.supplier else None
        if self.date_ordered is None or lead is None:
            return None
        return next_shop_working_day(self.date_ordered + timedelta(days=int(lead)))

    @property
    def promised_date(self):
        """The date promised when the order was placed, never the edited one;
        a promise on a Sunday or shop holiday means the next working day."""
        from app.services.schedule_calendar import next_shop_working_day

        order = self.supplier_order
        if order is not None:
            promised = order.original_expected_delivery_date or order.expected_delivery_date
            return next_shop_working_day(promised) if promised else None
        return self.current_expected_date

    def days_overdue(self, today=None) -> int:
        """Days past the current expected date while placed, not received and
        not cancelled; 0 otherwise."""
        if self.date_received is not None or not self.counts_as_ordered:
            return 0
        expected = self.current_expected_date
        if expected is None:
            return 0
        if today is None:
            from app.services.schedule_calendar import shop_now

            today = shop_now().date()
        return max((today - expected).days, 0)

    def to_dict(self):
        job = self.job_order
        job_number = None
        if job and job.created_at:
            year = job.created_at.year
            short = (job.id or "")[:4].upper()
            job_number = f"JO-{year}-{short}"
        return {
            "id": self.id,
            "kind": "CONSUMABLE" if self.is_consumable else "JOB_MATERIAL",
            "jobOrderId": self.job_order_id,
            "jobNumber": job_number,
            "jobTitle": job.title if job else None,
            "toolId": self.tool_id,
            "toolCode": self.tool.code if self.tool else None,
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
            "currentExpectedDate": (
                self.current_expected_date.isoformat() if self.current_expected_date else None
            ),
            "daysOverdue": self.days_overdue(),
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }
