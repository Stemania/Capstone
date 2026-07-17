import enum
import uuid

from app.extensions import db


def _uuid():
    return str(uuid.uuid4())


class OperationStatus(enum.Enum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"


class Operation(db.Model):
    __tablename__ = "operations"
    __table_args__ = (
        db.UniqueConstraint("job_order_id", "seq", name="uq_operation_job_seq"),
        db.Index("ix_operation_job_status", "job_order_id", "status"),
    )

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    job_order_id = db.Column(
        db.String(36),
        db.ForeignKey("job_orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    seq = db.Column(db.Integer, nullable=False)
    name = db.Column(db.String(255), nullable=False)
    status = db.Column(
        db.Enum(OperationStatus), nullable=False, default=OperationStatus.PENDING
    )
    started_at = db.Column(db.DateTime(timezone=True), nullable=True)
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    job_order = db.relationship("JobOrder", back_populates="operations")

    def to_dict(self):
        return {
            "id": self.id,
            "jobOrderId": self.job_order_id,
            "seq": self.seq,
            "name": self.name,
            "status": self.status.value,
            "startedAt": self.started_at.isoformat() if self.started_at else None,
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
        }
