"""Shop process: lunch break setting, skills for operations without a machine,
outsourced operations, and the Layout / Fitting operation types.

Revision ID: 035_shop_process
Revises: 034_sales_invoice_reference
Create Date: 2026-10-06

- shop_settings: one row holding the daily break (12:00-13:00 by default).
- worker_skills: a skill is either on a machine type or on an operation type
  that uses no machine (exactly one of the two).
- operation_types: is_outsourced + default_turnaround_days. Heat Treatment is
  outsourced with a 3-day default turnaround.
- operations: turnaround_days, sent_out_date, sent_to, returned_date.
  Heat Treatment operations not yet started lose their worker, machine and
  target hours and take the 3-day turnaround. Started or completed ones keep
  their history.
- New operation types Layout and Fitting; Finishing is shown as
  "Finishing (Bapping)".
"""

import uuid

import sqlalchemy as sa
from alembic import op

revision = "035_shop_process"
down_revision = "034_sales_invoice_reference"
branch_labels = None
depends_on = None

HEAT_TREATMENT_TURNAROUND_DAYS = 3
NEW_OP_TYPES = [("LAYOUT", "Layout"), ("FITTING", "Fitting")]


def upgrade():
    op.create_table(
        "shop_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("break_start", sa.Time(), nullable=False),
        sa.Column("break_end", sa.Time(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=True),
    )
    op.execute(
        "INSERT INTO shop_settings (id, break_start, break_end, updated_at) "
        "VALUES (1, '12:00', '13:00', now())"
    )

    with op.batch_alter_table("worker_skills") as batch:
        batch.alter_column("machine_type_id", existing_type=sa.String(length=36), nullable=True)
        batch.add_column(sa.Column("operation_type_id", sa.String(length=36), nullable=True))
        batch.create_foreign_key(
            "fk_worker_skills_operation_type_id",
            "operation_types",
            ["operation_type_id"],
            ["id"],
        )
        batch.create_index("ix_worker_skills_operation_type_id", ["operation_type_id"])
        batch.create_unique_constraint(
            "uq_worker_skill_operation_type", ["worker_id", "operation_type_id"]
        )
        batch.create_check_constraint(
            "ck_worker_skill_one_target",
            "(machine_type_id IS NULL) <> (operation_type_id IS NULL)",
        )

    with op.batch_alter_table("operation_types") as batch:
        batch.add_column(
            sa.Column("is_outsourced", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch.add_column(sa.Column("default_turnaround_days", sa.Integer(), nullable=True))

    with op.batch_alter_table("operations") as batch:
        batch.add_column(sa.Column("turnaround_days", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("sent_out_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("sent_to", sa.String(length=255), nullable=True))
        batch.add_column(sa.Column("returned_date", sa.Date(), nullable=True))

    conn = op.get_bind()
    for code, name in NEW_OP_TYPES:
        exists = conn.execute(
            sa.text("SELECT 1 FROM operation_types WHERE code = :code"), {"code": code}
        ).first()
        if not exists:
            conn.execute(
                sa.text(
                    "INSERT INTO operation_types "
                    "(id, code, name, default_machine_type_id, active, is_outsourced) "
                    "VALUES (:id, :code, :name, NULL, true, false)"
                ),
                {"id": str(uuid.uuid4()), "code": code, "name": name},
            )
    conn.execute(
        sa.text("UPDATE operation_types SET name = 'Finishing (Bapping)' WHERE code = 'FINISHING'")
    )
    conn.execute(
        sa.text(
            "UPDATE operation_types SET is_outsourced = true, default_turnaround_days = :days, "
            "default_machine_type_id = NULL WHERE code = 'HEAT_TREATMENT'"
        ),
        {"days": HEAT_TREATMENT_TURNAROUND_DAYS},
    )
    conn.execute(
        sa.text(
            """
            UPDATE operations
            SET assigned_worker_id = NULL,
                machine_type_id = NULL,
                machine_unit_id = NULL,
                estimated_hours = NULL,
                turnaround_days = :days
            WHERE actual_start IS NULL
              AND status IN ('PENDING', 'SCHEDULED', 'REWORK')
              AND operation_type_id IN (
                  SELECT id FROM operation_types WHERE is_outsourced = true
              )
            """
        ),
        {"days": HEAT_TREATMENT_TURNAROUND_DAYS},
    )


def downgrade():
    # Skills on operation types have no machine to fall back to.
    op.execute("DELETE FROM worker_skills WHERE machine_type_id IS NULL")
    op.execute("UPDATE operation_types SET name = 'Finishing' WHERE code = 'FINISHING'")

    with op.batch_alter_table("operations") as batch:
        batch.drop_column("returned_date")
        batch.drop_column("sent_to")
        batch.drop_column("sent_out_date")
        batch.drop_column("turnaround_days")

    with op.batch_alter_table("operation_types") as batch:
        batch.drop_column("default_turnaround_days")
        batch.drop_column("is_outsourced")

    with op.batch_alter_table("worker_skills") as batch:
        batch.drop_constraint("ck_worker_skill_one_target", type_="check")
        batch.drop_constraint("uq_worker_skill_operation_type", type_="unique")
        batch.drop_index("ix_worker_skills_operation_type_id")
        batch.drop_constraint("fk_worker_skills_operation_type_id", type_="foreignkey")
        batch.drop_column("operation_type_id")
        batch.alter_column("machine_type_id", existing_type=sa.String(length=36), nullable=False)

    op.drop_table("shop_settings")
    # Layout and Fitting rows are left in place; operations may reference them.
