"""Operation-level assignment: machines, job PO fields, expand operations, audit log

Revision ID: 003_operation_level
Revises: 002_job_po_fields
Create Date: 2026-08-10

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid

revision = "003_operation_level"
down_revision = "002_job_po_fields"
branch_labels = None
depends_on = None

MACHINE_CATALOG = [
    {"code": "LATHE", "name": "Lathe", "units": 7},
    {"code": "MILLING", "name": "Milling", "units": 8},
    {"code": "SHAPER", "name": "Shaper", "units": 1},
    {"code": "GRINDING", "name": "Grinding", "units": 2},
    {"code": "DRILLING", "name": "Drilling", "units": 1},
]


def upgrade():
    bind = op.get_bind()

    # --- Enums ---
    job_type = postgresql.ENUM(
        "FABRICATION", "MODIFICATION", "REPAIR", name="jobtype", create_type=False
    )
    material_source = postgresql.ENUM(
        "SHOP_PROCURED", "CLIENT_SUPPLIED", name="materialsource", create_type=False
    )
    part_condition = postgresql.ENUM(
        "RAW_MATERIAL",
        "CLIENT_SUPPLIED_ITEM",
        "BLANK",
        "WORK_IN_PROCESS",
        "MACHINED",
        "HEAT_TREATED",
        "FINISHED",
        name="partcondition",
        create_type=False,
    )
    job_type.create(bind, checkfirst=True)
    material_source.create(bind, checkfirst=True)
    part_condition.create(bind, checkfirst=True)

    # Expand operationstatus with new values (Postgres)
    op.execute("ALTER TYPE operationstatus ADD VALUE IF NOT EXISTS 'SCHEDULED'")
    op.execute("ALTER TYPE operationstatus ADD VALUE IF NOT EXISTS 'REWORK'")

    # --- machine_types / machine_units ---
    op.create_table(
        "machine_types",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("units", sa.Integer(), nullable=False, server_default="1"),
    )
    op.create_index("ix_machine_types_code", "machine_types", ["code"], unique=True)

    op.create_table(
        "machine_units",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "machine_type_id",
            sa.String(36),
            sa.ForeignKey("machine_types.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("label", sa.String(64), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.create_index("ix_machine_units_machine_type_id", "machine_units", ["machine_type_id"])

    type_ids = {}
    for m in MACHINE_CATALOG:
        tid = str(uuid.uuid4())
        type_ids[m["code"]] = tid
        bind.execute(
            sa.text(
                "INSERT INTO machine_types (id, code, name, units) VALUES (:id, :code, :name, :units)"
            ),
            {"id": tid, "code": m["code"], "name": m["name"], "units": m["units"]},
        )
        for i in range(1, m["units"] + 1):
            bind.execute(
                sa.text(
                    "INSERT INTO machine_units (id, machine_type_id, label, active) "
                    "VALUES (:id, :tid, :label, true)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "tid": tid,
                    "label": f"{m['name']} #{i}",
                },
            )

    # --- job_orders new columns ---
    op.add_column("job_orders", sa.Column("client_po_number", sa.String(100), nullable=True))
    op.add_column("job_orders", sa.Column("po_date", sa.Date(), nullable=True))
    op.add_column(
        "job_orders",
        sa.Column(
            "job_type",
            job_type,
            nullable=False,
            server_default="FABRICATION",
        ),
    )
    op.add_column(
        "job_orders",
        sa.Column(
            "material_source",
            material_source,
            nullable=False,
            server_default="SHOP_PROCURED",
        ),
    )
    op.add_column(
        "job_orders",
        sa.Column(
            "part_condition",
            part_condition,
            nullable=False,
            server_default="RAW_MATERIAL",
        ),
    )
    op.create_index("ix_job_orders_job_type", "job_orders", ["job_type"])
    op.create_index("ix_job_orders_part_condition", "job_orders", ["part_condition"])

    # --- operations: add new columns ---
    op.add_column("operations", sa.Column("sequence_no", sa.Integer(), nullable=True))
    op.add_column("operations", sa.Column("operation_name", sa.String(255), nullable=True))
    op.add_column(
        "operations",
        sa.Column("machine_type_id", sa.String(36), sa.ForeignKey("machine_types.id"), nullable=True),
    )
    op.add_column(
        "operations",
        sa.Column("machine_unit_id", sa.String(36), sa.ForeignKey("machine_units.id"), nullable=True),
    )
    op.add_column(
        "operations",
        sa.Column("assigned_worker_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
    )
    op.add_column("operations", sa.Column("estimated_hours", sa.Numeric(8, 2), nullable=True))
    op.add_column("operations", sa.Column("scheduled_start", sa.DateTime(timezone=True), nullable=True))
    op.add_column("operations", sa.Column("scheduled_end", sa.DateTime(timezone=True), nullable=True))
    op.add_column("operations", sa.Column("actual_start", sa.DateTime(timezone=True), nullable=True))
    op.add_column("operations", sa.Column("actual_end", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "operations",
        sa.Column(
            "rework_of_operation_id",
            sa.String(36),
            sa.ForeignKey("operations.id"),
            nullable=True,
        ),
    )
    op.add_column("operations", sa.Column("notes", sa.Text(), nullable=True))

    # Backfill from legacy columns + job assignee
    bind.execute(sa.text("UPDATE operations SET sequence_no = seq, operation_name = name"))
    bind.execute(
        sa.text(
            "UPDATE operations SET actual_start = started_at, actual_end = completed_at"
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE operations o
            SET assigned_worker_id = j.assigned_worker_id
            FROM job_orders j
            WHERE o.job_order_id = j.id
              AND j.assigned_worker_id IS NOT NULL
            """
        )
    )

    # Map first machines_needed code → machine_type_id
    rows = bind.execute(
        sa.text("SELECT id, machines_needed FROM operations")
    ).fetchall()
    for row in rows:
        op_id, needed = row[0], row[1]
        code = None
        if isinstance(needed, list) and needed:
            code = str(needed[0]).upper()
        elif isinstance(needed, str) and needed:
            # unexpected string form
            code = needed.strip("[]\"' ").split(",")[0].strip("\"' ").upper()
        tid = type_ids.get(code) if code else None
        if tid:
            bind.execute(
                sa.text("UPDATE operations SET machine_type_id = :tid WHERE id = :id"),
                {"tid": tid, "id": op_id},
            )

    # Default any remaining null names/seq (should not happen)
    bind.execute(
        sa.text(
            "UPDATE operations SET sequence_no = 1 WHERE sequence_no IS NULL"
        )
    )
    bind.execute(
        sa.text(
            "UPDATE operations SET operation_name = 'Operation' WHERE operation_name IS NULL OR operation_name = ''"
        )
    )

    op.alter_column("operations", "sequence_no", nullable=False)
    op.alter_column("operations", "operation_name", nullable=False)

    op.create_index("ix_operations_machine_type_id", "operations", ["machine_type_id"])
    op.create_index("ix_operations_machine_unit_id", "operations", ["machine_unit_id"])
    op.create_index("ix_operations_assigned_worker_id", "operations", ["assigned_worker_id"])
    op.create_index(
        "ix_operations_rework_of_operation_id", "operations", ["rework_of_operation_id"]
    )

    # Drop old unique constraint on (job_order_id, seq) then recreate on sequence_no
    op.drop_constraint("uq_operation_job_seq", "operations", type_="unique")
    op.drop_column("operations", "seq")
    op.drop_column("operations", "name")
    op.drop_column("operations", "machines_needed")
    op.drop_column("operations", "started_at")
    op.drop_column("operations", "completed_at")
    op.create_unique_constraint(
        "uq_operation_job_seq", "operations", ["job_order_id", "sequence_no"]
    )

    # Drop job-level assignee
    op.drop_index("ix_job_orders_assigned_worker_id", table_name="job_orders")
    op.drop_column("job_orders", "assigned_worker_id")

    # --- audit_logs ---
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("user_role", sa.String(64), nullable=True),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("entity_type", sa.String(64), nullable=False),
        sa.Column("entity_id", sa.String(36), nullable=True),
        sa.Column("before_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("after_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("ip_address", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_audit_logs_user_id", "audit_logs", ["user_id"])
    op.create_index("ix_audit_logs_entity_type", "audit_logs", ["entity_type"])
    op.create_index("ix_audit_logs_entity_id", "audit_logs", ["entity_id"])
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])


