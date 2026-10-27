"""Client progress emails: halfway, final stage and delayed updates.

Revision ID: 058_client_progress_emails
Revises: 057_for_delivery_status
Create Date: 2026-10-28

Additive only:
- notificationmilestone gains JOB_HALFWAY, JOB_FINAL_STAGE and JOB_DELAYED.
- clients.update_level: DETAILED (every update, the default) or KEY
  (received, ready for delivery and delays only). Existing clients get DETAILED.
- job_orders.client_notified_finish: the latest finish date the client was told,
  so a Delayed email is sent only when the date slips past it.

Downgrade drops the two columns only (Postgres cannot drop an enum value).
"""

from alembic import op
import sqlalchemy as sa

revision = "058_client_progress_emails"
down_revision = "057_for_delivery_status"
branch_labels = None
depends_on = None


def upgrade():
    # New enum values must be committed before use (Postgres).
    with op.get_context().autocommit_block():
        for value in ("JOB_HALFWAY", "JOB_FINAL_STAGE", "JOB_DELAYED"):
            op.execute(f"ALTER TYPE notificationmilestone ADD VALUE IF NOT EXISTS '{value}'")

    op.add_column(
        "clients",
        sa.Column(
            "update_level",
            sa.String(length=10),
            nullable=False,
            server_default="DETAILED",
        ),
    )
    op.add_column(
        "job_orders",
        sa.Column("client_notified_finish", sa.Date(), nullable=True),
    )


def downgrade():
    op.drop_column("job_orders", "client_notified_finish")
    op.drop_column("clients", "update_level")
