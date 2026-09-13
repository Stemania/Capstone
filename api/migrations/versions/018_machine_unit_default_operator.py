"""Add optional default_operator_id on machine_units.

Revision ID: 018_unit_default_operator
Revises: 017_job_material_readiness
Create Date: 2026-09-13

Nullable FK to users: set when a unit has a usual operator; leave null for
shared machines (e.g. some milling units usable by anyone). Used only as a
scheduler tie-break when choosing among free units — not a scoring factor.
"""

from alembic import op
import sqlalchemy as sa

revision = "018_unit_default_operator"
down_revision = "017_job_material_readiness"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "machine_units",
        sa.Column("default_operator_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_machine_units_default_operator_id_users",
        "machine_units",
        "users",
        ["default_operator_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_machine_units_default_operator_id",
        "machine_units",
        ["default_operator_id"],
    )


def downgrade():
    op.drop_index("ix_machine_units_default_operator_id", table_name="machine_units")
    op.drop_constraint(
        "fk_machine_units_default_operator_id_users",
        "machine_units",
        type_="foreignkey",
    )
    op.drop_column("machine_units", "default_operator_id")
