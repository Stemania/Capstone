import enum
import uuid
from datetime import datetime, timezone

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


class JobOrderStatus(enum.Enum):
    UNASSIGNED = "UNASSIGNED"
    ASSIGNED = "ASSIGNED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"


class JobOrder(db.Model):
    __tablename__ = "job_orders"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    client_id = db.Column(
        db.String(36), db.ForeignKey("clients.id"), nullable=False, index=True
    )
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    due_date = db.Column(db.Date, nullable=False, index=True)
    status = db.Column(
        db.Enum(JobOrderStatus), nullable=False, default=JobOrderStatus.UNASSIGNED, index=True
    )
    assigned_worker_id = db.Column(
        db.String(36), db.ForeignKey("users.id"), nullable=True, index=True
    )
    created_by_id = db.Column(
        db.String(36), db.ForeignKey("users.id"), nullable=False
    )
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    client = db.relationship("Client", back_populates="job_orders")
    assigned_worker = db.relationship(
        "User", back_populates="assigned_job_orders", foreign_keys=[assigned_worker_id]
    )
    created_by = db.relationship(
        "User", back_populates="created_job_orders", foreign_keys=[created_by_id]
    )
    operations = db.relationship(
        "Operation",
        back_populates="job_order",
        cascade="all, delete-orphan",
        order_by="Operation.seq",
    )
    tool_events = db.relationship("ToolEvent", back_populates="job_order")

    def to_dict(self, include_operations=False):
        data = {
            "id": self.id,
            "clientId": self.client_id,
            "clientName": self.client.name if self.client else None,
            "title": self.title,
            "description": self.description,
            "dueDate": self.due_date.isoformat() if self.due_date else None,
            "status": self.status.value,
            "assignedWorkerId": self.assigned_worker_id,
            "assignedWorkerName": (
                self.assigned_worker.full_name if self.assigned_worker else None
            ),
            "createdById": self.created_by_id,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }
        if include_operations:
            data["operations"] = [op.to_dict() for op in self.operations]
        return data
