"""Add actor, note and structured changes on schedule_moves.

Revision ID: 050_schedule_move_audit
Revises: 049_notification_log_all_sends
Create Date: 2026-10-17

Additive only: moved_by_id (who applied a manual move; null for automatic),
note (free-text, e.g. Other reason), and changes (JSONB diff of what moved).
No data backfill. Revision id kept ≤32 chars for alembic_version.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "050_schedule_move_audit"
down_revision = "049_notification_log_all_sends"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "schedule_moves",
        sa.Column("moved_by_id", sa.String(36), nullable=True),
    )
    op.create_foreign_key(
        "fk_schedule_moves_moved_by_id_users",
        "schedule_moves",
        "users",
        ["moved_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_schedule_moves_moved_by_id",
        "schedule_moves",
        ["moved_by_id"],
    )
    op.add_column("schedule_moves", sa.Column("note", sa.Text(), nullable=True))
    op.add_column(
        "schedule_moves",
        sa.Column("changes", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade():
    op.drop_column("schedule_moves", "changes")
    op.drop_column("schedule_moves", "note")
    op.drop_index("ix_schedule_moves_moved_by_id", table_name="schedule_moves")
    op.drop_constraint(
        "fk_schedule_moves_moved_by_id_users",
        "schedule_moves",
        type_="foreignkey",
    )
    op.drop_column("schedule_moves", "moved_by_id")
