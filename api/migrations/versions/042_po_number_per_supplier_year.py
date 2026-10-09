"""PO numbers per supplier per year: supplier code + 2-digit year + 6-digit
sequence, e.g. STP26000001.

Revision ID: 042_po_number_per_supplier_year
Revises: 041_supplier_reference_loaded_at
Create Date: 2026-10-10

- supplier_orders.po_year: the year of the new-format number (NULL for orders
  issued before, which keep their BMSC-PO-00012 numbers).
- po_seq is no longer unique shop-wide; (supplier, po_year, po_seq) is unique
  for new-format numbers. po_number stays unique.

No existing order, number or line changes.
"""

import sqlalchemy as sa
from alembic import op

revision = "042_po_number_per_supplier_year"
down_revision = "041_supplier_reference_loaded_at"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("supplier_orders", sa.Column("po_year", sa.SmallInteger(), nullable=True))
    op.drop_constraint("supplier_orders_po_seq_key", "supplier_orders", type_="unique")
    op.create_index(
        "uq_supplier_orders_supplier_year_seq",
        "supplier_orders",
        ["supplier_id", "po_year", "po_seq"],
        unique=True,
        postgresql_where=sa.text("po_year IS NOT NULL"),
    )


def downgrade():
    op.drop_index("uq_supplier_orders_supplier_year_seq", table_name="supplier_orders")
    # Fails if new-format orders share a sequence number; renumber them first.
    op.create_unique_constraint("supplier_orders_po_seq_key", "supplier_orders", ["po_seq"])
    op.drop_column("supplier_orders", "po_year")
