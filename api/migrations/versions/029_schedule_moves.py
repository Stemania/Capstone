"""Keep the kind of delay with each automatic schedule move.

Revision ID: 029_schedule_moves
Revises: 028_expected_delivery_changes
Create Date: 2026-10-03

- job_orders.delay_kind: MATERIAL or RESCHEDULED for the latest move.
- schedule_moves: one row per move (kind, previous and new first start,
  reason, responsible supplier order).

Every move recorded before this revision came from materials, so existing
delayed jobs get MATERIAL and one history row built from the stored fields.
"""

from alembic import op
import sqlalchemy as sa

revision = "029_schedule_moves"
down_revision = "028_expected_delivery_changes"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("job_orders", sa.Column("delay_kind", sa.String(20), nullable=True))
    op.create_table(
        "schedule_moves",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "job_order_id",
            sa.String(36),
            sa.ForeignKey("job_orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("previous_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("new_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "supplier_order_id",
            sa.String(36),
            sa.ForeignKey("supplier_orders.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("moved_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_schedule_moves_job_order_id", "schedule_moves", ["job_order_id"])
    op.create_index("ix_schedule_moves_kind", "schedule_moves", ["kind"])
    op.create_index("ix_schedule_moves_moved_at", "schedule_moves", ["moved_at"])

    op.execute("UPDATE job_orders SET delay_kind = 'MATERIAL' WHERE material_delayed_at IS NOT NULL")
    op.execute(
        """
        INSERT INTO schedule_moves
            (id, job_order_id, kind, previous_start, new_start, reason, supplier_order_id, moved_at)
        SELECT md5(random()::text || j.id)::uuid::text, j.id, 'MATERIAL',
               j.material_delay_original_start,
               (SELECT o.scheduled_start FROM operations o
                 WHERE o.job_order_id = j.id AND o.scheduled_start IS NOT NULL
                 ORDER BY o.sequence_no LIMIT 1),
               j.material_delay_reason, j.material_delay_supplier_order_id, j.material_delayed_at
        FROM job_orders j
        WHERE j.material_delayed_at IS NOT NULL
          AND j.material_delay_original_start IS NOT NULL
          AND EXISTS (SELECT 1 FROM operations o
                       WHERE o.job_order_id = j.id AND o.scheduled_start IS NOT NULL)
        """
    )


def downgrade():
    op.drop_index("ix_schedule_moves_moved_at", table_name="schedule_moves")
    op.drop_index("ix_schedule_moves_kind", table_name="schedule_moves")
    op.drop_index("ix_schedule_moves_job_order_id", table_name="schedule_moves")
    op.drop_table("schedule_moves")
    op.drop_column("job_orders", "delay_kind")
