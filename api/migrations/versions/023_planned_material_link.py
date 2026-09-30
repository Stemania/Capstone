"""Link material purchases to the job's planned raw materials by id.

Revision ID: 023_planned_material_link
Revises: 022_downtime_job_link_category
Create Date: 2026-09-29

- Every object in job_orders.raw_materials gets a stable "id" (uuid4) when it
  has none. Name, quantity and unit are left untouched; order is kept.
- material_purchases.planned_material_id (nullable, indexed). Existing
  purchases stay NULL ("Other material"): the only thing that could link them
  is the material name, which is not reliable.
"""

import json
import uuid

from alembic import op
import sqlalchemy as sa

revision = "023_planned_material_link"
down_revision = "022_downtime_job_link_category"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "material_purchases",
        sa.Column("planned_material_id", sa.String(length=36), nullable=True),
    )
    op.create_index(
        "ix_material_purchases_planned_material_id",
        "material_purchases",
        ["planned_material_id"],
    )

    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, raw_materials FROM job_orders "
            "WHERE jsonb_typeof(raw_materials) = 'array' "
            "AND jsonb_array_length(raw_materials) > 0"
        )
    ).fetchall()
    for job_id, items in rows:
        changed = False
        out = []
        for item in items:
            if isinstance(item, dict) and not item.get("id"):
                item = {**item, "id": str(uuid.uuid4())}
                changed = True
            out.append(item)
        if changed:
            bind.execute(
                sa.text(
                    "UPDATE job_orders SET raw_materials = CAST(:rm AS jsonb) WHERE id = :id"
                ),
                {"rm": json.dumps(out), "id": job_id},
            )


def downgrade():
    op.drop_index(
        "ix_material_purchases_planned_material_id", table_name="material_purchases"
    )
    op.drop_column("material_purchases", "planned_material_id")
    op.execute(
        """
        UPDATE job_orders
        SET raw_materials = (
            SELECT jsonb_agg(
                CASE WHEN jsonb_typeof(e) = 'object' THEN e - 'id' ELSE e END
                ORDER BY ord
            )
            FROM jsonb_array_elements(raw_materials) WITH ORDINALITY AS t(e, ord)
        )
        WHERE jsonb_typeof(raw_materials) = 'array'
          AND jsonb_array_length(raw_materials) > 0
        """
    )
