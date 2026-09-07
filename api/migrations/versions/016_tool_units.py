"""Tool types and per-unit assets for individually tracked tools.

Revision ID: 016_tool_units
Revises: 015_stocktake
Create Date: 2026-09-08

Note: 013–015 already exist; this is 016 (not 013).

ToolEvent handling for reclassified consumables (drill bits, end mills, etc.):
- BORROW / RETURN / ISSUE events on those tool rows are deleted.
- Outstanding borrow qty is added back to quantity_on_hand first.
- ADJUST events are kept.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "016_tool_units"
down_revision = "015_stocktake"
branch_labels = None
depends_on = None

RECLASSIFY_CODES = (
    "INV-DRILL-06",
    "INV-DRILL-08",
    "INV-DRILL-10",
    "INV-DRILL-12",
    "INV-ENDMILL-10",
    "INV-ENDMILL-12",
    "INV-TONGA-STD",
    "INV-CENTER-A",
    "INV-CENTER-B",
)

toolunitstatus = postgresql.ENUM(
    "AVAILABLE",
    "OUT",
    "UNDER_REPAIR",
    "RETIRED",
    name="toolunitstatus",
    create_type=False,
)


def upgrade():
    bind = op.get_bind()
    op.execute(
        sa.text(
            """
            DO $$ BEGIN
                CREATE TYPE toolunitstatus AS ENUM (
                    'AVAILABLE', 'OUT', 'UNDER_REPAIR', 'RETIRED'
                );
            EXCEPTION
                WHEN duplicate_object THEN null;
            END $$;
            """
        )
    )

    op.create_table(
        "tool_types",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("is_seed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_tool_types_name", "tool_types", ["name"])
    op.create_index("ix_tool_types_code", "tool_types", ["code"])

    op.create_table(
        "tool_units",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tool_type_id", sa.String(length=36), nullable=False),
        sa.Column("asset_code", sa.String(length=100), nullable=False),
        sa.Column(
            "status",
            toolunitstatus,
            nullable=False,
            server_default="AVAILABLE",
        ),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column("current_holder_id", sa.String(length=36), nullable=True),
        sa.Column("held_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tool_type_id"], ["tool_types.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["current_holder_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("asset_code", name="uq_tool_unit_asset_code"),
    )
    op.create_index("ix_tool_units_tool_type_id", "tool_units", ["tool_type_id"])
    op.create_index("ix_tool_units_asset_code", "tool_units", ["asset_code"])
    op.create_index("ix_tool_units_status", "tool_units", ["status"])
    op.create_index(
        "ix_tool_units_type_status", "tool_units", ["tool_type_id", "status"]
    )
    op.create_index(
        "ix_tool_units_current_holder_id", "tool_units", ["current_holder_id"]
    )

    op.add_column(
        "tool_events",
        sa.Column("tool_unit_id", sa.String(length=36), nullable=True),
    )
    op.create_index("ix_tool_events_tool_unit_id", "tool_events", ["tool_unit_id"])
    op.create_foreign_key(
        "fk_tool_events_tool_unit_id",
        "tool_events",
        "tool_units",
        ["tool_unit_id"],
        ["id"],
    )

    op.alter_column("tool_events", "tool_id", existing_type=sa.String(36), nullable=True)

    codes = ", ".join(f"'{c}'" for c in RECLASSIFY_CODES)
    bind.execute(
        sa.text(
            f"""
            UPDATE tools t
            SET quantity_on_hand = quantity_on_hand + COALESCE((
                SELECT SUM(
                    CASE
                        WHEN e.type = 'BORROW' THEN e.quantity
                        WHEN e.type = 'RETURN' THEN -e.quantity
                        ELSE 0
                    END
                )
                FROM tool_events e
                WHERE e.tool_id = t.id
                  AND e.type IN ('BORROW', 'RETURN')
            ), 0)
            WHERE t.code IN ({codes})
               OR t.category = 'RETURNABLE_TOOL'
            """
        )
    )
    bind.execute(
        sa.text(
            f"""
            DELETE FROM tool_events
            WHERE type IN ('BORROW', 'RETURN', 'ISSUE')
              AND tool_id IN (
                SELECT id FROM tools
                WHERE code IN ({codes}) OR category = 'RETURNABLE_TOOL'
              )
            """
        )
    )
    bind.execute(
        sa.text(
            f"""
            UPDATE tools
            SET category = 'CONSUMABLE'
            WHERE code IN ({codes}) OR category = 'RETURNABLE_TOOL'
            """
        )
    )


def downgrade():
    op.drop_constraint("fk_tool_events_tool_unit_id", "tool_events", type_="foreignkey")
    op.drop_index("ix_tool_events_tool_unit_id", table_name="tool_events")
    op.drop_column("tool_events", "tool_unit_id")
    op.alter_column(
        "tool_events", "tool_id", existing_type=sa.String(36), nullable=False
    )

    op.drop_index("ix_tool_units_current_holder_id", table_name="tool_units")
    op.drop_index("ix_tool_units_type_status", table_name="tool_units")
    op.drop_index("ix_tool_units_status", table_name="tool_units")
    op.drop_index("ix_tool_units_asset_code", table_name="tool_units")
    op.drop_index("ix_tool_units_tool_type_id", table_name="tool_units")
    op.drop_table("tool_units")
    op.execute(sa.text("DROP TYPE IF EXISTS toolunitstatus"))

    op.drop_index("ix_tool_types_code", table_name="tool_types")
    op.drop_index("ix_tool_types_name", table_name="tool_types")
    op.drop_table("tool_types")
