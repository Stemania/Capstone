"""Consumable restock lines on supplier orders.

Revision ID: 037_consumable_po_lines
Revises: 036_downtime_expected_repair
Create Date: 2026-10-07

- material_purchases.job_order_id becomes nullable; new tool_id links a
  consumable restock line. Exactly one of the two is set.
- tool_events.material_purchase_id links a RECEIVE to the PO line it came
  from (NULL for Receive delivery without a PO).
"""

from alembic import op
import sqlalchemy as sa

revision = "037_consumable_po_lines"
down_revision = "036_downtime_expected_repair"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "material_purchases",
        sa.Column("tool_id", sa.String(36), nullable=True),
    )
    op.create_foreign_key(
        "fk_material_purchases_tool_id",
        "material_purchases",
        "tools",
        ["tool_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_material_purchases_tool_id", "material_purchases", ["tool_id"])
    op.alter_column("material_purchases", "job_order_id", existing_type=sa.String(36), nullable=True)
    op.create_check_constraint(
        "ck_material_purchase_job_or_consumable",
        "material_purchases",
        "(job_order_id IS NULL) <> (tool_id IS NULL)",
    )

    op.add_column(
        "tool_events",
        sa.Column("material_purchase_id", sa.String(36), nullable=True),
    )
    op.create_foreign_key(
        "fk_tool_events_material_purchase_id",
        "tool_events",
        "material_purchases",
        ["material_purchase_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_tool_events_material_purchase_id", "tool_events", ["material_purchase_id"]
    )


def downgrade():
    op.drop_index("ix_tool_events_material_purchase_id", table_name="tool_events")
    op.drop_constraint("fk_tool_events_material_purchase_id", "tool_events", type_="foreignkey")
    op.drop_column("tool_events", "material_purchase_id")

    op.drop_constraint(
        "ck_material_purchase_job_or_consumable", "material_purchases", type_="check"
    )
    op.execute("DELETE FROM material_purchases WHERE job_order_id IS NULL")
    op.alter_column("material_purchases", "job_order_id", existing_type=sa.String(36), nullable=False)
    op.drop_index("ix_material_purchases_tool_id", table_name="material_purchases")
    op.drop_constraint("fk_material_purchases_tool_id", "material_purchases", type_="foreignkey")
    op.drop_column("material_purchases", "tool_id")
