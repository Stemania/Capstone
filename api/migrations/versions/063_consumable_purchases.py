"""Consumable purchases: what the shop bought, without counting stock.

Revision ID: 063_consumable_purchases
Revises: 062_shop_material_names
Create Date: 2026-11-06

Additive only: a new table. Consumables are no longer scanned or counted; the
replenishment forecast reads these purchases and the received consumable lines
of supplier orders. The stock columns and scan history stay as they are.
"""

import sqlalchemy as sa
from alembic import op

revision = "063_consumable_purchases"
down_revision = "062_shop_material_names"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "consumable_purchases",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tool_id", sa.String(36), sa.ForeignKey("tools.id"), nullable=False),
        sa.Column("purchased_on", sa.Date(), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 2), nullable=False),
        sa.Column("unit", sa.String(32), nullable=False),
        sa.Column("unit_cost", sa.Numeric(14, 4), nullable=True),
        sa.Column("bought_from", sa.String(120), nullable=True),
        sa.Column("note", sa.String(255), nullable=True),
        sa.Column("recorded_by_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_by_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_consumable_purchases_tool_id", "consumable_purchases", ["tool_id"])
    op.create_index(
        "ix_consumable_purchases_purchased_on", "consumable_purchases", ["purchased_on"]
    )


def downgrade():
    op.drop_index("ix_consumable_purchases_purchased_on", table_name="consumable_purchases")
    op.drop_index("ix_consumable_purchases_tool_id", table_name="consumable_purchases")
    op.drop_table("consumable_purchases")
