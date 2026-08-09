import uuid
from datetime import datetime, timezone

from sqlalchemy.dialects.postgresql import JSONB

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


class AuditLog(db.Model):
    __tablename__ = "audit_logs"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=True, index=True)
    user_role = db.Column(db.String(64), nullable=True)
    action = db.Column(db.String(32), nullable=False)  # CREATE | UPDATE | DELETE
    entity_type = db.Column(db.String(64), nullable=False, index=True)
    entity_id = db.Column(db.String(36), nullable=True, index=True)
    before_json = db.Column(JSONB, nullable=True)
    after_json = db.Column(JSONB, nullable=True)
    ip_address = db.Column(db.String(64), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, index=True)

    user = db.relationship("User")

    def to_dict(self):
        return {
            "id": self.id,
            "userId": self.user_id,
            "userRole": self.user_role,
            "action": self.action,
            "entityType": self.entity_type,
            "entityId": self.entity_id,
            "before": self.before_json,
            "after": self.after_json,
            "ipAddress": self.ip_address,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }
