"""Receipts for worker actions recorded offline.

Revision ID: 038_offline_action_receipts
Revises: 037_consumable_po_lines
Create Date: 2026-10-07

- offline_action_receipts: one row per phone action id already processed, so
  an action resent by the phone's sync queue is recorded once.
"""

from alembic import op
import sqlalchemy as sa

revision = "038_offline_action_receipts"
down_revision = "037_consumable_po_lines"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "offline_action_receipts",
        sa.Column("client_action_id", sa.String(64), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("result_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_offline_action_receipts_user_id", "offline_action_receipts", ["user_id"]
    )


def downgrade():
    op.drop_index("ix_offline_action_receipts_user_id", table_name="offline_action_receipts")
    op.drop_table("offline_action_receipts")
