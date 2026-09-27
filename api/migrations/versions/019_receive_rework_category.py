"""RECEIVE tool events + rework reason categories.

Revision ID: 019_receive_rework_category
Revises: 018_unit_default_operator
Create Date: 2026-09-21

- Add ToolEventType.RECEIVE and tool_events.supplier / received_on
- Convert legacy positive ADJUST rows (reason starting with '+') to RECEIVE
- Add operations.rework_reason_category; map existing free-text rework to OTHER
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "019_receive_rework_category"
down_revision = "018_unit_default_operator"
branch_labels = None
depends_on = None


def upgrade():
    # New enum values must be committed before use in the same migration (Postgres).
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE tooleventtype ADD VALUE IF NOT EXISTS 'RECEIVE'")

    op.add_column(
        "tool_events",
        sa.Column("supplier", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "tool_events",
        sa.Column("received_on", sa.Date(), nullable=True),
    )

    # Convert delivery-style ADJUST (+prefix) to RECEIVE; strip leading "+qty: " noise.
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            """
            WITH converted AS (
                UPDATE tool_events
                SET type = 'RECEIVE',
                    received_on = (created_at AT TIME ZONE 'Asia/Manila')::date,
                    reason = CASE
                        WHEN reason ~ '^\\+[0-9.]+:\\s*' THEN
                            regexp_replace(reason, '^\\+[0-9.]+:\\s*', '')
                        WHEN reason LIKE '+%' THEN
                            NULLIF(ltrim(substring(reason from 2)), '')
                        ELSE reason
                    END
                WHERE type = 'ADJUST'
                  AND reason IS NOT NULL
                  AND left(btrim(reason), 1) = '+'
                RETURNING id
            )
            SELECT count(*) FROM converted
            """
        )
    )
    converted = result.scalar() or 0
    conn.execute(
        sa.text(
            f"DO $$ BEGIN RAISE NOTICE 'Converted % ADJUST to RECEIVE events', {int(converted)}; END $$;"
        )
    )
    print(f"Migration 019: converted {converted} ADJUST events to RECEIVE")

    rework_cat = postgresql.ENUM(
        "DIMENSION_OUT_OF_TOLERANCE",
        "SURFACE_FINISH",
        "WRONG_MATERIAL",
        "MACHINE_FAULT",
        "OPERATOR_ERROR",
        "OTHER",
        name="reworkreasoncategory",
        create_type=False,
    )
    rework_cat.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "operations",
        sa.Column(
            "rework_reason_category",
            sa.Enum(
                "DIMENSION_OUT_OF_TOLERANCE",
                "SURFACE_FINISH",
                "WRONG_MATERIAL",
                "MACHINE_FAULT",
                "OPERATOR_ERROR",
                "OTHER",
                name="reworkreasoncategory",
                create_type=False,
            ),
            nullable=True,
        ),
    )
    # Existing free-text rework reasons -> OTHER (keep text in rework_reason)
    op.execute(
        """
        UPDATE operations
        SET rework_reason_category = 'OTHER'
        WHERE rework_reason IS NOT NULL
          AND btrim(rework_reason) <> ''
          AND rework_reason_category IS NULL
        """
    )


def downgrade():
    op.drop_column("operations", "rework_reason_category")
    sa.Enum(name="reworkreasoncategory").drop(op.get_bind(), checkfirst=True)
    op.drop_column("tool_events", "received_on")
    op.drop_column("tool_events", "supplier")
    # Postgres cannot remove RECEIVE from tooleventtype cleanly
