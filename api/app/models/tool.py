import enum
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


class ToolCategory(enum.Enum):
    RETURNABLE_TOOL = "RETURNABLE_TOOL"
    CONSUMABLE = "CONSUMABLE"


class Tool(db.Model):
    """
    Inventory item TYPE (one QR per type), not a single physical piece.
    Table name remains `tools` for migration simplicity.
    """

    __tablename__ = "tools"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    name = db.Column(db.String(255), nullable=False, index=True)
    code = db.Column(db.String(100), unique=True, nullable=False, index=True)
    category = db.Column(
        db.Enum(ToolCategory),
        nullable=False,
        default=ToolCategory.RETURNABLE_TOOL,
        index=True,
    )
    unit = db.Column(db.String(32), nullable=False, default="pcs")
    quantity_on_hand = db.Column(
        db.Numeric(12, 2), nullable=False, default=Decimal("0")
    )
    minimum_stock = db.Column(db.Numeric(12, 2), nullable=True)
    size_spec = db.Column(db.String(64), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow)

    events = db.relationship(
        "ToolEvent",
        back_populates="tool",
        order_by="ToolEvent.created_at.desc()",
    )

    @property
    def low_stock(self) -> bool:
        if self.minimum_stock is None:
            return False
        return Decimal(str(self.quantity_on_hand or 0)) <= Decimal(
            str(self.minimum_stock)
        )

    def to_dict(self, include_custody=False, worker_id=None):
        data = {
            "id": self.id,
            "name": self.name,
            "code": self.code,
            "category": self.category.value if self.category else None,
            "unit": self.unit,
            "quantityOnHand": _num(self.quantity_on_hand),
            "minimumStock": _num(self.minimum_stock),
            "sizeSpec": self.size_spec,
            "lowStock": self.low_stock,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }
        if include_custody:
            from app.services.tool_event_service import (
                get_current_custody,
                list_outstanding_holders,
                worker_outstanding_quantity,
            )

            # Legacy single-holder field: first outstanding holder, if any
            holders = list_outstanding_holders(self.id)
            data["holders"] = holders
            data["custody"] = get_current_custody(self.id)
            if worker_id:
                data["myOutstanding"] = _num(
                    worker_outstanding_quantity(self.id, worker_id)
                )
        return data
