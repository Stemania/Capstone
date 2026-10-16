"""Notification log covers every email/SMS send, not only client job updates.

Revision ID: 049_notification_log_all_sends
Revises: 048_machine_type_names
Create Date: 2026-10-15

Invitations, password resets and admin test messages have no job or client,
so job_order_id, client_id and milestone become nullable. New columns:
event (what triggered the send; existing rows get their milestone name) and
provider_reference (the provider's message id, e.g. the Gmail message id).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "049_notification_log_all_sends"
down_revision = "048_machine_type_names"
branch_labels = None
depends_on = None

MILESTONE = postgresql.ENUM(
    "JOB_RECEIVED",
    "JOB_STARTED",
    "JOB_COMPLETED",
    "JOB_DELIVERED",
    name="notificationmilestone",
    create_type=False,
)


def upgrade():
    op.add_column("notification_logs", sa.Column("event", sa.String(40), nullable=True))
    op.execute("UPDATE notification_logs SET event = milestone::text WHERE event IS NULL")
    op.alter_column("notification_logs", "event", existing_type=sa.String(40), nullable=False)
    op.create_index("ix_notification_logs_event", "notification_logs", ["event"])

    op.add_column(
        "notification_logs",
        sa.Column("provider_reference", sa.String(255), nullable=True),
    )

    op.alter_column("notification_logs", "job_order_id", existing_type=sa.String(36), nullable=True)
    op.alter_column("notification_logs", "client_id", existing_type=sa.String(36), nullable=True)
    op.alter_column("notification_logs", "milestone", existing_type=MILESTONE, nullable=True)


def downgrade():
    # Rows without a job, client or milestone (invitations, resets, tests) cannot
    # satisfy the old NOT NULL columns. Refuse rather than delete log history.
    count = op.get_bind().execute(
        sa.text(
            "SELECT COUNT(*) FROM notification_logs "
            "WHERE job_order_id IS NULL OR client_id IS NULL OR milestone IS NULL"
        )
    ).scalar()
    if count:
        raise RuntimeError(
            f"Cannot downgrade 049: {count} notification_logs row(s) have no job order, "
            "client or milestone (invitations, password resets or test messages). "
            "Nothing was changed. Export or remove those rows yourself, then retry."
        )
    op.alter_column("notification_logs", "milestone", existing_type=MILESTONE, nullable=False)
    op.alter_column("notification_logs", "client_id", existing_type=sa.String(36), nullable=False)
    op.alter_column("notification_logs", "job_order_id", existing_type=sa.String(36), nullable=False)
    op.drop_column("notification_logs", "provider_reference")
    op.drop_index("ix_notification_logs_event", table_name="notification_logs")
    op.drop_column("notification_logs", "event")
