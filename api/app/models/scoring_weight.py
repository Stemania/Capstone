import uuid
from datetime import datetime, timezone
from decimal import Decimal

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


DEFAULT_SCORING_WEIGHTS = {
    "skill": Decimal("0.40"),
    "availability": Decimal("0.30"),
    "workload": Decimal("0.20"),
    "efficiency": Decimal("0.10"),
}


class ScoringWeight(db.Model):
    __tablename__ = "scoring_weights"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    key = db.Column(db.String(32), unique=True, nullable=False, index=True)
    value = db.Column(db.Numeric(5, 4), nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    def to_dict(self):
        return {
            "id": self.id,
            "key": self.key,
            "value": float(self.value) if self.value is not None else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }
