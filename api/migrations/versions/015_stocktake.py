"""Periodic consumable stocktakes.

Revision ID: 015_stocktake
Revises: 014_job_schedule_color
Create Date: 2026-09-08

013 and 014 already exist (password reset, schedule color), so stocktake is 015.
"""
from alembic import op
import sqlalchemy as sa

revision = "015_stocktake"
down_revision = "014_job_schedule_color"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "stocktakes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("counted_on", sa.Date(), nullable=False),
        sa.Column("counted_by_id", sa.String(length=36), nullable=False),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["counted_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_stocktakes_counted_on", "stocktakes", ["counted_on"])
    op.create_index("ix_stocktakes_counted_by_id", "stocktakes", ["counted_by_id"])

    op.create_table(
        "stocktake_lines",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("stocktake_id", sa.String(length=36), nullable=False),
        sa.Column("tool_id", sa.String(length=36), nullable=False),
        sa.Column("previous_quantity", sa.Numeric(12, 2), nullable=False),
        sa.Column("counted_quantity", sa.Numeric(12, 2), nullable=False),
        sa.ForeignKeyConstraint(["stocktake_id"], ["stocktakes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tool_id"], ["tools.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stocktake_id", "tool_id", name="uq_stocktake_line_tool"),
    )
    op.create_index("ix_stocktake_line_tool", "stocktake_lines", ["tool_id"])


def downgrade():
    op.drop_index("ix_stocktake_line_tool", table_name="stocktake_lines")
    op.drop_table("stocktake_lines")
    op.drop_index("ix_stocktakes_counted_by_id", table_name="stocktakes")
    op.drop_index("ix_stocktakes_counted_on", table_name="stocktakes")
    op.drop_table("stocktakes")
