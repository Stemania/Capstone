"""Add schedule_color on job_orders for week-view distinction.

Revision ID: 014_job_schedule_color
Revises: 013_password_reset_tokens
Create Date: 2026-09-05
"""
from alembic import op
import sqlalchemy as sa

revision = "014_job_schedule_color"
down_revision = "013_password_reset_tokens"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "job_orders",
        sa.Column("schedule_color", sa.String(length=7), nullable=True),
    )


def downgrade():
    op.drop_column("job_orders", "schedule_color")
