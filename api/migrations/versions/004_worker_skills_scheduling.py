"""Worker skills, schedules, calendar exceptions, operation types.

Revision ID: 004_worker_skills
Revises: 003_operation_level
Create Date: 2026-08-10

"""
import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid

revision = "004_worker_skills"
down_revision = "003_operation_level"
branch_labels = None
depends_on = None

OPERATION_TYPE_SEED = [
    {"code": "BLANKING", "name": "Blanking", "machine": "LATHE"},
    {"code": "TURNING", "name": "Turning", "machine": "LATHE"},
    {"code": "FACING", "name": "Facing", "machine": "LATHE"},
    {"code": "THREADING", "name": "Threading", "machine": "LATHE"},
    {"code": "TEETH_CUTTING", "name": "Teeth Cutting", "machine": "MILLING"},
    {"code": "SLOTTING", "name": "Slotting", "machine": "MILLING"},
    {"code": "GROOVING", "name": "Grooving", "machine": "MILLING"},
    {"code": "DRILLING", "name": "Drilling", "machine": "DRILLING"},
    {"code": "KEYWAY", "name": "Keyway", "machine": "SHAPER"},
    {"code": "SPLINE", "name": "Spline", "machine": "SHAPER"},
    {"code": "SURFACE_GRINDING", "name": "Surface Grinding", "machine": "GRINDING"},
    {"code": "HEAT_TREATMENT", "name": "Heat Treatment", "machine": None},
    {"code": "CHECKING", "name": "Checking", "machine": None},
    {"code": "WELDING", "name": "Welding", "machine": None},
]

SKILL_TOKEN_TO_MACHINE = {
    "lathe": "LATHE",
    "milling": "MILLING",
    "grinding": "GRINDING",
    "drilling": "DRILLING",
    "shaper": "SHAPER",
}


def upgrade():
    bind = op.get_bind()

    calendar_type = postgresql.ENUM(
        "OVERTIME",
        "SPECIAL_WORKING_DAY",
        "HOLIDAY_NO_WORK",
        name="calendarexceptiontype",
        create_type=False,
    )
    calendar_type.create(bind, checkfirst=True)

    op.create_table(
        "operation_types",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column(
            "default_machine_type_id",
            sa.String(36),
            sa.ForeignKey("machine_types.id"),
            nullable=True,
        ),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.create_index("ix_operation_types_code", "operation_types", ["code"], unique=True)
    op.create_index(
        "ix_operation_types_default_machine_type_id",
        "operation_types",
        ["default_machine_type_id"],
    )

    op.create_table(
        "worker_skills",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "worker_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "machine_type_id",
            sa.String(36),
            sa.ForeignKey("machine_types.id"),
            nullable=False,
        ),
        sa.Column("proficiency", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.UniqueConstraint("worker_id", "machine_type_id", name="uq_worker_skill_machine"),
    )
    op.create_index("ix_worker_skills_worker_id", "worker_skills", ["worker_id"])
    op.create_index("ix_worker_skills_machine_type_id", "worker_skills", ["machine_type_id"])

    op.create_table(
        "worker_schedules",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "worker_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("day_of_week", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=True),
        sa.Column("end_time", sa.Time(), nullable=True),
        sa.Column("is_working", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.UniqueConstraint("worker_id", "day_of_week", name="uq_worker_schedule_day"),
    )
    op.create_index("ix_worker_schedules_worker_id", "worker_schedules", ["worker_id"])

    op.create_table(
        "work_calendar_exceptions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("type", calendar_type, nullable=False),
        sa.Column("start_time", sa.Time(), nullable=True),
        sa.Column("end_time", sa.Time(), nullable=True),
        sa.Column("note", sa.String(255), nullable=True),
    )
    op.create_index("ix_work_calendar_exceptions_date", "work_calendar_exceptions", ["date"])

    # Seed operation types from machine_types codes
    machine_rows = bind.execute(sa.text("SELECT id, code FROM machine_types")).fetchall()
    code_to_id = {r[1]: r[0] for r in machine_rows}
    for ot in OPERATION_TYPE_SEED:
        mid = code_to_id.get(ot["machine"]) if ot["machine"] else None
        bind.execute(
            sa.text(
                "INSERT INTO operation_types (id, code, name, default_machine_type_id, active) "
                "VALUES (:id, :code, :name, :mid, true)"
            ),
            {
                "id": str(uuid.uuid4()),
                "code": ot["code"],
                "name": ot["name"],
                "mid": mid,
            },
        )

    # Migrate worker_profiles.skills JSONB → worker_skills
    profiles = bind.execute(
        sa.text("SELECT user_id, skills FROM worker_profiles")
    ).fetchall()
    for user_id, skills in profiles:
        if not skills:
            continue
        if isinstance(skills, str):
            # unexpected
            continue
        mapped_codes = []
        for token in skills:
            key = str(token).strip().lower()
            code = SKILL_TOKEN_TO_MACHINE.get(key)
            if code and code in code_to_id and code not in mapped_codes:
                mapped_codes.append(code)
        for i, code in enumerate(mapped_codes):
            bind.execute(
                sa.text(
                    "INSERT INTO worker_skills (id, worker_id, machine_type_id, proficiency, is_primary) "
                    "VALUES (:id, :wid, :mid, 3, :primary)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "wid": user_id,
                    "mid": code_to_id[code],
                    "primary": i == 0,
                },
            )

    # Default Mon–Sat 08:00–17:00 / Sunday off for all production workers
    workers = bind.execute(
        sa.text("SELECT id FROM users WHERE role = 'PRODUCTION_WORKER'")
    ).fetchall()
    for (wid,) in workers:
        for dow in range(7):
            is_working = dow < 6  # 0-5 Mon-Sat; 6 Sunday off
            bind.execute(
                sa.text(
                    "INSERT INTO worker_schedules "
                    "(id, worker_id, day_of_week, start_time, end_time, is_working) "
                    "VALUES (:id, :wid, :dow, :start, :end, :working)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "wid": wid,
                    "dow": dow,
                    "start": "08:00:00" if is_working else None,
                    "end": "17:00:00" if is_working else None,
                    "working": is_working,
                },
            )

    op.add_column(
        "operations",
        sa.Column(
            "operation_type_id",
            sa.String(36),
            sa.ForeignKey("operation_types.id"),
            nullable=True,
        ),
    )
    op.create_index("ix_operations_operation_type_id", "operations", ["operation_type_id"])

    op.drop_column("worker_profiles", "skills")


def downgrade():
    bind = op.get_bind()

    op.add_column(
        "worker_profiles",
        sa.Column(
            "skills",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )

    # Best-effort restore skills from worker_skills machine codes (lowercase)
    rows = bind.execute(
        sa.text(
            """
            SELECT ws.worker_id, mt.code
            FROM worker_skills ws
            JOIN machine_types mt ON mt.id = ws.machine_type_id
            ORDER BY ws.worker_id, ws.is_primary DESC
            """
        )
    ).fetchall()
    by_worker = {}
    for wid, code in rows:
        by_worker.setdefault(wid, []).append(code.lower())
    for wid, codes in by_worker.items():
        bind.execute(
            sa.text(
                "UPDATE worker_profiles SET skills = CAST(:skills AS jsonb) WHERE user_id = :wid"
            ),
            {"skills": json.dumps(codes), "wid": wid},
        )

    op.drop_index("ix_operations_operation_type_id", table_name="operations")
    op.drop_column("operations", "operation_type_id")

    op.drop_index("ix_work_calendar_exceptions_date", table_name="work_calendar_exceptions")
    op.drop_table("work_calendar_exceptions")
    op.drop_index("ix_worker_schedules_worker_id", table_name="worker_schedules")
    op.drop_table("worker_schedules")
    op.drop_index("ix_worker_skills_machine_type_id", table_name="worker_skills")
    op.drop_index("ix_worker_skills_worker_id", table_name="worker_skills")
    op.drop_table("worker_skills")
    op.drop_index("ix_operation_types_default_machine_type_id", table_name="operation_types")
    op.drop_index("ix_operation_types_code", table_name="operation_types")
    op.drop_table("operation_types")

    sa.Enum(name="calendarexceptiontype").drop(bind, checkfirst=True)
