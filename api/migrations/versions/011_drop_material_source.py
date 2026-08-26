"""Drop unused job_orders.material_source column and materialsource enum.

Revision ID: 011_drop_material_source
Revises: 010_user_invitations_device_pins
Create Date: 2026-08-26

The shop procures materials for all job types; CLIENT_SUPPLIED vs SHOP_PROCURED
is unused. PartCondition.CLIENT_SUPPLIED_ITEM remains for existing part-stage data.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "011_drop_material_source"
down_revision = "010_user_invitations_device_pins"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column("job_orders", "material_source")
    op.execute("DROP TYPE IF EXISTS materialsource")


def downgrade():
    material_source = postgresql.ENUM(
        "SHOP_PROCURED",
        "CLIENT_SUPPLIED",
        name="materialsource",
        create_type=False,
    )
    material_source.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "job_orders",
        sa.Column(
            "material_source",
            material_source,
            nullable=False,
            server_default="SHOP_PROCURED",
        ),
    )
    op.alter_column("job_orders", "material_source", server_default=None)
