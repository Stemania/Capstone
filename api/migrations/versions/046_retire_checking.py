"""Retire Checking: it is not a shop process.

Revision ID: 046_retire_checking
Revises: 045_po_terms_delivery_mode
Create Date: 2026-10-10

The Checking operation type is deactivated, not deleted, so completed Checking
operations still display. Checking operations that never started are removed
from every job and the remaining operations are renumbered. A job left with
only completed operations moves to Completed (part stage Finished). No
notifications are sent. Checking operations that have started are left alone.
"""

import logging

import sqlalchemy as sa
from alembic import op

revision = "046_retire_checking"
down_revision = "045_po_terms_delivery_mode"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

_JOB_NUMBER = "'JO-' || extract(year FROM j.created_at)::int || '-' || upper(left(j.id, 4))"


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text("UPDATE operation_types SET active = false WHERE code = 'CHECKING'"))

    started = conn.execute(
        sa.text(
            f"""
            SELECT {_JOB_NUMBER} AS job_number, o.sequence_no, o.status
            FROM operations o
            JOIN job_orders j ON j.id = o.job_order_id
            LEFT JOIN operation_types t ON t.id = o.operation_type_id
            WHERE (t.code = 'CHECKING' OR lower(trim(o.operation_name)) = 'checking')
              AND o.status::text = 'IN_PROGRESS'
            ORDER BY 1, 2
            """
        )
    ).all()
    for row in started:
        log.info("Checking in progress, left alone: %s op %s", row.job_number, row.sequence_no)

    unstarted = conn.execute(
        sa.text(
            """
            SELECT o.id, o.job_order_id
            FROM operations o
            LEFT JOIN operation_types t ON t.id = o.operation_type_id
            WHERE (t.code = 'CHECKING' OR lower(trim(o.operation_name)) = 'checking')
              AND o.status::text IN ('PENDING', 'SCHEDULED')
              AND o.actual_start IS NULL
            """
        )
    ).all()
    if not unstarted:
        log.info("No unstarted Checking operations to remove.")
        return

    op_ids = [r.id for r in unstarted]
    job_ids = sorted({r.job_order_id for r in unstarted})
    conn.execute(
        sa.text("DELETE FROM operations WHERE id IN :ids").bindparams(
            sa.bindparam("ids", expanding=True)
        ),
        {"ids": op_ids},
    )

    # Renumber 1..n per job; negative first so (job, sequence) stays unique.
    conn.execute(
        sa.text(
            "UPDATE operations SET sequence_no = -sequence_no WHERE job_order_id IN :jobs"
        ).bindparams(sa.bindparam("jobs", expanding=True)),
        {"jobs": job_ids},
    )
    conn.execute(
        sa.text(
            """
            UPDATE operations o SET sequence_no = r.seq
            FROM (
                SELECT id, row_number() OVER (
                    PARTITION BY job_order_id ORDER BY abs(sequence_no)
                ) AS seq
                FROM operations WHERE job_order_id IN :jobs
            ) r
            WHERE o.id = r.id
            """
        ).bindparams(sa.bindparam("jobs", expanding=True)),
        {"jobs": job_ids},
    )

    completed = conn.execute(
        sa.text(
            f"""
            UPDATE job_orders j
            SET status = 'COMPLETED', part_condition = 'FINISHED'
            WHERE j.id IN :jobs
              AND j.status::text NOT IN ('DRAFT', 'DELIVERED', 'COMPLETED')
              AND j.delivered_at IS NULL
              AND EXISTS (SELECT 1 FROM operations o WHERE o.job_order_id = j.id)
              AND NOT EXISTS (
                  SELECT 1 FROM operations o
                  WHERE o.job_order_id = j.id AND o.status::text <> 'COMPLETED'
              )
            RETURNING {_JOB_NUMBER} AS job_number
            """
        ).bindparams(sa.bindparam("jobs", expanding=True)),
        {"jobs": job_ids},
    ).all()

    log.info("Removed %d unstarted Checking operations on %d jobs.", len(op_ids), len(job_ids))
    for row in sorted(completed, key=lambda r: r.job_number):
        log.info("Now complete: %s", row.job_number)


def downgrade():
    # Removed operations cannot be restored; only the type comes back.
    op.execute("UPDATE operation_types SET active = true WHERE code = 'CHECKING'")
