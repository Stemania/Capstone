"""suppliers.reference_loaded_at: when the reference loader first handled it.

Revision ID: 041_supplier_reference_loaded_at
Revises: 040_reference_data
Create Date: 2026-10-10

`flask load-reference-data` sets a supplier's active status only the first
time it creates or updates that supplier, so a supplier reactivated later
stays active on re-runs. Suppliers the loader has already handled (the
coded ones, renamed duplicates, and the retired suppliers already inactive)
are stamped now. No other data changes.
"""

import sqlalchemy as sa
from alembic import op

revision = "041_supplier_reference_loaded_at"
down_revision = "040_reference_data"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "suppliers",
        sa.Column("reference_loaded_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        """
        UPDATE suppliers SET reference_loaded_at = now()
        WHERE code IN ('RIC', 'STP', 'RTC')
           OR name LIKE '% (duplicate)'
           OR (lower(name) IN ('seno metals', 'metro hardware') AND active = false)
        """
    )


def downgrade():
    op.drop_column("suppliers", "reference_loaded_at")
