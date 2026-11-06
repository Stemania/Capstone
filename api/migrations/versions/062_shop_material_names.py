"""Material catalog named the way the shop writes it on a PO, without grades or kg.

Revision ID: 062_shop_material_names
Revises: 061_machining_job_type
Create Date: 2026-11-06

Data only, catalog entries only:
- The seven starting entries are renamed to the shop's names ("AISI 4140 alloy
  steel" -> "4140"). An entry is renamed only if it still has its starting
  name and the new name is free; entries the shop named itself are left alone.
- Grades become their own entries: "Mild steel (black iron)" becomes "MS" and
  "A36" is added; each plastic grade is added and the "Plastic" entry is no
  longer offered. "1045" is added.
- "Tool steel" entries move to "Steel"; "kg" defaults become "pcs".

Job orders and supplier order lines keep the names, grades and units they
were saved with. Downgrade restores the starting names only.
"""

import json
import logging
import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = "062_shop_material_names"
down_revision = "061_machining_job_type"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

# (starting name, shop name, shop term to fill when empty)
RENAMES = [
    ("AISI 4140 alloy steel", "4140", "41-40"),
    ("SKD 11 tool steel", "SKD 11", None),
    ("Mild steel (black iron)", "MS", "Iron"),
    ("Aluminium 6061", "6061", "60-61"),
    ("Aluminium 5052", "5052", None),
]

# (name, shop term, category, default unit)
ADDED = [
    ("1045", "10-45", "Steel", "pcs"),
    ("A36", None, "Steel", "pcs"),
    ("Nylon", None, "Plastic", "pcs"),
    ("Acetal", "Delrin", "Plastic", "pcs"),
    ("UHMW", "UHMW-PE", "Plastic", "pcs"),
    ("Teflon", "PTFE", "Plastic", "pcs"),
    ("Bakelite", "Phenolic", "Plastic", "pcs"),
]


def _exists(conn, name):
    return (
        conn.execute(
            sa.text("SELECT 1 FROM material_catalog WHERE lower(name) = lower(:n)"), {"n": name}
        ).first()
        is not None
    )


def upgrade():
    conn = op.get_bind()
    now = datetime.now(timezone.utc)

    for old, new, term in RENAMES:
        if _exists(conn, new):
            log.info("Material %r kept: %r already exists", old, new)
            continue
        count = conn.execute(
            sa.text(
                "UPDATE material_catalog SET name = :new, grades = CAST(:empty AS JSON), "
                "shop_term = COALESCE(NULLIF(shop_term, ''), :term), updated_at = :now "
                "WHERE name = :old"
            ),
            {"old": old, "new": new, "term": term, "empty": "[]", "now": now},
        ).rowcount
        if count:
            log.info("Material %r -> %r", old, new)

    for name, term, category, unit in ADDED:
        if _exists(conn, name):
            continue
        conn.execute(
            sa.text(
                "INSERT INTO material_catalog "
                "(id, name, shop_term, grades, default_unit, category, active, created_at, updated_at) "
                "VALUES (:id, :name, :term, CAST(:empty AS JSON), :unit, :category, true, :now, :now)"
            ),
            {
                "id": str(uuid.uuid4()),
                "name": name,
                "term": term,
                "empty": json.dumps([]),
                "unit": unit,
                "category": category,
                "now": now,
            },
        )
        log.info("Material %r added", name)

    # The plastics are separate entries now; the old one stays for its history.
    conn.execute(
        sa.text(
            "UPDATE material_catalog SET active = false, updated_at = :now "
            "WHERE name = 'Plastic' AND active"
        ),
        {"now": now},
    )
    # Its one grade, Magnolia bronze, becomes the shop term.
    conn.execute(
        sa.text(
            "UPDATE material_catalog SET grades = CAST(:empty AS JSON), shop_term = 'Magnolia', "
            "updated_at = :now WHERE name = 'Bronze' AND shop_term IS NULL"
        ),
        {"empty": "[]", "now": now},
    )
    moved = conn.execute(
        sa.text(
            "UPDATE material_catalog SET category = 'Steel', updated_at = :now "
            "WHERE category = 'Tool steel'"
        ),
        {"now": now},
    ).rowcount
    log.info("Tool steel -> Steel: %d", moved)
    per_piece = conn.execute(
        sa.text(
            "UPDATE material_catalog SET default_unit = 'pcs', updated_at = :now "
            "WHERE default_unit = 'kg'"
        ),
        {"now": now},
    ).rowcount
    log.info("Default unit kg -> pcs: %d", per_piece)


def downgrade():
    conn = op.get_bind()
    for old, new, _term in RENAMES:
        if not _exists(conn, old):
            conn.execute(
                sa.text("UPDATE material_catalog SET name = :old WHERE name = :new"),
                {"old": old, "new": new},
            )
