"""Material delay fields on job orders.

Revision ID: 026_material_delay
Revises: 025_attendance_records
Create Date: 2026-10-03

- material_delay_original_start: the first operation's planned start before
  the first automatic move for materials; set once, never overwritten.
- material_delay_reason, material_delay_supplier_order_id, material_delayed_at:
  the latest automatic move's reason, responsible supplier order and time.
"""

from alembic import op
import sqlalchemy as sa

revision = "026_material_delay"
down_revision = "025_attendance_records"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "job_orders",
        sa.Column("material_delay_original_start", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("job_orders", sa.Column("material_delay_reason", sa.Text(), nullable=True))
    op.add_column(
        "job_orders",
        sa.Column(
            "material_delay_supplier_order_id",
            sa.String(length=36),
            sa.ForeignKey(
                "supplier_orders.id",
                name="fk_job_orders_material_delay_supplier_order",
                ondelete="SET NULL",
            ),
            nullable=True,
        ),
    )
    op.add_column(
        "job_orders",
        sa.Column("material_delayed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_job_orders_material_delay_supplier_order_id",
        "job_orders",
        ["material_delay_supplier_order_id"],
    )


def downgrade():
    op.drop_index("ix_job_orders_material_delay_supplier_order_id", table_name="job_orders")
    op.drop_constraint(
        "fk_job_orders_material_delay_supplier_order", "job_orders", type_="foreignkey"
    )
    op.drop_column("job_orders", "material_delayed_at")
    op.drop_column("job_orders", "material_delay_supplier_order_id")
    op.drop_column("job_orders", "material_delay_reason")
    op.drop_column("job_orders", "material_delay_original_start")
