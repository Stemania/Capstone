"""Password reset tokens for forgot-password flow.

Revision ID: 013_password_reset_tokens
Revises: 012_consolidate_job_statuses
Create Date: 2026-09-01
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "013_password_reset_tokens"
down_revision = "012_consolidate_job_statuses"
branch_labels = None
depends_on = None


def upgrade():
    invite_channel = postgresql.ENUM(
        "EMAIL",
        "SMS",
        name="invitationchannel",
        create_type=False,
    )

    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("token_hash", sa.String(length=255), nullable=False),
        sa.Column("channel", invite_channel, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_password_reset_tokens_user_id", "password_reset_tokens", ["user_id"])
    op.create_index(
        "ix_password_reset_tokens_token_hash",
        "password_reset_tokens",
        ["token_hash"],
        unique=True,
    )


def downgrade():
    op.drop_index("ix_password_reset_tokens_token_hash", table_name="password_reset_tokens")
    op.drop_index("ix_password_reset_tokens_user_id", table_name="password_reset_tokens")
    op.drop_table("password_reset_tokens")
