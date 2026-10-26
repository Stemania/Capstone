"""For Delivery before Delivered.

Revision ID: 057_for_delivery_status
Revises: 056_sample_records
Create Date: 2026-10-27

Additive only:
- joborderstatus gains FOR_DELIVERY (Completed -> For Delivery -> Delivered).
- job_orders.for_delivery_at: when the Admin set the job For Delivery.

Existing DELIVERED rows are left as they are; they now read as Delivered,
and delivered_at stays the date on-time is measured on. Downgrade drops the
column only (Postgres cannot drop an enum value); no row uses FOR_DELIVERY
after it unless jobs were set For Delivery in the meantime.
"""

from alembic import op
import sqlalchemy as sa

revision = "057_for_delivery_status"
down_revision = "056_sample_records"
branch_labels = None
depends_on = None


def upgrade():
    # New enum values must be committed before use (Postgres).
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE joborderstatus ADD VALUE IF NOT EXISTS 'FOR_DELIVERY'")

    op.add_column(
        "job_orders",
        sa.Column("for_delivery_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_column("job_orders", "for_delivery_at")
