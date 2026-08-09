import enum
import uuid

from app.extensions import db


def _uuid():
    return str(uuid.uuid4())


class MachineType(db.Model):
    __tablename__ = "machine_types"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    code = db.Column(db.String(32), unique=True, nullable=False, index=True)
    name = db.Column(db.String(100), nullable=False)
    units = db.Column(db.Integer, nullable=False, default=1)

    machine_units = db.relationship(
        "MachineUnit",
        back_populates="machine_type",
        cascade="all, delete-orphan",
        order_by="MachineUnit.label",
    )
    operations = db.relationship("JobOperation", back_populates="machine_type")

    def to_dict(self):
        return {
            "id": self.id,
            "code": self.code,
            "name": self.name,
            "units": self.units,
        }


class MachineUnit(db.Model):
    __tablename__ = "machine_units"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    machine_type_id = db.Column(
        db.String(36),
        db.ForeignKey("machine_types.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    label = db.Column(db.String(64), nullable=False)
    active = db.Column(db.Boolean, nullable=False, default=True)

    machine_type = db.relationship("MachineType", back_populates="machine_units")
    operations = db.relationship("JobOperation", back_populates="machine_unit")

    def to_dict(self):
        return {
            "id": self.id,
            "machineTypeId": self.machine_type_id,
            "label": self.label,
            "active": self.active,
            "machineTypeCode": self.machine_type.code if self.machine_type else None,
            "machineTypeName": self.machine_type.name if self.machine_type else None,
        }
