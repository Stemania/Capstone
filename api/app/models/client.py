import uuid
from datetime import datetime, timezone

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


class Client(db.Model):
    __tablename__ = "clients"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    name = db.Column(db.String(255), nullable=False, index=True)
    contact = db.Column(db.String(255), nullable=True)
    email = db.Column(db.String(255), nullable=True)
    mobile_number = db.Column(db.String(32), nullable=True)
    notify_by_email = db.Column(db.Boolean, nullable=False, default=False)
    notify_by_sms = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow)

    job_orders = db.relationship("JobOrder", back_populates="client")
    notification_logs = db.relationship("NotificationLog", back_populates="client")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "contact": self.contact,
            "email": self.email,
            "mobileNumber": self.mobile_number,
            "notifyByEmail": bool(self.notify_by_email),
            "notifyBySms": bool(self.notify_by_sms),
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }
