"""Consumable scan movements, unit review flags, reorder-soon setting.

Revision ID: 052_consumable_scan_forecast
Revises: 051_job_cancel_archive
Create Date: 2026-10-18

Additive only (no drops or renames of existing columns/tables):
- tooleventtype enum values: SCAN, UNDO, CORRECTION
  (Postgres cannot drop enum labels on downgrade — labels stay)
- tools: legacy_unit, unit_needs_review, unit_cost
- tool_events: operation_id, undoes_event_id, undone_at, client_action_id,
  stock_delta
- shop_settings: reorder_soon_working_days (default 7)

Stocktakes and minimum_stock are kept unused for triggers; RECEIVE/ADJUST
events remain valid history.
"""

from alembic import op
import sqlalchemy as sa

revision = "052_consumable_scan_forecast"
down_revision = "051_job_cancel_archive"
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE tooleventtype ADD VALUE IF NOT EXISTS 'SCAN'")
        op.execute("ALTER TYPE tooleventtype ADD VALUE IF NOT EXISTS 'UNDO'")
        op.execute("ALTER TYPE tooleventtype ADD VALUE IF NOT EXISTS 'CORRECTION'")

    op.add_column(
        "tools",
        sa.Column("legacy_unit", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "tools",
        sa.Column(
            "unit_needs_review",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "tools",
        sa.Column("unit_cost", sa.Numeric(14, 4), nullable=True),
    )

    op.add_column(
        "tool_events",
        sa.Column("operation_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_tool_events_operation_id_operations",
        "tool_events",
        "operations",
        ["operation_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_tool_events_operation_id", "tool_events", ["operation_id"]
    )

    op.add_column(
        "tool_events",
        sa.Column("undoes_event_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_tool_events_undoes_event_id_tool_events",
        "tool_events",
        "tool_events",
        ["undoes_event_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column(
        "tool_events",
        sa.Column("undone_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.add_column(
        "tool_events",
        sa.Column("client_action_id", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "uq_tool_events_client_action_id",
        "tool_events",
        ["client_action_id"],
        unique=True,
        postgresql_where=sa.text("client_action_id IS NOT NULL"),
        sqlite_where=sa.text("client_action_id IS NOT NULL"),
    )

    op.add_column(
        "tool_events",
        sa.Column("stock_delta", sa.Numeric(12, 2), nullable=True),
    )

    op.add_column(
        "shop_settings",
        sa.Column(
            "reorder_soon_working_days",
            sa.Integer(),
            nullable=False,
            server_default="7",
        ),
    )


def downgrade():
    op.drop_column("shop_settings", "reorder_soon_working_days")

    op.drop_column("tool_events", "stock_delta")
    op.drop_index("uq_tool_events_client_action_id", table_name="tool_events")
    op.drop_column("tool_events", "client_action_id")
    op.drop_column("tool_events", "undone_at")
    op.drop_constraint(
        "fk_tool_events_undoes_event_id_tool_events",
        "tool_events",
        type_="foreignkey",
    )
    op.drop_column("tool_events", "undoes_event_id")
    op.drop_index("ix_tool_events_operation_id", table_name="tool_events")
    op.drop_constraint(
        "fk_tool_events_operation_id_operations",
        "tool_events",
        type_="foreignkey",
    )
    op.drop_column("tool_events", "operation_id")

    op.drop_column("tools", "unit_cost")
    op.drop_column("tools", "unit_needs_review")
    op.drop_column("tools", "legacy_unit")

    # Enum labels SCAN / UNDO / CORRECTION are left in place (Postgres limitation).
