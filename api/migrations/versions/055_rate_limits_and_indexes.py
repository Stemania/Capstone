"""DB rate-limit counters + additive indexes from audit H-03/H-06.

Revision ID: 055_rate_limits_and_indexes
Revises: 054_catalog_fill
Create Date: 2026-10-19

Additive only: CREATE TABLE / CREATE INDEX. Downgrade drops only what this
revision adds.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "055_rate_limits_and_indexes"
down_revision = "054_catalog_fill"
branch_labels = None
depends_on = None

# Indexes this revision may create (downgrade drops only these names).
_INDEXES = (
    ("ix_tools_category", "tools", ["category"]),
    ("ix_material_purchases_supplier_id", "material_purchases", ["supplier_id"]),
    ("ix_stocktake_lines_tool_id", "stocktake_lines", ["tool_id"]),
)


def upgrade():
    op.create_table(
        "rate_limit_counters",
        sa.Column("key", sa.String(length=255), primary_key=True),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False, server_default="0"),
    )

    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for name, table, columns in _INDEXES:
        existing = {ix["name"] for ix in inspector.get_indexes(table)}
        if name in existing:
            continue
        op.create_index(name, table, columns)


def downgrade():
    for name, table, _columns in reversed(_INDEXES):
        try:
            op.drop_index(name, table_name=table)
        except Exception:  # noqa: BLE001 — may already be absent
            pass
    op.drop_table("rate_limit_counters")
