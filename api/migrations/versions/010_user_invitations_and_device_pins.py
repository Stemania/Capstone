"""User status, invitations, mobile login, and device-bound PINs.

Revision ID: 010_user_invitations_device_pins
Revises: 009_job_planning_statuses
Create Date: 2026-08-23

- users.status: INVITED | ACTIVE | DISABLED (existing rows → ACTIVE)
- users.mobile_number: unique normalized PH mobiles (+639XXXXXXXXX)
- users.password_hash nullable for INVITED accounts
- user_invitations + user_devices tables
- Normalizes any existing mobile values; aborts if duplicates remain
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "010_user_invitations_device_pins"
down_revision = "009_job_planning_statuses"
branch_labels = None
depends_on = None


def upgrade():
    user_status = postgresql.ENUM(
        "INVITED",
        "ACTIVE",
        "DISABLED",
        name="userstatus",
        create_type=False,
    )
    invite_channel = postgresql.ENUM(
        "EMAIL",
        "SMS",
        name="invitationchannel",
        create_type=False,
    )

    user_status.create(op.get_bind(), checkfirst=True)
    invite_channel.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "users",
        sa.Column(
            "status",
            user_status,
            nullable=False,
            server_default="ACTIVE",
        ),
    )
    op.add_column(
        "users",
        sa.Column("mobile_number", sa.String(length=16), nullable=True),
    )
    op.create_index("ix_users_status", "users", ["status"])

    # Existing accounts already have passwords.
    op.execute(
        """
        UPDATE users
        SET status = CASE
            WHEN active IS FALSE THEN 'DISABLED'::userstatus
            ELSE 'ACTIVE'::userstatus
        END
        """
    )

    op.alter_column("users", "password_hash", existing_type=sa.String(length=255), nullable=True)

    # Normalize any pre-existing mobiles into +639XXXXXXXXX form.
    op.execute(
        """
        UPDATE users
        SET mobile_number = CASE
            WHEN regexp_replace(mobile_number, '[^0-9]', '', 'g') ~ '^09[0-9]{9}$'
                THEN '+63' || substring(regexp_replace(mobile_number, '[^0-9]', '', 'g') from 2)
            WHEN regexp_replace(mobile_number, '[^0-9]', '', 'g') ~ '^639[0-9]{9}$'
                THEN '+' || regexp_replace(mobile_number, '[^0-9]', '', 'g')
            WHEN regexp_replace(mobile_number, '[^0-9+]', '', 'g') ~ '^\\+639[0-9]{9}$'
                THEN regexp_replace(mobile_number, '[^0-9+]', '', 'g')
            ELSE mobile_number
        END
        WHERE mobile_number IS NOT NULL AND btrim(mobile_number) <> ''
        """
    )

    # Fail loudly on duplicate normalized mobiles instead of merging.
    op.execute(
        """
        DO $$
        DECLARE
            dup_list text;
        BEGIN
            SELECT string_agg(mobile_number || ' (x' || cnt || ')', ', ')
              INTO dup_list
              FROM (
                SELECT mobile_number, COUNT(*) AS cnt
                  FROM users
                 WHERE mobile_number IS NOT NULL
                 GROUP BY mobile_number
                HAVING COUNT(*) > 1
              ) d;
            IF dup_list IS NOT NULL THEN
                RAISE EXCEPTION
                    'Migration 010 aborted: duplicate mobile numbers after normalization: %',
                    dup_list;
            END IF;
        END $$;
        """
    )

    op.create_index("ix_users_mobile_number", "users", ["mobile_number"], unique=True)

    op.create_table(
        "user_invitations",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("token_hash", sa.String(length=255), nullable=False),
        sa.Column("channel", invite_channel, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_user_invitations_user_id", "user_invitations", ["user_id"])
    op.create_index("ix_user_invitations_token_hash", "user_invitations", ["token_hash"], unique=True)

    op.create_table(
        "user_devices",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("device_id", sa.String(length=36), nullable=False),
        sa.Column("device_label", sa.String(length=255), nullable=True),
        sa.Column("pin_hash", sa.String(length=255), nullable=True),
        sa.Column("pin_set_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pin_failed_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("user_id", "device_id", name="uq_user_devices_user_device"),
    )
    op.create_index("ix_user_devices_user_id", "user_devices", ["user_id"])
    op.create_index("ix_user_devices_device_id", "user_devices", ["device_id"])


def downgrade():
    op.drop_table("user_devices")
    op.drop_table("user_invitations")
    op.drop_index("ix_users_mobile_number", table_name="users")
    op.drop_index("ix_users_status", table_name="users")
    op.alter_column("users", "password_hash", existing_type=sa.String(length=255), nullable=False)
    op.drop_column("users", "mobile_number")
    op.drop_column("users", "status")
    op.execute("DROP TYPE IF EXISTS invitationchannel")
    op.execute("DROP TYPE IF EXISTS userstatus")
