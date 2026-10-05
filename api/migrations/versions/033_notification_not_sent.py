"""NOT_SENT notification status (no email/SMS provider configured).

Revision ID: 033_notification_not_sent
Revises: 032_job_at_risk_alerted
Create Date: 2026-10-05

Rows the console/stub provider marked SENT never reached anyone; they become
NOT_SENT with the reason "No email/SMS provider configured".
"""

from alembic import op

revision = "033_notification_not_sent"
down_revision = "032_job_at_risk_alerted"
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE notificationstatus ADD VALUE IF NOT EXISTS 'NOT_SENT'")
    op.execute(
        """
        UPDATE notification_logs
        SET status = 'NOT_SENT',
            sent_at = NULL,
            error_message = 'No email/SMS provider configured'
        WHERE status = 'SENT'
          AND error_message LIKE 'Sent via %'
        """
    )


def downgrade():
    op.execute(
        """
        UPDATE notification_logs
        SET status = 'SENT', error_message = 'Sent via console'
        WHERE status = 'NOT_SENT'
        """
    )
    # Postgres cannot remove NOT_SENT from notificationstatus cleanly
