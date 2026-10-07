"""Shop-wide settings kept in a single row (id = 1)."""

from datetime import datetime, time, timezone

from app.extensions import db

DEFAULT_BREAK_START = time(12, 0)
DEFAULT_BREAK_END = time(13, 0)


def _utcnow():
    return datetime.now(timezone.utc)


class ShopSettings(db.Model):
    __tablename__ = "shop_settings"

    id = db.Column(db.Integer, primary_key=True)
    # Daily break on every working day; never working time.
    break_start = db.Column(db.Time(), nullable=False, default=DEFAULT_BREAK_START)
    break_end = db.Column(db.Time(), nullable=False, default=DEFAULT_BREAK_END)
    updated_at = db.Column(db.DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)
    updated_by_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=True)

    def to_dict(self):
        return {
            "breakStart": self.break_start.strftime("%H:%M"),
            "breakEnd": self.break_end.strftime("%H:%M"),
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }
