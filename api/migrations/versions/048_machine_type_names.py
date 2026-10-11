"""Machine type names end in "Machine": "Lathe" becomes "Lathe Machine".

Revision ID: 048_machine_type_names
Revises: 047_needs_replan
Create Date: 2026-10-11

Only types whose name is exactly an old name are renamed; any type the shop
renamed itself is left alone. Unit labels ("Lathe #1") do not change. Old
names are still accepted wherever a type is matched by name.
"""

import logging

import sqlalchemy as sa
from alembic import op

revision = "048_machine_type_names"
down_revision = "047_needs_replan"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

RENAMES = [
    ("Lathe", "Lathe Machine"),
    ("Milling", "Milling Machine"),
    ("Shaper", "Shaper Machine"),
    ("Grinding", "Grinding Machine"),
    ("Drilling", "Drilling Machine"),
    ("Bending", "Bending Machine"),
    ("Laser", "Laser Machine"),
]

# Bending and Laser were already "... Machine" before this migration.
DOWNGRADE = RENAMES[:5]


def _rename(pairs):
    conn = op.get_bind()
    for old, new in pairs:
        count = conn.execute(
            sa.text("UPDATE machine_types SET name = :new WHERE name = :old"),
            {"old": old, "new": new},
        ).rowcount
        if count:
            log.info("Machine type %r -> %r (%d)", old, new, count)


def upgrade():
    _rename(RENAMES)


def downgrade():
    _rename([(new, old) for old, new in DOWNGRADE])
