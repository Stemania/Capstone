"""Remember whether staff were alerted that a job is at risk.

Revision ID: 032_job_at_risk_alerted
Revises: 031_move_material_cause
Create Date: 2026-10-05

- job_orders.at_risk_alerted: set when the at-risk bell alert is raised,
  cleared when the job is back on time.
"""

from alembic import op
import sqlalchemy as sa

revision = "032_job_at_risk_alerted"
down_revision = "031_move_material_cause"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "job_orders",
        sa.Column("at_risk_alerted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column("job_orders", "at_risk_alerted")
