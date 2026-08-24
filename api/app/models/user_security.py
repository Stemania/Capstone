"""User invitation and device PIN models."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


class InvitationChannel(enum.Enum):
    EMAIL = "EMAIL"
    SMS = "SMS"


class UserInvitation(db.Model):
    __tablename__ = "user_invitations"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    token_hash = db.Column(db.String(255), unique=True, nullable=False, index=True)
    channel = db.Column(db.Enum(InvitationChannel), nullable=False)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)
    used_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_by_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow)
    revoked_at = db.Column(db.DateTime(timezone=True), nullable=True)

    user = db.relationship("User", foreign_keys=[user_id], backref="invitations")
    created_by = db.relationship("User", foreign_keys=[created_by_id])

    @property
    def is_active(self) -> bool:
        if self.used_at is not None or self.revoked_at is not None:
            return False
        exp = self.expires_at
        if exp is None:
            return False
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        return exp > _utcnow()

    def to_dict(self):
        return {
            "id": self.id,
            "userId": self.user_id,
            "channel": self.channel.value if self.channel else None,
            "expiresAt": self.expires_at.isoformat() if self.expires_at else None,
            "usedAt": self.used_at.isoformat() if self.used_at else None,
            "revokedAt": self.revoked_at.isoformat() if self.revoked_at else None,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "active": self.is_active,
        }


class UserDevice(db.Model):
    __tablename__ = "user_devices"
    __table_args__ = (
        db.UniqueConstraint("user_id", "device_id", name="uq_user_devices_user_device"),
    )

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    device_id = db.Column(db.String(36), nullable=False, index=True)
    device_label = db.Column(db.String(255), nullable=True)
    pin_hash = db.Column(db.String(255), nullable=True)
    pin_set_at = db.Column(db.DateTime(timezone=True), nullable=True)
    pin_failed_attempts = db.Column(db.Integer, nullable=False, default=0)
    last_used_at = db.Column(db.DateTime(timezone=True), nullable=True)
    revoked_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow)

    user = db.relationship("User", backref="devices")

    @property
    def is_revoked(self) -> bool:
        return self.revoked_at is not None

    @property
    def has_pin(self) -> bool:
        return bool(self.pin_hash) and not self.is_revoked

    def to_dict(self):
        return {
            "id": self.id,
            "userId": self.user_id,
            "deviceId": self.device_id,
            "deviceLabel": self.device_label,
            "hasPin": self.has_pin,
            "pinSetAt": self.pin_set_at.isoformat() if self.pin_set_at else None,
            "lastUsedAt": self.last_used_at.isoformat() if self.last_used_at else None,
            "revokedAt": self.revoked_at.isoformat() if self.revoked_at else None,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }
