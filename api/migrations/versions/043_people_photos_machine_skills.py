"""Real people: nicknames, photos, optional email; skills are for machines only.

Revision ID: 043_people_photos_machine_skills
Revises: 042_po_number_per_supplier_year
Create Date: 2026-10-10

- users.email becomes optional: imported employees have no email until the
  Admin invites them (still unique when set).
- users.nickname: optional short name shown with the full name.
- users.photo_updated_at + user_photos: one 128x128 JPEG per user, stored in
  the database because the host's disk is wiped on every deploy.
- worker_skills: skills on operation types without a machine are deleted (the
  row count is printed), and the operation_type_id column is dropped. Every
  worker qualifies for operations without a machine.
"""

import sqlalchemy as sa
from alembic import op

revision = "043_people_photos_machine_skills"
down_revision = "042_po_number_per_supplier_year"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("users", "email", existing_type=sa.String(length=255), nullable=True)
    op.add_column("users", sa.Column("nickname", sa.String(length=40), nullable=True))
    op.add_column("users", sa.Column("photo_updated_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "user_photos",
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    conn = op.get_bind()
    count = conn.execute(
        sa.text("SELECT count(*) FROM worker_skills WHERE machine_type_id IS NULL")
    ).scalar()
    print(f"043: deleting {count} skill row(s) for operation types without a machine")
    conn.execute(sa.text("DELETE FROM worker_skills WHERE machine_type_id IS NULL"))

    op.drop_constraint("ck_worker_skill_one_target", "worker_skills", type_="check")
    op.drop_constraint("uq_worker_skill_operation_type", "worker_skills", type_="unique")
    op.drop_index("ix_worker_skills_operation_type_id", table_name="worker_skills")
    op.drop_constraint("fk_worker_skills_operation_type_id", "worker_skills", type_="foreignkey")
    op.drop_column("worker_skills", "operation_type_id")
    op.alter_column(
        "worker_skills", "machine_type_id", existing_type=sa.String(length=36), nullable=False
    )


def downgrade():
    op.alter_column(
        "worker_skills", "machine_type_id", existing_type=sa.String(length=36), nullable=True
    )
    op.add_column(
        "worker_skills", sa.Column("operation_type_id", sa.String(length=36), nullable=True)
    )
    op.create_foreign_key(
        "fk_worker_skills_operation_type_id",
        "worker_skills",
        "operation_types",
        ["operation_type_id"],
        ["id"],
    )
    op.create_index(
        "ix_worker_skills_operation_type_id", "worker_skills", ["operation_type_id"]
    )
    op.create_unique_constraint(
        "uq_worker_skill_operation_type", "worker_skills", ["worker_id", "operation_type_id"]
    )
    op.create_check_constraint(
        "ck_worker_skill_one_target",
        "worker_skills",
        "(machine_type_id IS NULL) <> (operation_type_id IS NULL)",
    )
    # The deleted operation-type skills are not restored.

    op.drop_table("user_photos")
    op.drop_column("users", "photo_updated_at")
    op.drop_column("users", "nickname")
    # Fails while any user has no email; give them one first.
    op.alter_column("users", "email", existing_type=sa.String(length=255), nullable=False)
