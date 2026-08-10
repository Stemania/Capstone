"""Inventory fields on tools; ISSUE/ADJUST events with quantity.

Revision ID: 007_inventory_stock
Revises: 006_operation_time_logs
Create Date: 2026-08-11

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "007_inventory_stock"
down_revision = "006_operation_time_logs"
branch_labels = None
depends_on = None


def upgrade():
    tool_category = postgresql.ENUM(
        "RETURNABLE_TOOL",
        "CONSUMABLE",
        name="toolcategory",
        create_type=False,
    )
    tool_category.create(op.get_bind(), checkfirst=True)

    op.execute("ALTER TYPE tooleventtype ADD VALUE IF NOT EXISTS 'ISSUE'")
    op.execute("ALTER TYPE tooleventtype ADD VALUE IF NOT EXISTS 'ADJUST'")

    op.add_column(
        "tools",
        sa.Column(
            "category",
            sa.Enum(
                "RETURNABLE_TOOL",
                "CONSUMABLE",
                name="toolcategory",
                create_type=False,
            ),
            nullable=False,
            server_default="RETURNABLE_TOOL",
        ),
    )
    op.add_column(
        "tools",
        sa.Column("unit", sa.String(32), nullable=False, server_default="pcs"),
    )
    op.add_column(
        "tools",
        sa.Column(
            "quantity_on_hand",
            sa.Numeric(12, 2),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "tools",
        sa.Column("minimum_stock", sa.Numeric(12, 2), nullable=True),
    )
    op.add_column(
        "tools",
        sa.Column("size_spec", sa.String(64), nullable=True),
    )

    op.add_column(
        "tool_events",
        sa.Column(
            "quantity",
            sa.Numeric(12, 2),
            nullable=False,
            server_default="1",
        ),
    )
    op.add_column(
        "tool_events",
        sa.Column("reason", sa.String(255), nullable=True),
    )

    # Existing single-item tool rows become returnable stock of 1
    op.execute(
        "UPDATE tools SET category = 'RETURNABLE_TOOL', unit = 'pcs', "
        "quantity_on_hand = 1 WHERE quantity_on_hand = 0 OR quantity_on_hand IS NULL"
    )


def downgrade():
    op.drop_column("tool_events", "reason")
    op.drop_column("tool_events", "quantity")
    op.drop_column("tools", "size_spec")
    op.drop_column("tools", "minimum_stock")
    op.drop_column("tools", "quantity_on_hand")
    op.drop_column("tools", "unit")
    op.drop_column("tools", "category")
    sa.Enum(name="toolcategory").drop(op.get_bind(), checkfirst=True)
    # Postgres cannot easily remove ENUM values from tooleventtype
