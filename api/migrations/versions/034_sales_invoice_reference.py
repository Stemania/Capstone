"""Sales invoices become references to the shop's BIR-registered invoice.

Revision ID: 034_sales_invoice_reference
Revises: 033_notification_not_sent
Create Date: 2026-10-06

The system no longer numbers invoices (BMSC-INV-#####). Office Staff enter the
number from the official invoice, so the sequence and description are optional
and the number can be longer. Existing invoices keep their numbers.
"""

import sqlalchemy as sa
from alembic import op

revision = "034_sales_invoice_reference"
down_revision = "033_notification_not_sent"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("sales_invoices") as batch:
        batch.alter_column("invoice_seq", existing_type=sa.Integer(), nullable=True)
        batch.alter_column("description", existing_type=sa.Text(), nullable=True)
        batch.alter_column(
            "invoice_number",
            existing_type=sa.String(length=32),
            type_=sa.String(length=64),
            existing_nullable=False,
        )


def downgrade():
    # Recorded references have no sequence; give them one so the column can be required again.
    op.execute(
        """
        UPDATE sales_invoices AS si
        SET invoice_seq = numbered.seq
        FROM (
            SELECT id,
                   COALESCE((SELECT MAX(invoice_seq) FROM sales_invoices), 0)
                   + ROW_NUMBER() OVER (ORDER BY created_at, id) AS seq
            FROM sales_invoices
            WHERE invoice_seq IS NULL
        ) AS numbered
        WHERE si.id = numbered.id
        """
    )
    op.execute("UPDATE sales_invoices SET description = '' WHERE description IS NULL")
    with op.batch_alter_table("sales_invoices") as batch:
        batch.alter_column(
            "invoice_number",
            existing_type=sa.String(length=64),
            type_=sa.String(length=32),
            existing_nullable=False,
        )
        batch.alter_column("description", existing_type=sa.Text(), nullable=False)
        batch.alter_column("invoice_seq", existing_type=sa.Integer(), nullable=False)
