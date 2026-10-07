"""Append-only operation time events and machine downtime records."""

import enum
import uuid
from datetime import datetime, timezone

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


class OperationTimeEvent(enum.Enum):
    START = "START"
    PAUSE = "PAUSE"
    RESUME = "RESUME"
    COMPLETE = "COMPLETE"


class OperationPauseReason(enum.Enum):
    END_OF_SHIFT = "END_OF_SHIFT"
    BREAK = "BREAK"
    MACHINE_DOWN = "MACHINE_DOWN"
    WAITING_MATERIAL = "WAITING_MATERIAL"
    WAITING_PRIOR_OPERATION = "WAITING_PRIOR_OPERATION"
    OTHER = "OTHER"


PAUSE_REASON_LABELS = {
    OperationPauseReason.END_OF_SHIFT.value: "End of shift",
    OperationPauseReason.BREAK.value: "Break",
    OperationPauseReason.MACHINE_DOWN.value: "Machine down",
    OperationPauseReason.WAITING_MATERIAL.value: "Waiting for material",
    OperationPauseReason.WAITING_PRIOR_OPERATION.value: "Waiting on prior operation",
    OperationPauseReason.OTHER.value: "Other",
}


def pause_reason_label(reason) -> str:
    key = reason.value if isinstance(reason, OperationPauseReason) else str(reason or "")
    return PAUSE_REASON_LABELS.get(key) or key.replace("_", " ").capitalize()


class DowntimeCategory(enum.Enum):
    MECHANICAL_FAILURE = "MECHANICAL_FAILURE"
    ELECTRICAL_FAULT = "ELECTRICAL_FAULT"
    UNDER_REPAIR = "UNDER_REPAIR"
    WAITING_FOR_PARTS = "WAITING_FOR_PARTS"
    SCHEDULED_MAINTENANCE = "SCHEDULED_MAINTENANCE"
    OTHER = "OTHER"


DOWNTIME_CATEGORY_LABELS = {
    DowntimeCategory.MECHANICAL_FAILURE: "Mechanical failure",
    DowntimeCategory.ELECTRICAL_FAULT: "Electrical fault",
    DowntimeCategory.UNDER_REPAIR: "Under repair",
    DowntimeCategory.WAITING_FOR_PARTS: "Waiting for parts",
    DowntimeCategory.SCHEDULED_MAINTENANCE: "Scheduled maintenance",
    DowntimeCategory.OTHER: "Other",
}


class OperationTimeLog(db.Model):
    __tablename__ = "operation_time_logs"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    operation_id = db.Column(
        db.String(36),
        db.ForeignKey("operations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    worker_id = db.Column(
        db.String(36), db.ForeignKey("users.id"), nullable=False, index=True
    )
    event = db.Column(db.Enum(OperationTimeEvent), nullable=False)
    event_at = db.Column(db.DateTime(timezone=True), nullable=False)
    reason = db.Column(db.Enum(OperationPauseReason), nullable=True)
    note = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow)

    operation = db.relationship(
        "JobOperation", back_populates="time_logs"
    )
    worker = db.relationship("User", foreign_keys=[worker_id])

    def to_dict(self):
        return {
            "id": self.id,
            "operationId": self.operation_id,
            "workerId": self.worker_id,
            "workerName": self.worker.full_name if self.worker else None,
            "event": self.event.value if self.event else None,
            "eventAt": self.event_at.isoformat() if self.event_at else None,
            "reason": self.reason.value if self.reason else None,
            "note": self.note,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class MachineDowntime(db.Model):
    __tablename__ = "machine_downtimes"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    machine_unit_id = db.Column(
        db.String(36),
        db.ForeignKey("machine_units.id"),
        nullable=False,
        index=True,
    )
    started_at = db.Column(db.DateTime(timezone=True), nullable=False)
    ended_at = db.Column(db.DateTime(timezone=True), nullable=True)
    category = db.Column(db.Enum(DowntimeCategory), nullable=False)
    reason = db.Column(db.String(255), nullable=False)
    reported_by_id = db.Column(
        db.String(36), db.ForeignKey("users.id"), nullable=False
    )
    job_order_id = db.Column(
        db.String(36),
        db.ForeignKey("job_orders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    operation_id = db.Column(
        db.String(36),
        db.ForeignKey("operations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    note = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow)

    machine_unit = db.relationship("MachineUnit", back_populates="downtimes")
    reported_by = db.relationship("User", foreign_keys=[reported_by_id])
    operation = db.relationship("JobOperation", foreign_keys=[operation_id])

    def to_dict(self):
        return {
            "id": self.id,
            "machineUnitId": self.machine_unit_id,
            "machineUnitLabel": self.machine_unit.label if self.machine_unit else None,
            "startedAt": self.started_at.isoformat() if self.started_at else None,
            "endedAt": self.ended_at.isoformat() if self.ended_at else None,
            "category": self.category.value if self.category else None,
            "reason": self.reason,
            "jobOrderId": self.job_order_id,
            "operationId": self.operation_id,
            "operationName": self.operation.operation_name if self.operation else None,
            "reportedById": self.reported_by_id,
            "reportedByName": self.reported_by.full_name if self.reported_by else None,
            "note": self.note,
            "open": self.ended_at is None,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }
