"""Server receipt time on worker actions, and job release time.

Revision ID: 039_action_received_times
Revises: 038_offline_action_receipts
Create Date: 2026-10-07

- operation_time_logs.received_at, machine_downtimes.received_at: when the
  server received an action whose time came from the worker's phone.
- job_orders.released_at: when the schedule was confirmed. Backfilled from the
  first audit entry showing the job out of Draft; left empty when none exists.
"""

from alembic import op
import sqlalchemy as sa

revision = "039_action_received_times"
down_revision = "038_offline_action_receipts"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "operation_time_logs",
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "machine_downtimes",
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "job_orders",
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        """
        UPDATE job_orders AS j
        SET released_at = first_release.at
        FROM (
            SELECT entity_id, MIN(created_at) AS at
            FROM audit_logs
            WHERE entity_type = 'JobOrder'
              AND action = 'UPDATE'
              AND after_json ->> 'status' IS NOT NULL
              AND after_json ->> 'status' <> 'DRAFT'
            GROUP BY entity_id
        ) AS first_release
        WHERE j.id = first_release.entity_id
          AND j.status <> 'DRAFT'
        """
    )


def downgrade():
    op.drop_column("job_orders", "released_at")
    op.drop_column("machine_downtimes", "received_at")
    op.drop_column("operation_time_logs", "received_at")
