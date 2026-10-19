"""Shared DB-backed auth rate-limit counters (safe across gunicorn workers)."""

from datetime import datetime, timezone

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


class RateLimitCounter(db.Model):
    """One row per rate-limit key; windows roll forward in place."""

    __tablename__ = "rate_limit_counters"

    key = db.Column(db.String(255), primary_key=True)
    window_start = db.Column(db.DateTime(timezone=True), nullable=False, default=_utcnow)
    count = db.Column(db.Integer, nullable=False, default=0)
