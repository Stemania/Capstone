"""PO print tracking, PO line catalog reference, consumable Offered flag.

Revision ID: 053_po_print_and_catalog_refs
Revises: 052_consumable_scan_forecast
Create Date: 2026-10-18

Additive only (no drops or renames of existing columns/tables):
- supplier_orders: printed_at, printed_by_id, print_count
- material_purchases: material_catalog_id (job-material catalog FK),
  size_spec (job-specific dimensions/form; grade stays in grade_or_spec)
- tools: active (Offered / Not offered for catalog consumables; default true)

Existing issued POs are left with printed_at NULL (receive will require print).
Old PO lines without material_catalog_id still display their text snapshot.
"""

from alembic import op
import sqlalchemy as sa

revision = "053_po_print_and_catalog_refs"
down_revision = "052_consumable_scan_forecast"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "supplier_orders",
        sa.Column("printed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "supplier_orders",
        sa.Column("printed_by_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_supplier_orders_printed_by_id_users",
        "supplier_orders",
        "users",
        ["printed_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "supplier_orders",
        sa.Column(
            "print_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )

    op.add_column(
        "material_purchases",
        sa.Column("material_catalog_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_material_purchases_material_catalog_id",
        "material_purchases",
        "material_catalog",
        ["material_catalog_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_material_purchases_material_catalog_id",
        "material_purchases",
        ["material_catalog_id"],
    )
    op.add_column(
        "material_purchases",
        sa.Column("size_spec", sa.String(length=255), nullable=True),
    )

    op.add_column(
        "tools",
        sa.Column(
            "active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade():
    op.drop_column("tools", "active")

    op.drop_column("material_purchases", "size_spec")
    op.drop_index(
        "ix_material_purchases_material_catalog_id",
        table_name="material_purchases",
    )
    op.drop_constraint(
        "fk_material_purchases_material_catalog_id",
        "material_purchases",
        type_="foreignkey",
    )
    op.drop_column("material_purchases", "material_catalog_id")

    op.drop_column("supplier_orders", "print_count")
    op.drop_constraint(
        "fk_supplier_orders_printed_by_id_users",
        "supplier_orders",
        type_="foreignkey",
    )
    op.drop_column("supplier_orders", "printed_by_id")
    op.drop_column("supplier_orders", "printed_at")
