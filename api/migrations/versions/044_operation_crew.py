"""Crews: up to two helpers per operation.

Revision ID: 044_operation_crew
Revises: 043_people_photos_machine_skills
Create Date: 2026-10-10

The operation's assigned worker stays as the lead; helpers go in
operation_helpers (position 1 or 2). Existing operations keep their worker as
lead with no helpers, so nothing is copied.
"""

import sqlalchemy as sa
from alembic import op

revision = "044_operation_crew"
down_revision = "043_people_photos_machine_skills"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "operation_helpers",
        sa.Column(
            "operation_id",
            sa.String(length=36),
            sa.ForeignKey("operations.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "worker_id", sa.String(length=36), sa.ForeignKey("users.id"), primary_key=True
        ),
        sa.Column("position", sa.SmallInteger(), nullable=False, server_default="1"),
        sa.CheckConstraint("position IN (1, 2)", name="ck_operation_helper_position"),
    )
    op.create_index("ix_operation_helpers_worker_id", "operation_helpers", ["worker_id"])


def downgrade():
    op.drop_index("ix_operation_helpers_worker_id", table_name="operation_helpers")
    op.drop_table("operation_helpers")
