"""Rows created by ``flask sample-history``, plus stock snapshots it must restore."""

from app.extensions import db
from sqlalchemy.dialects.postgresql import JSONB


class SampleRecord(db.Model):
    __tablename__ = "sample_records"
    __table_args__ = (
        db.UniqueConstraint(
            "table_name", "record_id", name="uq_sample_records_table_record"
        ),
        db.Index("ix_sample_records_table_name", "table_name"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    table_name = db.Column(db.String(64), nullable=False)
    # Text, not integer: some tracked tables use UUID primary keys.
    record_id = db.Column(db.String(64), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False)
    # Null when the generator inserted the row. Stock snapshots store the
    # quantity from before the run so remove can put it back.
    detail = db.Column(JSONB, nullable=True)
