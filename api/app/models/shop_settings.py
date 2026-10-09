"""Shop-wide settings kept in a single row (id = 1)."""

from datetime import datetime, time, timezone

from app.extensions import db

DEFAULT_BREAK_START = time(12, 0)
DEFAULT_BREAK_END = time(13, 0)

# Shop details printed on purchase orders and job orders.
SHOP_DETAIL_DEFAULTS = {
    "shop_name": "BROTHERS MACHINE SHOP and SERVICES CORP.",
    "tagline": (
        "Industrial, Electrical and Engineering Works, Plastic & Metal Fabrication, "
        "General Services"
    ),
    "address": "J.P. Laurel National Highway, San Pioquinto, Malvar, Batangas",
    "telephone": "(043) 4303524",
    "mobile_numbers": "09260056680 / 09157859720",
    "email": "brothersmachining@yahoo.com",
    "po_approver_name": "GREGORIO AGAO JR.",
    "po_approver_title": "General Manager",
    "jo_approver_name": "GARY AGAO",
    "jo_approver_title": "Production Head",
}

SHOP_DETAIL_FIELDS = {
    "shopName": "shop_name",
    "tagline": "tagline",
    "address": "address",
    "telephone": "telephone",
    "mobileNumbers": "mobile_numbers",
    "email": "email",
    "poApproverName": "po_approver_name",
    "poApproverTitle": "po_approver_title",
    "joApproverName": "jo_approver_name",
    "joApproverTitle": "jo_approver_title",
}


def _utcnow():
    return datetime.now(timezone.utc)


class ShopSettings(db.Model):
    __tablename__ = "shop_settings"

    id = db.Column(db.Integer, primary_key=True)
    # Daily break on every working day; never working time.
    break_start = db.Column(db.Time(), nullable=False, default=DEFAULT_BREAK_START)
    break_end = db.Column(db.Time(), nullable=False, default=DEFAULT_BREAK_END)
    shop_name = db.Column(db.String(255), nullable=True)
    tagline = db.Column(db.String(500), nullable=True)
    address = db.Column(db.String(500), nullable=True)
    telephone = db.Column(db.String(100), nullable=True)
    mobile_numbers = db.Column(db.String(200), nullable=True)
    email = db.Column(db.String(255), nullable=True)
    po_approver_name = db.Column(db.String(255), nullable=True)
    po_approver_title = db.Column(db.String(255), nullable=True)
    jo_approver_name = db.Column(db.String(255), nullable=True)
    jo_approver_title = db.Column(db.String(255), nullable=True)
    updated_at = db.Column(db.DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)
    updated_by_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=True)

    def to_dict(self):
        return {
            "breakStart": self.break_start.strftime("%H:%M"),
            "breakEnd": self.break_end.strftime("%H:%M"),
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }

    def shop_details_dict(self):
        """Blank fields fall back to the shop's defaults so printouts never
        come out without a letterhead."""
        data = {
            key: (getattr(self, attr) or SHOP_DETAIL_DEFAULTS[attr])
            for key, attr in SHOP_DETAIL_FIELDS.items()
        }
        data["updatedAt"] = self.updated_at.isoformat() if self.updated_at else None
        return data
