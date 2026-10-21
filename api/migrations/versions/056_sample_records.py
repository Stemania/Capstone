"""Ledger of rows created by flask sample-history.

Revision ID: 056_sample_records
Revises: 055_rate_limits_and_indexes
Create Date: 2026-10-21

Additive only: one new table. Downgrade drops only that table.

sample_records remembers what a sample-history run created so
``flask sample-history remove`` can delete those rows and nothing else.

``detail`` is null for a row the generator inserted. For an existing
consumable or tool whose quantity the generator changes, one row stores
the quantity from before the run (detail.role = "stock_snapshot") so
remove can put that stock back. Those master rows are never deleted.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "056_sample_records"
down_revision = "055_rate_limits_and_indexes"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "sample_records",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("table_name", sa.String(length=64), nullable=False),
        sa.Column("record_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("detail", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.UniqueConstraint(
            "table_name", "record_id", name="uq_sample_records_table_record"
        ),
    )
    op.create_index(
        "ix_sample_records_table_name", "sample_records", ["table_name"]
    )


def downgrade():
    op.drop_index("ix_sample_records_table_name", table_name="sample_records")
    op.drop_table("sample_records")
