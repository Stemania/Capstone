"""Suppliers table, material purchases, job_orders.supplier_id.

Revision ID: 020_suppliers_material_purchases
Revises: 019_receive_rework_category
Create Date: 2026-09-21

- Create suppliers (with is_seed)
- Create material_purchases (one line per purchase)
- Add job_orders.supplier_id FK
- Keep supplier_reference as supplier PO / invoice number;
  existing free-text values remain in supplier_reference unchanged
"""

from alembic import op
import sqlalchemy as sa

revision = "020_suppliers_material_purchases"
down_revision = "019_receive_rework_category"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "suppliers",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("contact_person", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=64), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("typical_lead_time_days", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "is_seed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_suppliers_name", "suppliers", ["name"])
    op.create_index("ix_suppliers_active", "suppliers", ["active"])

    op.create_table(
        "material_purchases",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("job_order_id", sa.String(length=36), nullable=False),
        sa.Column("material_name", sa.String(length=255), nullable=False),
        sa.Column("grade_or_spec", sa.String(length=255), nullable=True),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
        sa.Column(
            "unit",
            sa.String(length=32),
            nullable=False,
            server_default="pcs",
        ),
        sa.Column(
            "unit_cost",
            sa.Numeric(14, 4),
            nullable=False,
            server_default="0",
        ),
        sa.Column("supplier_id", sa.String(length=36), nullable=False),
        sa.Column("date_ordered", sa.Date(), nullable=False),
        sa.Column("date_received", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["job_order_id"],
            ["job_orders.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"]),
    )
    op.create_index(
        "ix_material_purchase_job", "material_purchases", ["job_order_id"]
    )
    op.create_index(
        "ix_material_purchase_supplier", "material_purchases", ["supplier_id"]
    )
    op.create_index(
        "ix_material_purchase_ordered", "material_purchases", ["date_ordered"]
    )

    op.add_column(
        "job_orders",
        sa.Column("supplier_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_job_orders_supplier_id_suppliers",
        "job_orders",
        "suppliers",
        ["supplier_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_job_orders_supplier_id", "job_orders", ["supplier_id"])

    # Existing supplier_reference free-text stays as the PO/invoice reference.
    # No rename or data move required.


def downgrade():
    op.drop_index("ix_job_orders_supplier_id", table_name="job_orders")
    op.drop_constraint(
        "fk_job_orders_supplier_id_suppliers", "job_orders", type_="foreignkey"
    )
    op.drop_column("job_orders", "supplier_id")

    op.drop_index("ix_material_purchase_ordered", table_name="material_purchases")
    op.drop_index("ix_material_purchase_supplier", table_name="material_purchases")
    op.drop_index("ix_material_purchase_job", table_name="material_purchases")
    op.drop_table("material_purchases")

    op.drop_index("ix_suppliers_active", table_name="suppliers")
    op.drop_index("ix_suppliers_name", table_name="suppliers")
    op.drop_table("suppliers")
