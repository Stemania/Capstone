import uuid

from app.extensions import db


def _uuid():
    return str(uuid.uuid4())


class WorkerProfile(db.Model):
    __tablename__ = "worker_profiles"
    __table_args__ = (
        # Matches migration 001 unique index name (not an unnamed UniqueConstraint).
        db.Index("ix_worker_profiles_user_id", "user_id", unique=True),
    )

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    user_id = db.Column(
        db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    user = db.relationship("User", back_populates="worker_profile")

    def to_dict(self):
        skills = []
        if self.user and self.user.skills:
            skills = [s.to_dict() for s in self.user.skills]
        return {
            "id": self.id,
            "userId": self.user_id,
            "skills": skills,
            "fullName": self.user.full_name if self.user else None,
            "email": self.user.email if self.user else None,
        }
