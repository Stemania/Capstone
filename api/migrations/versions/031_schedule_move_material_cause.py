"""Cause of each MATERIAL schedule move: supplier late or not ordered.

Revision ID: 031_move_material_cause
Revises: 030_schedule_move_supplier
Create Date: 2026-10-03

Existing MATERIAL moves are classified from their reason text: moves triggered
by an overdue delivery, a later expected delivery date or a late receipt are
SUPPLIER_LATE; the rest (unordered materials, orders issued too late) are
NOT_ORDERED.
"""

from alembic import op
import sqlalchemy as sa

revision = "031_move_material_cause"
down_revision = "030_schedule_move_supplier"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("schedule_moves", sa.Column("material_cause", sa.String(20), nullable=True))
    op.execute(
        """
        UPDATE schedule_moves SET material_cause = CASE
            WHEN reason NOT ILIKE 'Overdue re-plan%%' AND (
                reason ILIKE '%%overdue:%%'
                OR reason ILIKE '%%expected delivery changed:%%'
                OR reason ILIKE '%%received:%%'
                OR reason ILIKE 'Late delivery:%%'
            ) THEN 'SUPPLIER_LATE'
            ELSE 'NOT_ORDERED'
        END
        WHERE kind = 'MATERIAL'
        """
    )


def downgrade():
    op.drop_column("schedule_moves", "material_cause")