def downgrade():
    op.drop_index("ix_audit_logs_created_at", table_name="audit_logs")
    op.drop_index("ix_audit_logs_entity_id", table_name="audit_logs")
    op.drop_index("ix_audit_logs_entity_type", table_name="audit_logs")
    op.drop_index("ix_audit_logs_user_id", table_name="audit_logs")
    op.drop_table("audit_logs")

    op.add_column(
        "job_orders",
        sa.Column("assigned_worker_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index(
        "ix_job_orders_assigned_worker_id", "job_orders", ["assigned_worker_id"]
    )

    op.add_column("operations", sa.Column("seq", sa.Integer(), nullable=True))
    op.add_column("operations", sa.Column("name", sa.String(255), nullable=True))
    op.add_column(
        "operations",
        sa.Column(
            "machines_needed",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "operations", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "operations", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True)
    )

    bind = op.get_bind()
    bind.execute(
        sa.text(
            "UPDATE operations SET seq = sequence_no, name = operation_name, "
            "started_at = actual_start, completed_at = actual_end"
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE job_orders j
            SET assigned_worker_id = sub.wid
            FROM (
                SELECT DISTINCT ON (job_order_id) job_order_id, assigned_worker_id AS wid
                FROM operations
                WHERE assigned_worker_id IS NOT NULL
                ORDER BY job_order_id, sequence_no
            ) sub
            WHERE j.id = sub.job_order_id
            """
        )
    )

    op.drop_constraint("uq_operation_job_seq", "operations", type_="unique")
    op.drop_index("ix_operations_rework_of_operation_id", table_name="operations")
    op.drop_index("ix_operations_assigned_worker_id", table_name="operations")
    op.drop_index("ix_operations_machine_unit_id", table_name="operations")
    op.drop_index("ix_operations_machine_type_id", table_name="operations")
    op.drop_column("operations", "notes")
    op.drop_column("operations", "rework_of_operation_id")
    op.drop_column("operations", "actual_end")
    op.drop_column("operations", "actual_start")
    op.drop_column("operations", "scheduled_end")
    op.drop_column("operations", "scheduled_start")
    op.drop_column("operations", "estimated_hours")
    op.drop_column("operations", "assigned_worker_id")
    op.drop_column("operations", "machine_unit_id")
    op.drop_column("operations", "machine_type_id")
    op.drop_column("operations", "operation_name")
    op.drop_column("operations", "sequence_no")

    op.alter_column("operations", "seq", nullable=False)
    op.alter_column("operations", "name", nullable=False)
    op.create_unique_constraint(
        "uq_operation_job_seq", "operations", ["job_order_id", "seq"]
    )

    op.drop_index("ix_job_orders_part_condition", table_name="job_orders")
    op.drop_index("ix_job_orders_job_type", table_name="job_orders")
    op.drop_column("job_orders", "part_condition")
    op.drop_column("job_orders", "material_source")
    op.drop_column("job_orders", "job_type")
    op.drop_column("job_orders", "po_date")
    op.drop_column("job_orders", "client_po_number")

    op.drop_index("ix_machine_units_machine_type_id", table_name="machine_units")
    op.drop_table("machine_units")
    op.drop_index("ix_machine_types_code", table_name="machine_types")
    op.drop_table("machine_types")

    sa.Enum(name="partcondition").drop(bind, checkfirst=True)
    sa.Enum(name="materialsource").drop(bind, checkfirst=True)
    sa.Enum(name="jobtype").drop(bind, checkfirst=True)
