"""Periodic consumable stock counts (office inventory)."""

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


def _num(v):
    if v is None:
        return None
    return float(v)


class Stocktake(db.Model):
    __tablename__ = "stocktakes"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    counted_on = db.Column(db.Date, nullable=False, index=True)
    counted_by_id = db.Column(
        db.String(36), db.ForeignKey("users.id"), nullable=False, index=True
    )
    notes = db.Column(db.String(500), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)

    counted_by = db.relationship("User")
    lines = db.relationship(
        "StocktakeLine",
        back_populates="stocktake",
        cascade="all, delete-orphan",
        order_by="StocktakeLine.tool_id",
    )

    def to_dict(self, include_lines=False):
        data = {
            "id": self.id,
            "countedOn": self.counted_on.isoformat() if self.counted_on else None,
            "countedById": self.counted_by_id,
            "countedByName": self.counted_by.full_name if self.counted_by else None,
            "notes": self.notes,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "lineCount": len(self.lines) if self.lines is not None else 0,
        }
        if include_lines:
            data["lines"] = [ln.to_dict() for ln in self.lines]
        return data


class StocktakeLine(db.Model):
    __tablename__ = "stocktake_lines"
    __table_args__ = (
        db.UniqueConstraint("stocktake_id", "tool_id", name="uq_stocktake_line_tool"),
        db.Index("ix_stocktake_line_tool", "tool_id"),
    )

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    stocktake_id = db.Column(
        db.String(36), db.ForeignKey("stocktakes.id", ondelete="CASCADE"), nullable=False
    )
    tool_id = db.Column(
        db.String(36), db.ForeignKey("tools.id"), nullable=False, index=True
    )
    previous_quantity = db.Column(db.Numeric(12, 2), nullable=False, default=Decimal("0"))
    counted_quantity = db.Column(db.Numeric(12, 2), nullable=False, default=Decimal("0"))

    stocktake = db.relationship("Stocktake", back_populates="lines")
    tool = db.relationship("Tool")

    def to_dict(self):
        tool = self.tool
        return {
            "id": self.id,
            "stocktakeId": self.stocktake_id,
            "toolId": self.tool_id,
            "toolName": tool.name if tool else None,
            "toolCode": tool.code if tool else None,
            "unit": tool.unit if tool else None,
            "sizeSpec": tool.size_spec if tool else None,
            "previousQuantity": _num(self.previous_quantity),
            "countedQuantity": _num(self.counted_quantity),
            "delta": _num(
                Decimal(str(self.counted_quantity or 0))
                - Decimal(str(self.previous_quantity or 0))
            ),
        }
