"""Responsible supplier on each schedule move.

Revision ID: 030_schedule_move_supplier
Revises: 029_schedule_moves
Create Date: 2026-10-03

Lines recorded without a supplier order still have a supplier, so the supplier
is stored on the move itself. Existing moves take it from their supplier order.
"""

from alembic import op
import sqlalchemy as sa

revision = "030_schedule_move_supplier"
down_revision = "029_schedule_moves"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "schedule_moves",
        sa.Column(
            "supplier_id",
            sa.String(36),
            sa.ForeignKey("suppliers.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_schedule_moves_supplier_id", "schedule_moves", ["supplier_id"])
    op.execute(
        """
        UPDATE schedule_moves m SET supplier_id = o.supplier_id
        FROM supplier_orders o WHERE o.id = m.supplier_order_id
        """
    )


def downgrade():
    op.drop_index("ix_schedule_moves_supplier_id", table_name="schedule_moves")
    op.drop_column("schedule_moves", "supplier_id")
