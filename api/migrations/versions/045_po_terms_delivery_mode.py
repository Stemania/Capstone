"""Purchase order terms of payment and mode of delivery.

Revision ID: 045_po_terms_delivery_mode
Revises: 044_operation_crew
Create Date: 2026-10-10

Both print on the PO. Existing orders get the defaults: terms "PDC" and
mode "DELIVERY".
"""

import sqlalchemy as sa
from alembic import op

revision = "045_po_terms_delivery_mode"
down_revision = "044_operation_crew"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "supplier_orders",
        sa.Column("terms_of_payment", sa.String(length=100), nullable=False, server_default="PDC"),
    )
    op.add_column(
        "supplier_orders",
        sa.Column("delivery_mode", sa.String(length=16), nullable=False, server_default="DELIVERY"),
    )
    op.create_check_constraint(
        "ck_supplier_orders_delivery_mode",
        "supplier_orders",
        "delivery_mode IN ('PICKUP', 'DELIVERY')",
    )


def downgrade():
    op.drop_constraint("ck_supplier_orders_delivery_mode", "supplier_orders", type_="check")
    op.drop_column("supplier_orders", "delivery_mode")
    op.drop_column("supplier_orders", "terms_of_payment")
