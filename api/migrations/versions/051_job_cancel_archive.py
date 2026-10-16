"""Job order cancel audit, CANCELLED status, and archive columns.

Revision ID: 051_job_cancel_archive
Revises: 050_schedule_move_audit
Create Date: 2026-10-17

Additive only:
- joborderstatus enum value CANCELLED (Postgres cannot drop enum labels on downgrade)
- job_orders: cancelled_at, cancelled_by_id, cancel_reason, cancel_note,
  archived_at, archived_by_id
- material_purchases: review_after_job_cancel (flag open lines when a job is cancelled)
No data backfill or destructive changes.
"""

from alembic import op
import sqlalchemy as sa

revision = "051_job_cancel_archive"
down_revision = "050_schedule_move_audit"
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE joborderstatus ADD VALUE IF NOT EXISTS 'CANCELLED'")

    op.add_column(
        "job_orders",
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "job_orders",
        sa.Column("cancelled_by_id", sa.String(36), nullable=True),
    )
    op.create_foreign_key(
        "fk_job_orders_cancelled_by_id_users",
        "job_orders",
        "users",
        ["cancelled_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_job_orders_cancelled_by_id", "job_orders", ["cancelled_by_id"])
    op.add_column(
        "job_orders",
        sa.Column("cancel_reason", sa.String(40), nullable=True),
    )
    op.add_column("job_orders", sa.Column("cancel_note", sa.Text(), nullable=True))

    op.add_column(
        "job_orders",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_job_orders_archived_at", "job_orders", ["archived_at"])
    op.add_column(
        "job_orders",
        sa.Column("archived_by_id", sa.String(36), nullable=True),
    )
    op.create_foreign_key(
        "fk_job_orders_archived_by_id_users",
        "job_orders",
        "users",
        ["archived_by_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column(
        "material_purchases",
        sa.Column(
            "review_after_job_cancel",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade():
    # App code after downgrade has no CANCELLED; map any cancelled rows back to DRAFT.
    op.execute(
        """
        UPDATE job_orders
        SET status = 'DRAFT'
        WHERE status::text = 'CANCELLED'
        """
    )
    op.drop_column("material_purchases", "review_after_job_cancel")

    op.drop_constraint(
        "fk_job_orders_archived_by_id_users", "job_orders", type_="foreignkey"
    )
    op.drop_column("job_orders", "archived_by_id")
    op.drop_index("ix_job_orders_archived_at", table_name="job_orders")
    op.drop_column("job_orders", "archived_at")

    op.drop_column("job_orders", "cancel_note")
    op.drop_column("job_orders", "cancel_reason")
    op.drop_index("ix_job_orders_cancelled_by_id", table_name="job_orders")
    op.drop_constraint(
        "fk_job_orders_cancelled_by_id_users", "job_orders", type_="foreignkey"
    )
    op.drop_column("job_orders", "cancelled_by_id")
    op.drop_column("job_orders", "cancelled_at")
    # CANCELLED enum label cannot be removed from Postgres; leave it unused.
