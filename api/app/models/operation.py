import enum
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


class OperationStatus(enum.Enum):
    PENDING = "PENDING"
    SCHEDULED = "SCHEDULED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    REWORK = "REWORK"


class JobOperation(db.Model):
    """Shop-floor operation step within a job order (table: operations)."""

    __tablename__ = "operations"
    __table_args__ = (
        db.UniqueConstraint("job_order_id", "sequence_no", name="uq_operation_job_seq"),
        db.Index("ix_operation_job_status", "job_order_id", "status"),
    )

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    job_order_id = db.Column(
        db.String(36),
        db.ForeignKey("job_orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sequence_no = db.Column(db.Integer, nullable=False)
    operation_name = db.Column(db.String(255), nullable=False)
    operation_type_id = db.Column(
        db.String(36),
        db.ForeignKey("operation_types.id"),
        nullable=True,
        index=True,
    )
    machine_type_id = db.Column(
        db.String(36),
        db.ForeignKey("machine_types.id"),
        nullable=True,
        index=True,
    )
    machine_unit_id = db.Column(
        db.String(36),
        db.ForeignKey("machine_units.id"),
        nullable=True,
        index=True,
    )
    assigned_worker_id = db.Column(
        db.String(36),
        db.ForeignKey("users.id"),
        nullable=True,
        index=True,
    )
    estimated_hours = db.Column(db.Numeric(8, 2), nullable=True)
    scheduled_start = db.Column(db.DateTime(timezone=True), nullable=True)
    scheduled_end = db.Column(db.DateTime(timezone=True), nullable=True)
    actual_start = db.Column(db.DateTime(timezone=True), nullable=True)
    actual_end = db.Column(db.DateTime(timezone=True), nullable=True)
    status = db.Column(
        db.Enum(OperationStatus), nullable=False, default=OperationStatus.PENDING
    )
    rework_of_operation_id = db.Column(
        db.String(36),
        db.ForeignKey("operations.id"),
        nullable=True,
        index=True,
    )
    notes = db.Column(db.Text, nullable=True)

    job_order = db.relationship("JobOrder", back_populates="operations")
    operation_type = db.relationship("OperationType", back_populates="operations")
    machine_type = db.relationship("MachineType", back_populates="operations")
    machine_unit = db.relationship("MachineUnit", back_populates="operations")
    assigned_worker = db.relationship(
        "User", back_populates="assigned_operations", foreign_keys=[assigned_worker_id]
    )
    rework_of = db.relationship(
        "JobOperation",
        remote_side=[id],
        foreign_keys=[rework_of_operation_id],
        backref="rework_children",
    )

    def to_dict(self):
        def _num(v):
            if v is None:
                return None
            return float(v) if isinstance(v, Decimal) else float(v)

        job = self.job_order
        return {
            "id": self.id,
            "jobOrderId": self.job_order_id,
            "jobTitle": job.title if job else None,
            "jobNumber": (
                f"JO-{(job.created_at.year if job and job.created_at else datetime.now(timezone.utc).year)}"
                f"-{(job.id or '')[:4].upper()}"
                if job
                else None
            ),
            "clientName": job.client.name if job and job.client else None,
            "dueDate": job.due_date.isoformat() if job and job.due_date else None,
            "jobPriority": job.priority.value if job and job.priority else None,
            "sequenceNo": self.sequence_no,
            "operationName": self.operation_name,
            "operationTypeId": self.operation_type_id,
            "operationTypeCode": self.operation_type.code if self.operation_type else None,
            "machineTypeId": self.machine_type_id,
            "machineTypeCode": self.machine_type.code if self.machine_type else None,
            "machineTypeName": self.machine_type.name if self.machine_type else None,
            "machineUnitId": self.machine_unit_id,
            "machineUnitLabel": self.machine_unit.label if self.machine_unit else None,
            "assignedWorkerId": self.assigned_worker_id,
            "assignedWorkerName": (
                self.assigned_worker.full_name if self.assigned_worker else None
            ),
            "estimatedHours": _num(self.estimated_hours),
            "scheduledStart": self.scheduled_start.isoformat() if self.scheduled_start else None,
            "scheduledEnd": self.scheduled_end.isoformat() if self.scheduled_end else None,
            "segments": self._derived_segments(),
            "actualStart": self.actual_start.isoformat() if self.actual_start else None,
            "actualEnd": self.actual_end.isoformat() if self.actual_end else None,
            # Back-compat aliases used by older worker UI
            "startedAt": self.actual_start.isoformat() if self.actual_start else None,
            "completedAt": self.actual_end.isoformat() if self.actual_end else None,
            "status": self.status.value,
            "reworkOfOperationId": self.rework_of_operation_id,
            "notes": self.notes,
            # Legacy-shaped fields for gradual UI migration
            "seq": self.sequence_no,
            "name": self.operation_name,
            "machinesNeeded": (
                [self.machine_type.code] if self.machine_type else []
            ),
            "machineNames": (
                [self.machine_type.name] if self.machine_type else []
            ),
        }

    def _derived_segments(self):
        if not self.scheduled_start or not self.scheduled_end or not self.assigned_worker_id:
            return []
        from app.services.schedule_calendar import (
            derive_working_segments,
            load_calendar_exceptions,
            load_worker_schedule_maps,
            serialize_segments,
            utc_to_shop,
        )

        start = self.scheduled_start
        end = self.scheduled_end
        schedule_by_dow = load_worker_schedule_maps(self.assigned_worker_id)
        exceptions = load_calendar_exceptions(
            utc_to_shop(start).date(), utc_to_shop(end).date()
        )
        return serialize_segments(
            derive_working_segments(start, end, schedule_by_dow, exceptions)
        )


# Alias for import churn during refactor
Operation = JobOperation
