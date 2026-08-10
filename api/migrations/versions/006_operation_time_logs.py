"""Operation time logs, worked-hours variance, and machine downtime.

Revision ID: 006_operation_time_logs
Revises: 005_scoring_weights
Create Date: 2026-08-10

"""
from alembic import op
import sqlalchemy as sa

revision = "006_operation_time_logs"
down_revision = "005_scoring_weights"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "operation_time_logs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "operation_id",
            sa.String(36),
            sa.ForeignKey("operations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "worker_id",
            sa.String(36),
            sa.ForeignKey("users.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "event",
            sa.Enum(
                "START",
                "PAUSE",
                "RESUME",
                "COMPLETE",
                name="operation_time_event",
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("event_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "reason",
            sa.Enum(
                "END_OF_SHIFT",
                "BREAK",
                "MACHINE_DOWN",
                "WAITING_MATERIAL",
                "WAITING_PRIOR_OPERATION",
                "OTHER",
                name="operation_pause_reason",
                create_constraint=True,
            ),
            nullable=True,
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_operation_time_logs_op_event_at",
        "operation_time_logs",
        ["operation_id", "event_at"],
    )

    op.create_table(
        "machine_downtimes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "machine_unit_id",
            sa.String(36),
            sa.ForeignKey("machine_units.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reason", sa.String(255), nullable=False),
        sa.Column(
            "reported_by_id",
            sa.String(36),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_machine_downtimes_unit_open",
        "machine_downtimes",
        ["machine_unit_id", "ended_at"],
    )

    op.add_column(
        "operations",
        sa.Column("actual_worked_hours", sa.Numeric(10, 4), nullable=True),
    )
    op.add_column(
        "operations",
        sa.Column("variance_hours", sa.Numeric(10, 4), nullable=True),
    )
    op.add_column(
        "operations",
        sa.Column("variance_pct", sa.Numeric(10, 4), nullable=True),
    )
    op.add_column(
        "operations",
        sa.Column("rework_reason", sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column("operations", "rework_reason")
    op.drop_column("operations", "variance_pct")
    op.drop_column("operations", "variance_hours")
    op.drop_column("operations", "actual_worked_hours")
    op.drop_index("ix_machine_downtimes_unit_open", table_name="machine_downtimes")
    op.drop_table("machine_downtimes")
    op.drop_index("ix_operation_time_logs_op_event_at", table_name="operation_time_logs")
    op.drop_table("operation_time_logs")
    op.execute("DROP TYPE IF EXISTS operation_time_event")
    op.execute("DROP TYPE IF EXISTS operation_pause_reason")
