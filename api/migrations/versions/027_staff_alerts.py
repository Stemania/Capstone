"""In-app staff alerts (header bell).

Revision ID: 027_staff_alerts
Revises: 026_material_delay
Create Date: 2026-10-03

- New table staff_alerts: one row per recipient, with kind, title, message,
  optional job / supplier order links, an optional dedupe key, and read time.
"""

from alembic import op
import sqlalchemy as sa

revision = "027_staff_alerts"
down_revision = "026_material_delay"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "staff_alerts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "recipient_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column(
            "job_order_id",
            sa.String(length=36),
            sa.ForeignKey("job_orders.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "supplier_order_id",
            sa.String(length=36),
            sa.ForeignKey("supplier_orders.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("dedupe_key", sa.String(length=160), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("recipient_id", "dedupe_key", name="uq_staff_alert_recipient_key"),
    )
    op.create_index("ix_staff_alerts_recipient_id", "staff_alerts", ["recipient_id"])
    op.create_index("ix_staff_alerts_kind", "staff_alerts", ["kind"])
    op.create_index("ix_staff_alerts_created_at", "staff_alerts", ["created_at"])


def downgrade():
    op.drop_index("ix_staff_alerts_created_at", table_name="staff_alerts")
    op.drop_index("ix_staff_alerts_kind", table_name="staff_alerts")
    op.drop_index("ix_staff_alerts_recipient_id", table_name="staff_alerts")
    op.drop_table("staff_alerts")
