"""Add DRAFT/PLANNING/RELEASED job statuses; migrate existing to production floor.

Revision ID: 009_job_planning_statuses
Revises: 008_client_notifications
Create Date: 2026-08-12

Internal planning states (DRAFT, PLANNING) sit before the production chain.
RELEASED is the first status workers may see. Existing job orders already have
operations/workers and must not land in DRAFT or PLANNING — UNASSIGNED rows
become RELEASED; ASSIGNED and later stay as-is.
"""
from alembic import op

revision = "009_job_planning_statuses"
down_revision = "008_client_notifications"
branch_labels = None
depends_on = None


def upgrade():
    # Postgres requires new enum labels to be committed before they can be used.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE joborderstatus ADD VALUE IF NOT EXISTS 'DRAFT'")
        op.execute("ALTER TYPE joborderstatus ADD VALUE IF NOT EXISTS 'PLANNING'")
        op.execute("ALTER TYPE joborderstatus ADD VALUE IF NOT EXISTS 'RELEASED'")

    # Existing jobs were already on the production floor.
    op.execute(
        """
        UPDATE job_orders
        SET status = 'RELEASED'
        WHERE status::text = 'UNASSIGNED'
        """
    )


def downgrade():
    # Cannot remove enum values from Postgres safely. Map planning/released back
    # to the pre-009 floor status so the column remains valid.
    op.execute(
        """
        UPDATE job_orders
        SET status = 'UNASSIGNED'
        WHERE status::text IN ('DRAFT', 'PLANNING', 'RELEASED')
        """
    )
