"""Client notify contacts, NotificationLog, job DELIVERED status.

Revision ID: 008_client_notifications
Revises: 007_inventory_stock
Create Date: 2026-08-11

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "008_client_notifications"
down_revision = "007_inventory_stock"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE joborderstatus ADD VALUE IF NOT EXISTS 'DELIVERED'")

    op.add_column("clients", sa.Column("email", sa.String(255), nullable=True))
    op.add_column("clients", sa.Column("mobile_number", sa.String(32), nullable=True))
    op.add_column(
        "clients",
        sa.Column(
            "notify_by_email",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "clients",
        sa.Column(
            "notify_by_sms",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    op.add_column(
        "job_orders",
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
    )

    milestone = postgresql.ENUM(
        "JOB_RECEIVED",
        "JOB_STARTED",
        "JOB_COMPLETED",
        "JOB_DELIVERED",
        name="notificationmilestone",
        create_type=False,
    )
    channel = postgresql.ENUM(
        "EMAIL",
        "SMS",
        name="notificationchannel",
        create_type=False,
    )
    status = postgresql.ENUM(
        "PENDING",
        "SENT",
        "FAILED",
        "SKIPPED",
        name="notificationstatus",
        create_type=False,
    )
    bind = op.get_bind()
    milestone.create(bind, checkfirst=True)
    channel.create(bind, checkfirst=True)
    status.create(bind, checkfirst=True)

    op.create_table(
        "notification_logs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "job_order_id",
            sa.String(36),
            sa.ForeignKey("job_orders.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "client_id",
            sa.String(36),
            sa.ForeignKey("clients.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("milestone", milestone, nullable=False, index=True),
        sa.Column("channel", channel, nullable=False),
        sa.Column("recipient", sa.String(255), nullable=False),
        sa.Column("message_body", sa.Text(), nullable=False),
        sa.Column("status", status, nullable=False, index=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_notification_job_milestone_channel",
        "notification_logs",
        ["job_order_id", "milestone", "channel"],
    )


def downgrade():
    op.drop_index("ix_notification_job_milestone_channel", table_name="notification_logs")
    op.drop_table("notification_logs")
    postgresql.ENUM(name="notificationstatus").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="notificationchannel").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="notificationmilestone").drop(op.get_bind(), checkfirst=True)
    op.drop_column("job_orders", "delivered_at")
    op.drop_column("clients", "notify_by_sms")
    op.drop_column("clients", "notify_by_email")
    op.drop_column("clients", "mobile_number")
    op.drop_column("clients", "email")
