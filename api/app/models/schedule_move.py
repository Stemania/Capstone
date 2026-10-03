"""Every automatic move of a scheduled job's first operation to a later start,
with the kind of delay that caused it."""

import uuid
from datetime import datetime, timezone

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


class DelayKind:
    # Late or unordered materials set the new start.
    MATERIAL = "MATERIAL"
    # Only the passed start date moved the job.
    RESCHEDULED = "RESCHEDULED"


class MaterialCause:
    # The limiting delivery came after the date the supplier promised.
    SUPPLIER_LATE = "SUPPLIER_LATE"
    # Materials not ordered, or ordered too late to arrive by the planned start.
    NOT_ORDERED = "NOT_ORDERED"


class ScheduleMove(db.Model):
    __tablename__ = "schedule_moves"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    job_order_id = db.Column(
        db.String(36),
        db.ForeignKey("job_orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind = db.Column(db.String(20), nullable=False, index=True)
    previous_start = db.Column(db.DateTime(timezone=True), nullable=False)
    new_start = db.Column(db.DateTime(timezone=True), nullable=False)
    reason = db.Column(db.Text, nullable=True)
    supplier_order_id = db.Column(
        db.String(36), db.ForeignKey("supplier_orders.id", ondelete="SET NULL"), nullable=True
    )
    # Supplier whose delivery set the new start (also for lines without a PO).
    supplier_id = db.Column(
        db.String(36), db.ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # MATERIAL moves only: MaterialCause.
    material_cause = db.Column(db.String(20), nullable=True)
    moved_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False, index=True)

    job_order = db.relationship("JobOrder")
    supplier = db.relationship("Supplier")
    supplier_order = db.relationship("SupplierOrder")
