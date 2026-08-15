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
    # Internal planning (not client-facing; workers must not see these)
    DRAFT = "DRAFT"
    PLANNING = "PLANNING"
    RELEASED = "RELEASED"
    # Production floor (existing chain)
    UNASSIGNED = "UNASSIGNED"
    ASSIGNED = "ASSIGNED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    DELIVERED = "DELIVERED"


# Sticky internal states — not derived from operation progress.
PLANNING_STATUSES = frozenset({JobOrderStatus.DRAFT, JobOrderStatus.PLANNING})

# Workers may only see jobs at RELEASED or later.
PRODUCTION_VISIBLE_STATUSES = frozenset(
    {
        JobOrderStatus.RELEASED,
        JobOrderStatus.UNASSIGNED,
        JobOrderStatus.ASSIGNED,
        JobOrderStatus.IN_PROGRESS,
        JobOrderStatus.COMPLETED,
        JobOrderStatus.DELIVERED,
    }
)


class JobPriority(enum.Enum):
    HIGH = "HIGH"
    MODERATE = "MODERATE"
    LOW = "LOW"


class JobType(enum.Enum):
    FABRICATION = "FABRICATION"
    MODIFICATION = "MODIFICATION"
    REPAIR = "REPAIR"


class MaterialSource(enum.Enum):
    SHOP_PROCURED = "SHOP_PROCURED"
    CLIENT_SUPPLIED = "CLIENT_SUPPLIED"


class PartCondition(enum.Enum):
    RAW_MATERIAL = "RAW_MATERIAL"
    CLIENT_SUPPLIED_ITEM = "CLIENT_SUPPLIED_ITEM"
    BLANK = "BLANK"
    WORK_IN_PROCESS = "WORK_IN_PROCESS"
    MACHINED = "MACHINED"
    HEAT_TREATED = "HEAT_TREATED"
    FINISHED = "FINISHED"


class JobOrder(db.Model):
    __tablename__ = "job_orders"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    client_id = db.Column(
        db.String(36), db.ForeignKey("clients.id"), nullable=False, index=True
    )
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    # Client PO "date required" — reused; do not add a separate date_required column.
    due_date = db.Column(db.Date, nullable=False, index=True)
    client_po_number = db.Column(db.String(100), nullable=True)
    po_date = db.Column(db.Date, nullable=True)
    status = db.Column(
        db.Enum(JobOrderStatus), nullable=False, default=JobOrderStatus.DRAFT, index=True
    )
    priority = db.Column(
        db.Enum(JobPriority), nullable=False, default=JobPriority.MODERATE, index=True
    )
    job_type = db.Column(
        db.Enum(JobType), nullable=False, default=JobType.FABRICATION, index=True
    )
    material_source = db.Column(
        db.Enum(MaterialSource),
        nullable=False,
        default=MaterialSource.SHOP_PROCURED,
    )
    part_condition = db.Column(
        db.Enum(PartCondition),
        nullable=False,
        default=PartCondition.RAW_MATERIAL,
        index=True,
    )
    quantity = db.Column(db.Numeric(12, 2), nullable=True)
    unit_of_measure = db.Column(db.String(32), nullable=True)
    amount = db.Column(db.Numeric(14, 2), nullable=True)
    # [{ "name": "Mild steel plate", "quantity": 2, "unit": "pcs" }, ...]
    raw_materials = db.Column(JSONB, nullable=False, default=list)
    created_by_id = db.Column(
        db.String(36), db.ForeignKey("users.id"), nullable=False
    )
    delivered_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    client = db.relationship("Client", back_populates="job_orders")
    created_by = db.relationship(
        "User", back_populates="created_job_orders", foreign_keys=[created_by_id]
    )
    operations = db.relationship(
        "JobOperation",
        back_populates="job_order",
        cascade="all, delete-orphan",
        order_by="JobOperation.sequence_no",
    )
    tool_events = db.relationship("ToolEvent", back_populates="job_order")
    notification_logs = db.relationship("NotificationLog", back_populates="job_order")

    def to_dict(self, include_operations=False):
        from app.models.operation import OperationStatus

        ops = list(self.operations or [])
        completed = sum(1 for op in ops if op.status == OperationStatus.COMPLETED)
        next_op = next(
            (op for op in ops if op.status != OperationStatus.COMPLETED),
            None,
        )
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
            "clientPoNumber": self.client_po_number,
            "poDate": self.po_date.isoformat() if self.po_date else None,
            "status": self.status.value,
            "priority": self.priority.value if self.priority else JobPriority.MODERATE.value,
            "jobType": self.job_type.value if self.job_type else JobType.FABRICATION.value,
            "materialSource": (
                self.material_source.value
                if self.material_source
                else MaterialSource.SHOP_PROCURED.value
            ),
            "partCondition": (
                self.part_condition.value
                if self.part_condition
                else PartCondition.RAW_MATERIAL.value
            ),
            "quantity": _num(self.quantity),
            "unitOfMeasure": self.unit_of_measure,
            "amount": _num(self.amount),
            "rawMaterials": self.raw_materials or [],
            "createdById": self.created_by_id,
            "deliveredAt": self.delivered_at.isoformat() if self.delivered_at else None,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "opsCompleted": completed,
            "opsTotal": len(ops),
            "nextOperation": next_op.operation_name if next_op else None,
            "nextOperationWorkerId": next_op.assigned_worker_id if next_op else None,
            "nextOperationWorkerName": (
                next_op.assigned_worker.full_name
                if next_op and next_op.assigned_worker
                else None
            ),
        }
        if include_operations:
            data["operations"] = [op.to_dict() for op in ops]
        scheduled_ends = [op.scheduled_end for op in ops if op.scheduled_end]
        if scheduled_ends:
            from app.services.schedule_service import compute_schedule_flag

            projected = max(scheduled_ends)
            data["projectedCompletion"] = projected.isoformat()
            data["scheduleFlag"] = compute_schedule_flag(projected, self.due_date)
        else:
            data["projectedCompletion"] = None
            data["scheduleFlag"] = None
        return data
