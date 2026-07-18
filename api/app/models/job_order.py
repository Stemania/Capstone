import enum
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.dialects.postgresql import JSONB

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


class JobPriority(enum.Enum):
    HIGH = "HIGH"
    MODERATE = "MODERATE"
    LOW = "LOW"


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
    priority = db.Column(
        db.Enum(JobPriority), nullable=False, default=JobPriority.MODERATE, index=True
    )
    quantity = db.Column(db.Numeric(12, 2), nullable=True)
    unit_of_measure = db.Column(db.String(32), nullable=True)
    amount = db.Column(db.Numeric(14, 2), nullable=True)
    # [{ "name": "Mild steel plate", "quantity": 2, "unit": "pcs" }, ...]
    raw_materials = db.Column(JSONB, nullable=False, default=list)
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
        ops = list(self.operations or [])
        completed = sum(1 for op in ops if op.status.value == "COMPLETED")
        next_op = next((op for op in ops if op.status.value != "COMPLETED"), None)
        year = self.created_at.year if self.created_at else datetime.now(timezone.utc).year
        short = (self.id or "")[:4].upper()

        def _num(v):
            if v is None:
                return None
            return float(v) if isinstance(v, Decimal) else float(v)

        data = {
            "id": self.id,
            "jobNumber": f"JO-{year}-{short}",
            "clientId": self.client_id,
            "clientName": self.client.name if self.client else None,
            "title": self.title,
            "description": self.description,
            "dueDate": self.due_date.isoformat() if self.due_date else None,
            "status": self.status.value,
            "priority": self.priority.value if self.priority else JobPriority.MODERATE.value,
            "quantity": _num(self.quantity),
            "unitOfMeasure": self.unit_of_measure,
            "amount": _num(self.amount),
            "rawMaterials": self.raw_materials or [],
            "assignedWorkerId": self.assigned_worker_id,
            "assignedWorkerName": (
                self.assigned_worker.full_name if self.assigned_worker else None
            ),
            "createdById": self.created_by_id,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "opsCompleted": completed,
            "opsTotal": len(ops),
            "nextOperation": next_op.name if next_op else None,
        }
        if include_operations:
            data["operations"] = [op.to_dict() for op in ops]
        return data
