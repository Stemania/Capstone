"""Raw material suppliers (per purchase / job order, not stocked inventory)."""

import uuid
from datetime import datetime, timezone

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


SUPPLIER_CODE_PATTERN = r"^[A-Z]{2,5}$"


class Supplier(db.Model):
    __tablename__ = "suppliers"
    __table_args__ = (
        db.CheckConstraint(
            "code IS NULL OR code ~ '^[A-Z]{2,5}$'", name="ck_suppliers_code_format"
        ),
    )

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    name = db.Column(db.String(255), nullable=False, index=True)
    # Short code used in PO numbers (BMSC-PO-<code>-00001).
    code = db.Column(db.String(5), nullable=True, unique=True)
    contact_person = db.Column(db.String(255), nullable=True)
    phone = db.Column(db.String(64), nullable=True)
    email = db.Column(db.String(255), nullable=True)
    address = db.Column(db.Text, nullable=True)
    typical_lead_time_days = db.Column(db.Integer, nullable=True)
    notes = db.Column(db.Text, nullable=True)
    active = db.Column(db.Boolean, nullable=False, default=True, index=True)
    is_seed = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    job_orders = db.relationship("JobOrder", back_populates="supplier")
    material_purchases = db.relationship(
        "MaterialPurchase", back_populates="supplier"
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "code": self.code,
            "contactPerson": self.contact_person,
            "phone": self.phone,
            "email": self.email,
            "address": self.address,
            "typicalLeadTimeDays": self.typical_lead_time_days,
            "notes": self.notes,
            "active": bool(self.active),
            "isSeed": bool(self.is_seed),
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }
