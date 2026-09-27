"""Raw material consumption, production stages/op types, sales invoices.

Revision ID: 021_consumption_invoices_stages
Revises: 020_suppliers_material_purchases
Create Date: 2026-09-27

- material_purchases.consumed_at (nullable). Status stays derived:
  CONSUMED if consumed_at, RECEIVED if date_received, else ORDERED.
  Backfill: received lines on jobs that already started get consumed_at =
  the job's earliest operation actual_start.
- partcondition enum: add CUT, FORMED, ASSEMBLED.
- operation_types: insert machine-less CUTTING, BENDING, FORMING, ASSEMBLY,
  FINISHING when the code is not already present.
- sales_invoices table (one per job order, sequential number).
"""

import uuid

from alembic import op
import sqlalchemy as sa

revision = "021_consumption_invoices_stages"
down_revision = "020_suppliers_material_purchases"
branch_labels = None
depends_on = None

NEW_OP_TYPES = [
    ("CUTTING", "Cutting"),
    ("BENDING", "Bending"),
    ("FORMING", "Forming"),
    ("ASSEMBLY", "Assembly"),
    ("FINISHING", "Finishing"),
]


def upgrade():
    with op.get_context().autocommit_block():
        for value in ("CUT", "FORMED", "ASSEMBLED"):
            op.execute(f"ALTER TYPE partcondition ADD VALUE IF NOT EXISTS '{value}'")

    op.add_column(
        "material_purchases",
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        """
        UPDATE material_purchases mp
        SET consumed_at = started.first_start
        FROM (
            SELECT job_order_id, MIN(actual_start) AS first_start
            FROM operations
            WHERE actual_start IS NOT NULL
            GROUP BY job_order_id
        ) AS started
        WHERE mp.job_order_id = started.job_order_id
          AND mp.date_received IS NOT NULL
          AND mp.consumed_at IS NULL
        """
    )

    conn = op.get_bind()
    for code, name in NEW_OP_TYPES:
        exists = conn.execute(
            sa.text("SELECT 1 FROM operation_types WHERE code = :code"),
            {"code": code},
        ).first()
        if not exists:
            conn.execute(
                sa.text(
                    "INSERT INTO operation_types (id, code, name, default_machine_type_id, active) "
                    "VALUES (:id, :code, :name, NULL, true)"
                ),
                {"id": str(uuid.uuid4()), "code": code, "name": name},
            )

    op.create_table(
        "sales_invoices",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("invoice_seq", sa.Integer(), nullable=False),
        sa.Column("invoice_number", sa.String(length=32), nullable=False),
        sa.Column("invoice_date", sa.Date(), nullable=False),
        sa.Column("job_order_id", sa.String(length=36), nullable=False),
        sa.Column("client_id", sa.String(length=36), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("subtotal", sa.Numeric(14, 2), nullable=False),
        sa.Column("vat_rate", sa.Numeric(5, 2), nullable=True),
        sa.Column(
            "vat_amount", sa.Numeric(14, 2), nullable=False, server_default="0"
        ),
        sa.Column("total", sa.Numeric(14, 2), nullable=False),
        sa.Column("prepared_by_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["job_order_id"], ["job_orders.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.ForeignKeyConstraint(["prepared_by_id"], ["users.id"]),
        sa.UniqueConstraint("invoice_seq", name="uq_sales_invoices_seq"),
        sa.UniqueConstraint("invoice_number", name="uq_sales_invoices_number"),
        sa.UniqueConstraint("job_order_id", name="uq_sales_invoices_job"),
    )
    op.create_index("ix_sales_invoices_client", "sales_invoices", ["client_id"])
    op.create_index("ix_sales_invoices_date", "sales_invoices", ["invoice_date"])


def downgrade():
    op.drop_index("ix_sales_invoices_date", table_name="sales_invoices")
    op.drop_index("ix_sales_invoices_client", table_name="sales_invoices")
    op.drop_table("sales_invoices")
    op.drop_column("material_purchases", "consumed_at")
    # New operation_types rows and partcondition values are left in place:
    # Postgres cannot drop enum values, and rows may be referenced by operations.
