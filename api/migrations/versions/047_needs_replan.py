"""Needs re-plan: why a released job's schedule could not be updated automatically.

Revision ID: 047_needs_replan
Revises: 046_retire_checking
Create Date: 2026-10-10

Set when a redo cannot be placed within the search horizon; the job shows
"Needs re-plan" until the Admin re-plans it.
"""

import sqlalchemy as sa
from alembic import op

revision = "047_needs_replan"
down_revision = "046_retire_checking"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("job_orders", sa.Column("needs_replan_reason", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("job_orders", "needs_replan_reason")
