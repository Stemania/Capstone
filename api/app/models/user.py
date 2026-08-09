import enum
import uuid
from datetime import datetime, timezone

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


class UserRole(enum.Enum):
    ADMIN = "ADMIN"
    OFFICE_STAFF = "OFFICE_STAFF"
    PRODUCTION_WORKER = "PRODUCTION_WORKER"


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    full_name = db.Column(db.String(255), nullable=False)
    role = db.Column(db.Enum(UserRole), nullable=False, index=True)
    active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    worker_profile = db.relationship(
        "WorkerProfile", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    skills = db.relationship(
        "WorkerSkill",
        back_populates="worker",
        cascade="all, delete-orphan",
        order_by="WorkerSkill.is_primary.desc()",
    )
    schedules = db.relationship(
        "WorkerSchedule",
        back_populates="worker",
        cascade="all, delete-orphan",
        order_by="WorkerSchedule.day_of_week",
    )
    created_job_orders = db.relationship(
        "JobOrder", back_populates="created_by", foreign_keys="JobOrder.created_by_id"
    )
    assigned_operations = db.relationship(
        "JobOperation",
        back_populates="assigned_worker",
        foreign_keys="JobOperation.assigned_worker_id",
    )
    tool_events = db.relationship("ToolEvent", back_populates="worker")

    def to_dict(self, include_profile=False, include_skills=False, include_schedule=False):
        data = {
            "id": self.id,
            "email": self.email,
            "fullName": self.full_name,
            "role": self.role.value,
            "active": self.active,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }
        if include_profile and self.worker_profile:
            data["workerProfile"] = self.worker_profile.to_dict()
        elif include_profile and self.role == UserRole.PRODUCTION_WORKER:
            data["workerProfile"] = {
                "id": None,
                "userId": self.id,
                "skills": [s.to_dict() for s in (self.skills or [])],
                "fullName": self.full_name,
                "email": self.email,
            }
        if include_skills:
            data["skills"] = [s.to_dict() for s in (self.skills or [])]
        if include_schedule:
            data["schedules"] = [s.to_dict() for s in (self.schedules or [])]
        return data
