"""Initial schema

Revision ID: 001_initial
Revises:
Create Date: 2026-07-16

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Create enum types once; use create_type=False on columns to avoid duplicate CREATE TYPE.
    user_role = postgresql.ENUM(
        "ADMIN", "OFFICE_STAFF", "PRODUCTION_WORKER", name="userrole", create_type=False
    )
    job_status = postgresql.ENUM(
        "UNASSIGNED", "ASSIGNED", "IN_PROGRESS", "COMPLETED",
        name="joborderstatus", create_type=False,
    )
    op_status = postgresql.ENUM(
        "PENDING", "IN_PROGRESS", "COMPLETED", name="operationstatus", create_type=False
    )
    event_type = postgresql.ENUM("BORROW", "RETURN", name="tooleventtype", create_type=False)

    user_role.create(op.get_bind(), checkfirst=True)
    job_status.create(op.get_bind(), checkfirst=True)
    op_status.create(op.get_bind(), checkfirst=True)
    event_type.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("role", user_role, nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_role", "users", ["role"])

    op.create_table(
        "clients",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("contact", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_clients_name", "clients", ["name"])

    op.create_table(
        "tools",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_tools_name", "tools", ["name"])
    op.create_index("ix_tools_code", "tools", ["code"], unique=True)

    op.create_table(
        "worker_profiles",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("skills", postgresql.JSONB(), nullable=False, server_default="[]"),
    )
    op.create_index("ix_worker_profiles_user_id", "worker_profiles", ["user_id"], unique=True)

    op.create_table(
        "job_orders",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("client_id", sa.String(36), sa.ForeignKey("clients.id"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("status", job_status, nullable=False),
        sa.Column("assigned_worker_id", sa.String(36), sa.ForeignKey("users.id")),
        sa.Column("created_by_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_job_orders_client_id", "job_orders", ["client_id"])
    op.create_index("ix_job_orders_due_date", "job_orders", ["due_date"])
    op.create_index("ix_job_orders_status", "job_orders", ["status"])
    op.create_index("ix_job_orders_assigned_worker_id", "job_orders", ["assigned_worker_id"])

    op.create_table(
        "operations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("job_order_id", sa.String(36), sa.ForeignKey("job_orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("status", op_status, nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("job_order_id", "seq", name="uq_operation_job_seq"),
    )
    op.create_index("ix_operations_job_order_id", "operations", ["job_order_id"])
    op.create_index("ix_operation_job_status", "operations", ["job_order_id", "status"])

    op.create_table(
        "tool_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tool_id", sa.String(36), sa.ForeignKey("tools.id"), nullable=False),
        sa.Column("worker_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("type", event_type, nullable=False),
        sa.Column("job_order_id", sa.String(36), sa.ForeignKey("job_orders.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_tool_events_tool_id", "tool_events", ["tool_id"])
    op.create_index("ix_tool_events_worker_id", "tool_events", ["worker_id"])
    op.create_index("ix_tool_event_tool_created", "tool_events", ["tool_id", "created_at"])


def downgrade():
    op.drop_table("tool_events")
    op.drop_table("operations")
    op.drop_table("job_orders")
    op.drop_table("worker_profiles")
    op.drop_table("tools")
    op.drop_table("clients")
    op.drop_table("users")

    sa.Enum(name="tooleventtype").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="operationstatus").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="joborderstatus").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="userrole").drop(op.get_bind(), checkfirst=True)
