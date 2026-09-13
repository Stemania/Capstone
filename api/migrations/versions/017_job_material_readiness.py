"""Add material readiness fields on job_orders for scheduling.

Revision ID: 017_job_material_readiness
Revises: 016_tool_units
Create Date: 2026-09-09

One status + expected/received dates + optional supplier reference.
Defaults: NOT_REQUIRED for REPAIR/MODIFICATION, TO_ORDER for FABRICATION.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "017_job_material_readiness"
down_revision = "016_tool_units"
branch_labels = None
depends_on = None


def upgrade():
    material_status = postgresql.ENUM(
        "NOT_REQUIRED",
        "TO_ORDER",
        "ORDERED",
        "RECEIVED",
        name="materialstatus",
        create_type=False,
    )
    material_status.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "job_orders",
        sa.Column(
            "material_status",
            material_status,
            nullable=False,
            server_default="TO_ORDER",
        ),
    )
    op.add_column(
        "job_orders",
        sa.Column("material_expected_date", sa.Date(), nullable=True),
    )
    op.add_column(
        "job_orders",
        sa.Column("material_received_date", sa.Date(), nullable=True),
    )
    op.add_column(
        "job_orders",
        sa.Column("supplier_reference", sa.String(length=120), nullable=True),
    )
    op.create_index(
        "ix_job_orders_material_status",
        "job_orders",
        ["material_status"],
    )

    op.execute(
        """
        UPDATE job_orders
        SET material_status = CASE
            WHEN job_type IN ('REPAIR', 'MODIFICATION') THEN 'NOT_REQUIRED'::materialstatus
            ELSE 'TO_ORDER'::materialstatus
        END
        """
    )


def downgrade():
    op.drop_index("ix_job_orders_material_status", table_name="job_orders")
    op.drop_column("job_orders", "supplier_reference")
    op.drop_column("job_orders", "material_received_date")
    op.drop_column("job_orders", "material_expected_date")
    op.drop_column("job_orders", "material_status")
    op.execute("DROP TYPE IF EXISTS materialstatus")
