"""Office Staff can change an issued supplier order's expected delivery date.

Revision ID: 028_expected_delivery_changes
Revises: 027_staff_alerts
Create Date: 2026-10-03

- original_expected_delivery_date: the date at issue, stored the first time it
  is changed and never overwritten.
- expected_delivery_note: the note given with the latest change. Every change
  and its note is also in the audit log (EXPECTED_DELIVERY_CHANGED).
"""

from alembic import op
import sqlalchemy as sa

revision = "028_expected_delivery_changes"
down_revision = "027_staff_alerts"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "supplier_orders",
        sa.Column("original_expected_delivery_date", sa.Date(), nullable=True),
    )
    op.add_column(
        "supplier_orders", sa.Column("expected_delivery_note", sa.Text(), nullable=True)
    )


def downgrade():
    op.drop_column("supplier_orders", "expected_delivery_note")
    op.drop_column("supplier_orders", "original_expected_delivery_date")
