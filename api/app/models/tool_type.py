"""Individual trackable tools (type + unit), mirroring machine_types / machine_units."""

import enum
import uuid
from datetime import datetime, timezone

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


class ToolUnitStatus(enum.Enum):
    AVAILABLE = "AVAILABLE"
    OUT = "OUT"
    UNDER_REPAIR = "UNDER_REPAIR"
    RETIRED = "RETIRED"


class ToolType(db.Model):
    __tablename__ = "tool_types"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    name = db.Column(db.String(255), nullable=False, index=True)
    code = db.Column(db.String(64), unique=True, nullable=False, index=True)
    description = db.Column(db.String(500), nullable=True)
    # Seed placeholder flag for client-pending real lists
    is_seed = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow)

    units = db.relationship(
        "ToolUnit",
        back_populates="tool_type",
        cascade="all, delete-orphan",
        order_by="ToolUnit.asset_code",
    )

    def to_dict(self, include_units=False):
        units = self.units or []
        available = sum(1 for u in units if u.status == ToolUnitStatus.AVAILABLE)
        out = sum(1 for u in units if u.status == ToolUnitStatus.OUT)
        data = {
            "id": self.id,
            "name": self.name,
            "code": self.code,
            "description": self.description,
            "isSeed": self.is_seed,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "totalUnits": len(units),
            "availableCount": available,
            "outCount": out,
            "repairCount": sum(
                1 for u in units if u.status == ToolUnitStatus.UNDER_REPAIR
            ),
            "retiredCount": sum(1 for u in units if u.status == ToolUnitStatus.RETIRED),
        }
        if include_units:
            data["units"] = [u.to_dict() for u in units]
        return data


class ToolUnit(db.Model):
    __tablename__ = "tool_units"
    __table_args__ = (
        db.UniqueConstraint("asset_code", name="uq_tool_unit_asset_code"),
        db.Index("ix_tool_units_type_status", "tool_type_id", "status"),
    )

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    tool_type_id = db.Column(
        db.String(36),
        db.ForeignKey("tool_types.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    asset_code = db.Column(db.String(100), nullable=False, index=True)
    status = db.Column(
        db.Enum(ToolUnitStatus),
        nullable=False,
        default=ToolUnitStatus.AVAILABLE,
        index=True,
    )
    notes = db.Column(db.String(500), nullable=True)
    current_holder_id = db.Column(
        db.String(36), db.ForeignKey("users.id"), nullable=True, index=True
    )
    held_since = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow)

    tool_type = db.relationship("ToolType", back_populates="units")
    current_holder = db.relationship("User", foreign_keys=[current_holder_id])
    events = db.relationship(
        "ToolEvent",
        back_populates="tool_unit",
        order_by="ToolEvent.created_at.desc()",
    )

    def to_dict(self):
        return {
            "id": self.id,
            "toolTypeId": self.tool_type_id,
            "toolTypeName": self.tool_type.name if self.tool_type else None,
            "toolTypeCode": self.tool_type.code if self.tool_type else None,
            "assetCode": self.asset_code,
            "status": self.status.value if self.status else None,
            "notes": self.notes,
            "currentHolderId": self.current_holder_id,
            "currentHolderName": (
                self.current_holder.full_name if self.current_holder else None
            ),
            "heldSince": self.held_since.isoformat() if self.held_since else None,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "isSeed": bool(self.tool_type.is_seed) if self.tool_type else False,
        }
