"""Consolidate job order statuses: DRAFT + four production statuses.

Revision ID: 012_consolidate_job_statuses
Revises: 011_drop_material_source
Create Date: 2026-09-01

Adds SCHEDULED and maps legacy planning/floor statuses:
- PLANNING → DRAFT
- RELEASED, ASSIGNED, UNASSIGNED → SCHEDULED

Postgres cannot remove enum labels. These become unused in application code:
PLANNING, RELEASED, UNASSIGNED, ASSIGNED.
"""
from alembic import op

revision = "012_consolidate_job_statuses"
down_revision = "011_drop_material_source"
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE joborderstatus ADD VALUE IF NOT EXISTS 'SCHEDULED'")

    op.execute(
        """
        UPDATE job_orders
        SET status = 'DRAFT'
        WHERE status::text = 'PLANNING'
        """
    )
    op.execute(
        """
        UPDATE job_orders
        SET status = 'SCHEDULED'
        WHERE status::text IN ('RELEASED', 'ASSIGNED', 'UNASSIGNED')
        """
    )


def downgrade():
    # Cannot remove SCHEDULED from Postgres enum. Map production floor back to 009-era labels.
    op.execute(
        """
        UPDATE job_orders
        SET status = 'RELEASED'
        WHERE status::text = 'SCHEDULED'
          AND NOT EXISTS (
            SELECT 1 FROM job_operations jo
            WHERE jo.job_order_id = job_orders.id
              AND jo.assigned_worker_id IS NOT NULL
          )
        """
    )
    op.execute(
        """
        UPDATE job_orders
        SET status = 'ASSIGNED'
        WHERE status::text = 'SCHEDULED'
          AND EXISTS (
            SELECT 1 FROM job_operations jo
            WHERE jo.job_order_id = job_orders.id
              AND jo.assigned_worker_id IS NOT NULL
          )
        """
    )
    op.execute(
        """
        UPDATE job_orders
        SET status = 'PLANNING'
        WHERE status::text = 'DRAFT'
          AND EXISTS (
            SELECT 1 FROM job_operations jo
            WHERE jo.job_order_id = job_orders.id
          )
        """
    )
