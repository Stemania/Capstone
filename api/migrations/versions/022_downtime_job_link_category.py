"""Machine breakdowns: fixed category, optional job order / operation link.

Revision ID: 022_downtime_job_link_category
Revises: 021_consumption_invoices_stages
Create Date: 2026-09-28

- downtimecategory enum and machine_downtimes.category (NOT NULL).
  Backfill from the existing free-text reason by keyword; anything that
  does not match becomes OTHER, and its reason is copied into the note
  (prefixed "Reason: " when a note already exists). The reason column is
  kept as is.
- machine_downtimes.job_order_id and operation_id (nullable, SET NULL on
  delete), indexed. Existing rows stay unlinked.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "022_downtime_job_link_category"
down_revision = "021_consumption_invoices_stages"
branch_labels = None
depends_on = None

CATEGORY_VALUES = (
    "MECHANICAL_FAILURE",
    "ELECTRICAL_FAULT",
    "UNDER_REPAIR",
    "WAITING_FOR_PARTS",
    "SCHEDULED_MAINTENANCE",
    "OTHER",
)


def upgrade():
    category_enum = postgresql.ENUM(*CATEGORY_VALUES, name="downtimecategory")
    category_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "machine_downtimes",
        sa.Column(
            "category",
            postgresql.ENUM(*CATEGORY_VALUES, name="downtimecategory", create_type=False),
            nullable=True,
        ),
    )
    op.execute(
        """
        UPDATE machine_downtimes SET category = (
            CASE
                WHEN reason ILIKE '%electric%' OR reason ILIKE '%power%'
                    THEN 'ELECTRICAL_FAULT'
                WHEN reason ILIKE '%maintenance%'
                    THEN 'SCHEDULED_MAINTENANCE'
                WHEN reason ILIKE '%parts%'
                    THEN 'WAITING_FOR_PARTS'
                WHEN reason ILIKE '%repair%'
                    THEN 'UNDER_REPAIR'
                WHEN reason ILIKE '%mechanical%' OR reason ILIKE '%failure%'
                    OR reason ILIKE '%jam%' OR reason ILIKE '%bearing%'
                    THEN 'MECHANICAL_FAILURE'
                ELSE 'OTHER'
            END
        )::downtimecategory
        """
    )
    # Service rule: OTHER needs a note. Carry the unmatched reason into it.
    op.execute(
        """
        UPDATE machine_downtimes
        SET note = CASE
            WHEN note IS NULL OR btrim(note) = '' THEN reason
            ELSE 'Reason: ' || reason || E'\\n' || note
        END
        WHERE category = 'OTHER'
        """
    )
    op.alter_column("machine_downtimes", "category", nullable=False)

    op.add_column(
        "machine_downtimes",
        sa.Column("job_order_id", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "machine_downtimes",
        sa.Column("operation_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_machine_downtimes_job_order",
        "machine_downtimes",
        "job_orders",
        ["job_order_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_machine_downtimes_operation",
        "machine_downtimes",
        "operations",
        ["operation_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_machine_downtimes_job_order_id", "machine_downtimes", ["job_order_id"]
    )
    op.create_index(
        "ix_machine_downtimes_operation_id", "machine_downtimes", ["operation_id"]
    )


def downgrade():
    op.drop_index("ix_machine_downtimes_operation_id", table_name="machine_downtimes")
    op.drop_index("ix_machine_downtimes_job_order_id", table_name="machine_downtimes")
    op.drop_constraint(
        "fk_machine_downtimes_operation", "machine_downtimes", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_machine_downtimes_job_order", "machine_downtimes", type_="foreignkey"
    )
    op.drop_column("machine_downtimes", "operation_id")
    op.drop_column("machine_downtimes", "job_order_id")
    op.drop_column("machine_downtimes", "category")
    postgresql.ENUM(name="downtimecategory").drop(op.get_bind(), checkfirst=True)
