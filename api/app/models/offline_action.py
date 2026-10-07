"""Receipts for worker actions recorded on the phone (offline sync).

The phone gives every action an id; the first time it is processed a receipt
is kept, so the same action sent again (reply lost, resent after sign-in)
returns the earlier result instead of being recorded twice.
"""

from datetime import datetime, timezone

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


class OfflineActionReceipt(db.Model):
    __tablename__ = "offline_action_receipts"

    client_action_id = db.Column(db.String(64), primary_key=True)
    user_id = db.Column(
        db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    action = db.Column(db.String(32), nullable=False)
    # Operation id, or the machine downtime id for a breakdown report.
    result_id = db.Column(db.String(36), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)
