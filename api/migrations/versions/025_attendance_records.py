"""Worker attendance recorded by the Administrator.

Revision ID: 025_attendance_records
Revises: 024_supplier_orders
Create Date: 2026-10-02

- New table attendance_records: one row per worker per shop-local work date,
  with clock-in (required), clock-out (open until recorded), note, and who
  recorded / last edited it.
"""

from alembic import op
import sqlalchemy as sa

revision = "025_attendance_records"
down_revision = "024_supplier_orders"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "attendance_records",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("worker_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("clock_in", sa.DateTime(timezone=True), nullable=False),
        sa.Column("clock_out", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "recorded_by_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column(
            "updated_by_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("worker_id", "work_date", name="uq_attendance_worker_day"),
    )
    op.create_index("ix_attendance_records_worker_id", "attendance_records", ["worker_id"])
    op.create_index("ix_attendance_records_work_date", "attendance_records", ["work_date"])


def downgrade():
    op.drop_index("ix_attendance_records_work_date", table_name="attendance_records")
    op.drop_index("ix_attendance_records_worker_id", table_name="attendance_records")
    op.drop_table("attendance_records")
