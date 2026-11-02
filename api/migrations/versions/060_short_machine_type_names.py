"""Machine type names drop "Machine": "Lathe Machine" becomes "Lathe".

Revision ID: 060_short_machine_type_names
Revises: 059_database_timeouts
Create Date: 2026-11-03

Reverses the naming of 048. Only types whose name is exactly one of the seven
catalog names are renamed; any type the shop named itself is left alone. Unit
labels ("Lathe #1") do not change, and "Lathe Machine" is still accepted
wherever a type is matched by name (employee import, reference loader).
"""

import logging

import sqlalchemy as sa
from alembic import op

revision = "060_short_machine_type_names"
down_revision = "059_database_timeouts"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

RENAMES = [
    ("Lathe Machine", "Lathe"),
    ("Milling Machine", "Milling"),
    ("Shaper Machine", "Shaper"),
    ("Grinding Machine", "Grinding"),
    ("Drilling Machine", "Drilling"),
    ("Bending Machine", "Bending"),
    ("Laser Machine", "Laser"),
]


def _rename(pairs):
    conn = op.get_bind()
    for old, new in pairs:
        # Skip when another type already has the new name, so two types never share one.
        taken = conn.execute(
            sa.text("SELECT 1 FROM machine_types WHERE name = :new"), {"new": new}
        ).first()
        if taken:
            log.info("Machine type %r kept: %r already exists", old, new)
            continue
        count = conn.execute(
            sa.text("UPDATE machine_types SET name = :new WHERE name = :old"),
            {"old": old, "new": new},
        ).rowcount
        if count:
            log.info("Machine type %r -> %r (%d)", old, new, count)


def upgrade():
    _rename(RENAMES)


def downgrade():
    _rename([(new, old) for old, new in RENAMES])
