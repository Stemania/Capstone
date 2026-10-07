"""Expected repair date on machine breakdowns.

Revision ID: 036_downtime_expected_repair
Revises: 035_shop_process
Create Date: 2026-10-07

- machine_downtimes.expected_repair_date: set by the Admin or Office Staff;
  the scheduler treats the unit as unavailable through that shop-local date
  instead of indefinitely.
"""

from alembic import op
import sqlalchemy as sa

revision = "036_downtime_expected_repair"
down_revision = "035_shop_process"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "machine_downtimes",
        sa.Column("expected_repair_date", sa.Date(), nullable=True),
    )


def downgrade():
    op.drop_column("machine_downtimes", "expected_repair_date")
