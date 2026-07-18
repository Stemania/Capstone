"""Add PO-aligned job fields: quantity, amount, priority, raw materials, machines

Revision ID: 002_job_po_fields
Revises: 001_initial
Create Date: 2026-07-18

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "002_job_po_fields"
down_revision = "001_initial"
branch_labels = None
depends_on = None


def upgrade():
    priority = postgresql.ENUM(
        "HIGH", "MODERATE", "LOW", name="jobpriority", create_type=False
    )
    priority.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "job_orders",
        sa.Column(
            "priority",
            priority,
            nullable=False,
            server_default="MODERATE",
        ),
    )
    op.add_column("job_orders", sa.Column("quantity", sa.Numeric(12, 2), nullable=True))
    op.add_column("job_orders", sa.Column("unit_of_measure", sa.String(32), nullable=True))
    op.add_column("job_orders", sa.Column("amount", sa.Numeric(14, 2), nullable=True))
    op.add_column(
        "job_orders",
        sa.Column(
            "raw_materials",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.create_index("ix_job_orders_priority", "job_orders", ["priority"])

    op.add_column(
        "operations",
        sa.Column(
            "machines_needed",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade():
    op.drop_column("operations", "machines_needed")
    op.drop_index("ix_job_orders_priority", table_name="job_orders")
    op.drop_column("job_orders", "raw_materials")
    op.drop_column("job_orders", "amount")
    op.drop_column("job_orders", "unit_of_measure")
    op.drop_column("job_orders", "quantity")
    op.drop_column("job_orders", "priority")
    sa.Enum(name="jobpriority").drop(op.get_bind(), checkfirst=True)
