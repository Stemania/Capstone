import enum
import uuid
from datetime import datetime, timezone

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


class NotificationMilestone(enum.Enum):
    JOB_RECEIVED = "JOB_RECEIVED"
    JOB_STARTED = "JOB_STARTED"
    JOB_COMPLETED = "JOB_COMPLETED"
    JOB_DELIVERED = "JOB_DELIVERED"


class NotificationChannel(enum.Enum):
    EMAIL = "EMAIL"
    SMS = "SMS"


class NotificationStatus(enum.Enum):
    PENDING = "PENDING"
    SENT = "SENT"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


class NotificationLog(db.Model):
    __tablename__ = "notification_logs"
    __table_args__ = (
        db.Index(
            "ix_notification_job_milestone_channel",
            "job_order_id",
            "milestone",
            "channel",
        ),
    )

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    job_order_id = db.Column(
        db.String(36), db.ForeignKey("job_orders.id"), nullable=False, index=True
    )
    client_id = db.Column(
        db.String(36), db.ForeignKey("clients.id"), nullable=False, index=True
    )
    milestone = db.Column(db.Enum(NotificationMilestone), nullable=False, index=True)
    channel = db.Column(db.Enum(NotificationChannel), nullable=False)
    recipient = db.Column(db.String(255), nullable=False)
    message_body = db.Column(db.Text, nullable=False)
    status = db.Column(db.Enum(NotificationStatus), nullable=False, index=True)
    error_message = db.Column(db.Text, nullable=True)
    sent_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)

    job_order = db.relationship("JobOrder", back_populates="notification_logs")
    client = db.relationship("Client", back_populates="notification_logs")

    def to_dict(self):
        year = None
        short = ""
        if self.job_order:
            year = (
                self.job_order.created_at.year
                if self.job_order.created_at
                else None
            )
            short = (self.job_order.id or "")[:4].upper()
        job_number = f"JO-{year}-{short}" if year else None
        return {
            "id": self.id,
            "jobOrderId": self.job_order_id,
            "jobNumber": job_number,
            "jobTitle": self.job_order.title if self.job_order else None,
            "clientId": self.client_id,
            "clientName": self.client.name if self.client else None,
            "milestone": self.milestone.value if self.milestone else None,
            "channel": self.channel.value if self.channel else None,
            "recipient": self.recipient,
            "messageBody": self.message_body,
            "status": self.status.value if self.status else None,
            "errorMessage": self.error_message,
            "sentAt": self.sent_at.isoformat() if self.sent_at else None,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }
