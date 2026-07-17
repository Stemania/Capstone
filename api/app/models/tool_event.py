import enum
import uuid
from datetime import datetime, timezone

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


class ToolEventType(enum.Enum):
    BORROW = "BORROW"
    RETURN = "RETURN"


class ToolEvent(db.Model):
    __tablename__ = "tool_events"
    __table_args__ = (db.Index("ix_tool_event_tool_created", "tool_id", "created_at"),)

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    tool_id = db.Column(
        db.String(36), db.ForeignKey("tools.id"), nullable=False, index=True
    )
    worker_id = db.Column(
        db.String(36), db.ForeignKey("users.id"), nullable=False, index=True
    )
    type = db.Column(db.Enum(ToolEventType), nullable=False)
    job_order_id = db.Column(
        db.String(36), db.ForeignKey("job_orders.id"), nullable=True
    )
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)

    tool = db.relationship("Tool", back_populates="events")
    worker = db.relationship("User", back_populates="tool_events")
    job_order = db.relationship("JobOrder", back_populates="tool_events")

    def to_dict(self):
        return {
            "id": self.id,
            "toolId": self.tool_id,
            "toolName": self.tool.name if self.tool else None,
            "toolCode": self.tool.code if self.tool else None,
            "workerId": self.worker_id,
            "workerName": self.worker.full_name if self.worker else None,
            "type": self.type.value,
            "jobOrderId": self.job_order_id,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }
