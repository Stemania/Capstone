"""Database time limits, so one stuck request cannot freeze the others.

Revision ID: 059_database_timeouts
Revises: 058_client_progress_emails
Create Date: 2026-11-02

No table or column changes. Sets defaults on the current database for new
sessions:

- lock_timeout 10s: a statement waiting for another session's lock gives up
  (with an error in the log) instead of waiting forever.
- statement_timeout 60s: no single statement runs longer than a minute.
- idle_in_transaction_session_timeout 2min: a session that opened a
  transaction and then went silent (for example, a request whose connection
  died) is closed, which releases every lock it held.

The longest statements the system runs (migrations, the sample-history
reset, the analytics queries) each finish well within these limits.
Downgrade resets the three settings.
"""

from alembic import op

revision = "059_database_timeouts"
down_revision = "058_client_progress_emails"
branch_labels = None
depends_on = None

SETTINGS = {
    "lock_timeout": "10s",
    "statement_timeout": "60s",
    "idle_in_transaction_session_timeout": "2min",
}


def _alter(clause: str) -> None:
    # The database name comes from the connection, so this works on every
    # environment (local, test, Neon) without hard-coding it.
    op.execute(
        f"""
        DO $$
        BEGIN
          EXECUTE format('ALTER DATABASE %I {clause}', current_database());
        END
        $$;
        """
    )


def upgrade():
    for name, value in SETTINGS.items():
        _alter(f"SET {name} = ''{value}''")


def downgrade():
    for name in SETTINGS:
        _alter(f"RESET {name}")
