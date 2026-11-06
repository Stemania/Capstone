"""Consumables bought for the shop: the history the replenishment forecast reads.

Most consumables are bought without a purchase order (cash at a hardware
store), so the Office Staff record each purchase here. Consumables bought on a
supplier order are read from its received lines instead and are not copied.
No stock is counted: what was bought, when, and for how much is enough to
forecast when each item is bought next.
"""

import uuid
from datetime import datetime, timezone

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


class ConsumablePurchase(db.Model):
    __tablename__ = "consumable_purchases"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    tool_id = db.Column(db.String(36), db.ForeignKey("tools.id"), nullable=False, index=True)
    purchased_on = db.Column(db.Date, nullable=False, index=True)
    quantity = db.Column(db.Numeric(12, 2), nullable=False)
    # The item's unit when it was bought, so a later unit change does not rewrite history.
    unit = db.Column(db.String(32), nullable=False)
    unit_cost = db.Column(db.Numeric(14, 4), nullable=True)
    # Free text: most purchases are from stores that are not suppliers in the system.
    bought_from = db.Column(db.String(120), nullable=True)
    note = db.Column(db.String(255), nullable=True)
    recorded_by_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)
    # A purchase recorded by mistake is removed by voiding it; the row stays for the audit trail.
    voided_at = db.Column(db.DateTime(timezone=True), nullable=True)
    voided_by_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=True)

    tool = db.relationship("Tool")
    recorded_by = db.relationship("User", foreign_keys=[recorded_by_id])

    def to_dict(self):
        cost = float(self.unit_cost) if self.unit_cost is not None else None
        qty = float(self.quantity)
        return {
            "id": self.id,
            "source": "RECORDED",
            "toolId": self.tool_id,
            "name": self.tool.name if self.tool else None,
            "purchasedOn": self.purchased_on.isoformat(),
            "quantity": qty,
            "unit": self.unit,
            "unitCost": cost,
            "amount": round(qty * cost, 2) if cost is not None else None,
            "boughtFrom": self.bought_from,
            "note": self.note,
            "poNumber": None,
            "recordedBy": self.recorded_by.full_name if self.recorded_by else None,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }
