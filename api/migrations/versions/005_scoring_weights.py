"""Configurable scoring weights for worker recommendations.

Revision ID: 005_scoring_weights
Revises: 004_worker_skills
Create Date: 2026-08-10

"""
from alembic import op
import sqlalchemy as sa
import uuid

revision = "005_scoring_weights"
down_revision = "004_worker_skills"
branch_labels = None
depends_on = None

SEED = [
    ("skill", "0.4000"),
    ("availability", "0.3000"),
    ("workload", "0.2000"),
    ("efficiency", "0.1000"),
]


def upgrade():
    op.create_table(
        "scoring_weights",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("key", sa.String(32), nullable=False),
        sa.Column("value", sa.Numeric(5, 4), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_scoring_weights_key", "scoring_weights", ["key"], unique=True)

    bind = op.get_bind()
    for key, value in SEED:
        bind.execute(
            sa.text(
                "INSERT INTO scoring_weights (id, key, value, updated_at) "
                "VALUES (:id, :key, :value, NOW())"
            ),
            {"id": str(uuid.uuid4()), "key": key, "value": value},
        )


def downgrade():
    op.drop_index("ix_scoring_weights_key", table_name="scoring_weights")
    op.drop_table("scoring_weights")
