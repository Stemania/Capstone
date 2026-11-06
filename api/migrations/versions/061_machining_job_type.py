"""Machining replaces Modification as a job type.

Revision ID: 061_machining_job_type
Revises: 060_short_machine_type_names
Create Date: 2026-11-06

- jobtype gains MACHINING.
- Job orders typed MODIFICATION become MACHINING. Their materials status and
  part condition are left as recorded.

MODIFICATION stays in the Postgres enum (a value cannot be dropped) but is no
longer used. Downgrade only logs: after the update, which jobs were
Modification is not known.
"""

import logging

from alembic import op
import sqlalchemy as sa

revision = "061_machining_job_type"
down_revision = "060_short_machine_type_names"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")


def upgrade():
    # New enum values must be committed before use (Postgres).
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'MACHINING'")

    count = op.get_bind().execute(
        sa.text("UPDATE job_orders SET job_type = 'MACHINING' WHERE job_type = 'MODIFICATION'")
    ).rowcount
    log.info("Job orders Modification -> Machining: %d", count)


def downgrade():
    log.info("061: Machining jobs are left as they are")
