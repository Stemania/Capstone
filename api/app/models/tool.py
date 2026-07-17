import uuid
from datetime import datetime, timezone

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


class Tool(db.Model):
    __tablename__ = "tools"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    name = db.Column(db.String(255), nullable=False, index=True)
    code = db.Column(db.String(100), unique=True, nullable=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow)

    events = db.relationship(
        "ToolEvent",
        back_populates="tool",
        order_by="ToolEvent.created_at.desc()",
    )

    def to_dict(self, include_custody=False):
        data = {
            "id": self.id,
            "name": self.name,
            "code": self.code,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }
        if include_custody:
            from app.services.tool_event_service import get_current_custody

            data["custody"] = get_current_custody(self.id)
        return data
