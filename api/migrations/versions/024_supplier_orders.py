"""Supplier purchase orders grouping material lines from several job orders.

Revision ID: 024_supplier_orders
Revises: 023_planned_material_link
Create Date: 2026-09-29

- New table supplier_orders (PO number BMSC-PO-00001..., status, dates,
  notes, VAT rate, prepared by / issued by). At most one DRAFT per supplier.
- material_purchases.supplier_order_id (nullable FK, indexed). Existing lines
  stay NULL = "recorded without a PO"; nothing is grouped into orders.
- material_purchases.cancelled_at / cancelled_by_id: lines on an issued order
  are cancelled, not edited or deleted.
- material_purchases.date_ordered becomes nullable: a line on a draft order
  has no order date until the order is issued. Existing rows all keep theirs.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "024_supplier_orders"
down_revision = "023_planned_material_link"
branch_labels = None
depends_on = None

STATUSES = ("DRAFT", "ISSUED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED")


def upgrade():
    status_enum = postgresql.ENUM(*STATUSES, name="supplierorderstatus")
    status_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "supplier_orders",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("po_seq", sa.Integer(), nullable=True, unique=True),
        sa.Column("po_number", sa.String(length=32), nullable=True, unique=True),
        sa.Column(
            "supplier_id",
            sa.String(length=36),
            sa.ForeignKey("suppliers.id"),
            nullable=False,
        ),
        sa.Column(
            "status",
            postgresql.ENUM(*STATUSES, name="supplierorderstatus", create_type=False),
            nullable=False,
            server_default="DRAFT",
        ),
        sa.Column("date_issued", sa.Date(), nullable=True),
        sa.Column("expected_delivery_date", sa.Date(), nullable=True),
        sa.Column("received_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("vat_rate", sa.Numeric(5, 2), nullable=True),
        sa.Column(
            "prepared_by_id",
            sa.String(length=36),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "issued_by_id",
            sa.String(length=36),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_supplier_orders_supplier_id", "supplier_orders", ["supplier_id"])
    op.create_index("ix_supplier_orders_status", "supplier_orders", ["status"])
    op.create_index(
        "uq_supplier_orders_one_draft",
        "supplier_orders",
        ["supplier_id"],
        unique=True,
        postgresql_where=sa.text("status = 'DRAFT'"),
    )

    op.add_column(
        "material_purchases",
        sa.Column("supplier_order_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_material_purchases_supplier_order_id",
        "material_purchases",
        "supplier_orders",
        ["supplier_order_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_material_purchases_supplier_order_id",
        "material_purchases",
        ["supplier_order_id"],
    )
    op.add_column(
        "material_purchases",
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "material_purchases",
        sa.Column("cancelled_by_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_material_purchases_cancelled_by_id",
        "material_purchases",
        "users",
        ["cancelled_by_id"],
        ["id"],
    )
    op.alter_column("material_purchases", "date_ordered", nullable=True)


def downgrade():
    # Lines that only ever existed on a supplier order (drafts, or cancelled)
    # cannot be represented without one; remove them before restoring NOT NULL.
    op.execute("DELETE FROM material_purchases WHERE supplier_order_id IS NOT NULL AND (date_ordered IS NULL OR cancelled_at IS NOT NULL)")
    op.alter_column("material_purchases", "date_ordered", nullable=False)
    op.drop_constraint(
        "fk_material_purchases_cancelled_by_id", "material_purchases", type_="foreignkey"
    )
    op.drop_column("material_purchases", "cancelled_by_id")
    op.drop_column("material_purchases", "cancelled_at")
    op.drop_index("ix_material_purchases_supplier_order_id", table_name="material_purchases")
    op.drop_constraint(
        "fk_material_purchases_supplier_order_id", "material_purchases", type_="foreignkey"
    )
    op.drop_column("material_purchases", "supplier_order_id")
    op.drop_index("uq_supplier_orders_one_draft", table_name="supplier_orders")
    op.drop_index("ix_supplier_orders_status", table_name="supplier_orders")
    op.drop_index("ix_supplier_orders_supplier_id", table_name="supplier_orders")
    op.drop_table("supplier_orders")
    postgresql.ENUM(name="supplierorderstatus").drop(op.get_bind(), checkfirst=True)
