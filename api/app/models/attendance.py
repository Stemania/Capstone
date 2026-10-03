"""Worker attendance recorded by the Administrator (one record per worker per shop day)."""

import uuid
from datetime import datetime, timezone

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


class AttendanceRecord(db.Model):
    __tablename__ = "attendance_records"
    __table_args__ = (
        db.UniqueConstraint("worker_id", "work_date", name="uq_attendance_worker_day"),
    )

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    worker_id = db.Column(
        db.String(36), db.ForeignKey("users.id"), nullable=False, index=True
    )
    # Shop-local calendar date of the clock-in.
    work_date = db.Column(db.Date(), nullable=False, index=True)
    clock_in = db.Column(db.DateTime(timezone=True), nullable=False)
    clock_out = db.Column(db.DateTime(timezone=True), nullable=True)
    note = db.Column(db.Text, nullable=True)
    recorded_by_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False)
    updated_by_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow)
    updated_at = db.Column(db.DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    worker = db.relationship("User", foreign_keys=[worker_id])
    recorded_by = db.relationship("User", foreign_keys=[recorded_by_id])
    updated_by = db.relationship("User", foreign_keys=[updated_by_id])

    @property
    def hours_worked(self):
        if not self.clock_out:
            return None
        return round((self.clock_out - self.clock_in).total_seconds() / 3600, 2)

    def to_dict(self):
        return {
            "id": self.id,
            "workerId": self.worker_id,
            "workerName": self.worker.full_name if self.worker else None,
            "workDate": self.work_date.isoformat(),
            "clockIn": self.clock_in.isoformat(),
            "clockOut": self.clock_out.isoformat() if self.clock_out else None,
            "hoursWorked": self.hours_worked,
            "note": self.note,
            "recordedByName": self.recorded_by.full_name if self.recorded_by else None,
            "updatedByName": self.updated_by.full_name if self.updated_by else None,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }
