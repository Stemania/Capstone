"""Fill Catalog with shop materials and consumables (reference data).

Revision ID: 054_catalog_fill
Revises: 053_po_print_and_catalog_refs
Create Date: 2026-10-18

Idempotent + additive:
- Materials: insert when no row matches the normalized name; for an existing
  match, append missing grades only. Inserted rows use normal UUIDs (no marker
  in any user-visible field). downgrade identifies inserts by exact name list.
- Consumables: insert into tools with deterministic INV- codes; skip (treat as
  duplicate) when the code already exists or name+size matches. quantity 0,
  active true. downgrade identifies inserts by the exact code list.
- Never updates units/names of existing rows, never deletes on upgrade, no
  stock/prices/supplier links.

downgrade() only deletes unused inserts (no events/PO lines, qty 0 for tools;
materials not referenced by material_purchases.material_catalog_id). Used rows
are left and logged. Appended grades are removed by the exact GRADE_APPENDS
list.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = "054_catalog_fill"
down_revision = "053_po_print_and_catalog_refs"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

# ---------------------------------------------------------------------------
# Materials: (name, shop_term, grades, unit, category)
# Names in MATERIAL_INSERT_NAMES are what downgrade may delete (if unused).
# ---------------------------------------------------------------------------

MATERIAL_ROWS = [
    ("Mild steel (black iron)", "Iron", ["MS", "A36", "SS400"], "kg", "Steel"),
    ("Carbon steel", None, ["AISI 1020", "AISI 1045", "S45C"], "kg", "Steel"),
    ("AISI 4140 alloy steel", "41-40", ["SCM440"], "kg", "Steel"),
    ("AISI 4340 alloy steel", None, [], "kg", "Steel"),
    ("SKD 11 tool steel", None, ["D2"], "kg", "Tool steel"),
    ("SKD 61 tool steel", None, ["H13"], "kg", "Tool steel"),
    ("O1 tool steel", None, ["DF-2"], "kg", "Tool steel"),
    ("Stainless steel", None, ["SS304", "SS316", "SS410", "SS420"], "kg", "Stainless steel"),
    ("Galvanized iron sheet", None, ["Gauge 16", "Gauge 18", "Gauge 20"], "sheet", "Steel"),
    ("Cast iron", None, ["FC200", "FC250", "FCD450 (ductile)"], "kg", "Cast iron"),
    ("Aluminium 1100", None, [], "kg", "Aluminium"),
    ("Aluminium 5052", "50-51", [], "sheet", "Aluminium"),
    ("Aluminium 6061", "60-61", ["T6"], "kg", "Aluminium"),
    ("Aluminium 7075", None, ["T6"], "kg", "Aluminium"),
    ("Brass", None, ["C36000 (free-cutting)", "C26000"], "kg", "Non-ferrous"),
    ("Bronze", None, ["Magnolia bronze", "Phosphor bronze", "Aluminium bronze"], "kg", "Non-ferrous"),
    ("Copper", None, ["C11000"], "kg", "Non-ferrous"),
    ("Plastic", None, ["MC Nylon", "Polyurethane (PU)"], "kg", "Plastic"),
]

# Only these names may be deleted on downgrade (rows 054 inserted when absent).
MATERIAL_INSERT_NAMES = [
    "Carbon steel",
    "AISI 4340 alloy steel",
    "SKD 61 tool steel",
    "O1 tool steel",
    "Stainless steel",
    "Galvanized iron sheet",
    "Cast iron",
    "Aluminium 1100",
    "Aluminium 7075",
]

# Grades 054 may append to pre-existing materials; downgrade strips exactly these.
GRADE_APPENDS = {
    "Mild steel (black iron)": ["SS400"],
    "AISI 4140 alloy steel": ["SCM440"],
    "SKD 11 tool steel": ["D2"],
    "Aluminium 6061": ["T6"],
    "Brass": ["C36000 (free-cutting)", "C26000"],
    "Bronze": ["Phosphor bronze", "Aluminium bronze"],
    "Copper": ["C11000"],
    "Plastic": ["MC Nylon", "Polyurethane (PU)"],
}

# Consumables: (code, name, size_spec, unit). Codes are the downgrade key.
CONSUMABLE_ROWS = [
    # Abrasives
    ("INV-CUT-4", "Cutting disc", '4" (107 mm)', "pcs"),
    ("INV-CUT-14", "Cutting disc", '14" (355 mm)', "pcs"),
    ("INV-GRIND-4", "Grinding disc", '4"', "pcs"),
    ("INV-GRIND-7", "Grinding disc", '7"', "pcs"),
    ("INV-FLAP-4-G40", "Flap disc", '4" grit 40', "pcs"),
    ("INV-FLAP-4-G60", "Flap disc", '4" grit 60', "pcs"),
    ("INV-FLAP-4-G80", "Flap disc", '4" grit 80', "pcs"),
    ("INV-FLAP-4-G120", "Flap disc", '4" grit 120', "pcs"),
    ("INV-CUPBRUSH-4", "Cup wire brush", '4"', "pcs"),
    ("INV-SAND-G80", "Sandpaper", "grit 80", "pack"),
    ("INV-SAND-G120", "Sandpaper", "grit 120", "pack"),
    ("INV-SAND-G240", "Sandpaper", "grit 240", "pack"),
    ("INV-SAND-G400", "Sandpaper", "grit 400", "pack"),
    ("INV-EMERY", "Emery cloth", None, "roll"),
    # Welding
    ("INV-RODE6013-25", "Welding rod E6013", "2.5 mm", "box"),
    ("INV-RODE6013-32", "Welding rod E6013", "3.2 mm", "box"),
    ("INV-RODE7018-32", "Welding rod E7018", "3.2 mm", "box"),
    ("INV-MIG-08", "MIG wire ER70S-6", "0.8 mm", "spool"),
    ("INV-MIG-10", "MIG wire ER70S-6", "1.0 mm", "spool"),
    ("INV-ANTISPAT", "Anti-spatter spray", None, "can"),
    ("INV-LENS-10", "Welding lens shade 10", None, "pcs"),
    ("INV-SOAPSTONE", "Soapstone marker", None, "pcs"),
    # Cutting tools
    ("INV-HSSDRILL-3", "HSS drill bit", "3 mm", "pcs"),
    ("INV-HSSDRILL-4", "HSS drill bit", "4 mm", "pcs"),
    ("INV-HSSDRILL-5", "HSS drill bit", "5 mm", "pcs"),
    ("INV-HSSDRILL-6", "HSS drill bit", "6 mm", "pcs"),
    ("INV-HSSDRILL-8", "HSS drill bit", "8 mm", "pcs"),
    ("INV-HSSDRILL-10", "HSS drill bit", "10 mm", "pcs"),
    ("INV-HSSDRILL-12", "HSS drill bit", "12 mm", "pcs"),
    ("INV-HSSDRILL-13", "HSS drill bit", "13 mm", "pcs"),
    ("INV-CTRDRILL-A", "Center drill", "A", "pcs"),
    ("INV-CTRDRILL-B", "Center drill", "B", "pcs"),
    ("INV-HSSEM-6", "HSS end mill", "6 mm", "pcs"),
    ("INV-HSSEM-8", "HSS end mill", "8 mm", "pcs"),
    ("INV-HSSEM-10", "HSS end mill", "10 mm", "pcs"),
    ("INV-HSSEM-12", "HSS end mill", "12 mm", "pcs"),
    ("INV-CARBEM-6", "Carbide end mill", "6 mm", "pcs"),
    ("INV-CARBEM-10", "Carbide end mill", "10 mm", "pcs"),
    ("INV-TAP-M6", "Machine tap", "M6", "pcs"),
    ("INV-TAP-M8", "Machine tap", "M8", "pcs"),
    ("INV-TAP-M10", "Machine tap", "M10", "pcs"),
    ("INV-TAP-M12", "Machine tap", "M12", "pcs"),
    ("INV-LATHEHSS-38", "Lathe tool bit HSS", '3/8"', "pcs"),
    ("INV-LATHEHSS-12", "Lathe tool bit HSS", '1/2"', "pcs"),
    ("INV-INS-CNMG", "Carbide insert", "CNMG 120408", "box"),
    ("INV-INS-TNMG", "Carbide insert", "TNMG 160408", "box"),
    ("INV-INS-CCMT", "Carbide insert", "CCMT 09T304", "box"),
    ("INV-INS-DCMT", "Carbide insert", "DCMT 11T304", "box"),
    ("INV-PART-3", "Parting blade", "3 mm", "pcs"),
    ("INV-HACK-12", "Hacksaw blade", '12"', "pcs"),
    ("INV-BANDSAW", "Bandsaw blade", None, "pcs"),
    # Fluids
    ("INV-OIL-CUT-PAIL", "Cutting oil", None, "pail"),
    ("INV-COOLANT", "Soluble coolant", None, "pail"),
    ("INV-WAY-OIL", "Way oil", None, "pail"),
    ("INV-HYD-OIL", "Hydraulic oil", None, "pail"),
    ("INV-GREASE", "Grease", None, "can"),
    ("INV-PENETRATING", "Penetrating oil spray", None, "can"),
    ("INV-LAYOUT", "Layout fluid (marking blue)", None, "can"),
    ("INV-SPRAY-PAINT", "Spray paint", None, "can"),
    ("INV-PAINT-MARKER", "Paint marker", None, "pcs"),
    ("INV-THREADLOCK", "Thread locker", None, "bottle"),
    ("INV-TEFLON", "Teflon tape", None, "roll"),
    ("INV-MASKING", "Masking tape", None, "roll"),
    ("INV-SHOP-RAGS", "Shop rags", None, "pack"),
    # PPE
    ("INV-GLOVES-COT", "Cotton gloves", None, "pair"),
    ("INV-GLOVES-WELD", "Leather welding gloves", None, "pair"),
    ("INV-EAR-PLUGS", "Ear plugs", None, "pair"),
    ("INV-SAFETY-GLASS", "Safety glasses", None, "pcs"),
]

CONSUMABLE_CODES = [row[0] for row in CONSUMABLE_ROWS]


def _utcnow():
    return datetime.now(timezone.utc)


def _norm(text):
    if not text:
        return ""
    s = text.casefold().strip()
    s = s.replace("″", '"').replace("′", "'")
    s = re.sub(r"[#]+", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s


def _norm_name(name):
    s = _norm(name)
    if s.startswith("hss drill bit"):
        return "drill bit" + s[len("hss drill bit") :]
    if s.startswith("hss end mill"):
        return "end mill" + s[len("hss end mill") :]
    if s in ("shop rags", "rugs"):
        return "rugs"
    return s


def _canonical_size(size):
    """Exact size identity after mm/inch normalization.

    Diameter families (only these aliases are equivalent):
      4" / 4 in / 100 mm / 107 mm / 115 mm  → dia:115
      7" / 180 mm                            → dia:180
      12" / 300 mm                           → dia:300
      14" / 355 mm                           → dia:355
    Grit and bare letter sizes (A/B) compare on their own key. No substring
    matching — a 14" disc must not collide with a 4"/115 mm disc.
    """
    if not size:
        return None
    s = _norm(size)
    grit = re.search(r"grit\s*(\d+)", s)
    if grit:
        return ("grit", grit.group(1))
    if re.fullmatch(r"[ab]", s):
        return ("letter", s)
    # Check longer inch sizes before shorter so "14" is not read as "4".
    families = [
        (r'(?<!\d)14\s*"|(?<!\d)14\s*in(?:ch)?\b|355\s*mm', ("dia", 355)),
        (r'(?<!\d)12\s*"|(?<!\d)12\s*in(?:ch)?\b|300\s*mm', ("dia", 300)),
        (r'(?<!\d)7\s*"|(?<!\d)7\s*in(?:ch)?\b|180\s*mm', ("dia", 180)),
        (
            r'(?<!\d)4\s*"|(?<!\d)4\s*in(?:ch)?\b|107\s*mm|115\s*mm|100\s*mm',
            ("dia", 115),
        ),
    ]
    for pattern, key in families:
        if re.search(pattern, s):
            return key
    mm = re.search(r"(\d+(?:\.\d+)?)\s*mm", s)
    if mm:
        return ("mm", float(mm.group(1)))
    inch = re.search(r'(?<!\d)(\d+)\s*"', s)
    if inch:
        return ("inch", int(inch.group(1)))
    return ("raw", s)


def _names_match(a, b):
    return _norm_name(a) == _norm_name(b)


def _sizes_match(a, b):
    if not a and not b:
        return True
    if not a or not b:
        return False
    return _canonical_size(a) == _canonical_size(b)


def _parse_grades(raw):
    if raw is None:
        return []
    if isinstance(raw, list):
        return list(raw)
    if isinstance(raw, str):
        try:
            val = json.loads(raw)
            return list(val) if isinstance(val, list) else []
        except Exception:
            return []
    return []


def _find_material(conn, name):
    rows = conn.execute(sa.text("SELECT id, name, grades, default_unit FROM material_catalog")).mappings()
    target = _norm(name)
    for row in rows:
        if _norm(row["name"]) == target:
            return row
    return None


def _find_consumable_by_name_size(conn, name, size_spec):
    rows = conn.execute(
        sa.text(
            "SELECT id, name, code, size_spec, unit FROM tools WHERE category = 'CONSUMABLE'"
        )
    ).mappings()
    for row in rows:
        if _names_match(row["name"], name) and _sizes_match(row["size_spec"], size_spec):
            return row
    return None


def _code_exists(conn, code):
    return (
        conn.execute(sa.text("SELECT 1 FROM tools WHERE code = :c"), {"c": code}).first()
        is not None
    )


def upgrade():
    conn = op.get_bind()
    now = _utcnow()
    skipped = []
    unit_notes = []
    inserted_mat = 0
    inserted_tool = 0
    grades_added = 0

    for name, shop_term, grades, unit, category in MATERIAL_ROWS:
        existing = _find_material(conn, name)
        if existing is None:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO material_catalog
                      (id, name, shop_term, grades, default_unit, category, active,
                       created_at, updated_at)
                    VALUES
                      (:id, :name, :shop_term, CAST(:grades AS json), :unit, :category,
                       true, :now, :now)
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "name": name,
                    "shop_term": shop_term,
                    "grades": json.dumps(grades),
                    "unit": unit,
                    "category": category,
                    "now": now,
                },
            )
            inserted_mat += 1
            log.info("INSERTED material: %s (%s, %s)", name, unit, category)
            continue

        current = _parse_grades(existing["grades"])
        known = {_norm(g) for g in current}
        missing = [g for g in grades if _norm(g) not in known]
        if missing:
            new_grades = current + missing
            conn.execute(
                sa.text(
                    """
                    UPDATE material_catalog
                       SET grades = CAST(:grades AS json), updated_at = :now
                     WHERE id = :id
                    """
                ),
                {
                    "id": existing["id"],
                    "grades": json.dumps(new_grades),
                    "now": now,
                },
            )
            grades_added += len(missing)
            log.info("GRADES appended on %s: %s", name, missing)
        else:
            skipped.append(f"material duplicate (no new grades): {name}")
            log.info("SKIPPED material (exists): %s", name)

        row_unit = existing["default_unit"]
        if row_unit and _norm(row_unit) != _norm(unit):
            unit_notes.append(
                f"material {name!r}: kept existing unit {row_unit!r} (wanted {unit!r})"
            )
            log.info(
                "UNIT kept material %s: %s (wanted %s)", name, row_unit, unit
            )

    for code, name, size_spec, unit in CONSUMABLE_ROWS:
        if _code_exists(conn, code):
            skipped.append(f"consumable code collision: {code}")
            log.info("SKIPPED consumable (code exists): %s", code)
            continue
        hit = _find_consumable_by_name_size(conn, name, size_spec)
        if hit is not None:
            skipped.append(
                f"consumable duplicate: {name}"
                + (f" / {size_spec}" if size_spec else "")
                + f" ≈ {hit['code']} ({hit['name']}"
                + (f" / {hit['size_spec']}" if hit["size_spec"] else "")
                + f", unit={hit['unit']})"
            )
            if hit["unit"] and _norm(hit["unit"]) != _norm(unit):
                unit_notes.append(
                    f"consumable {hit['code']}: kept unit {hit['unit']!r} (wanted {unit!r})"
                )
                log.info(
                    "UNIT kept %s: %s (wanted %s)", hit["code"], hit["unit"], unit
                )
            log.info("SKIPPED consumable (name/size): %s %s", name, size_spec)
            continue

        conn.execute(
            sa.text(
                """
                INSERT INTO tools
                  (id, name, code, category, unit, quantity_on_hand, minimum_stock,
                   size_spec, shop_term, created_at, legacy_unit, unit_needs_review,
                   unit_cost, active)
                VALUES
                  (:id, :name, :code, CAST(:category AS toolcategory), :unit, 0, NULL,
                   :size_spec, NULL, :now, NULL, false, NULL, true)
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "name": name,
                "code": code,
                "category": "CONSUMABLE",
                "unit": unit,
                "size_spec": size_spec,
                "now": now,
            },
        )
        inserted_tool += 1
        log.info("INSERTED consumable: %s %s (%s, %s)", name, size_spec, code, unit)

    log.info(
        "054_catalog_fill summary: materials +%d, consumables +%d, grades +%d, skipped %d",
        inserted_mat,
        inserted_tool,
        grades_added,
        len(skipped),
    )
    for line in skipped:
        log.info("SKIP %s", line)
    for line in unit_notes:
        log.info("UNIT %s", line)


def downgrade():
    conn = op.get_bind()

    # Consumables: only unused inserts from our code list.
    for code in CONSUMABLE_CODES:
        row = conn.execute(
            sa.text(
                """
                SELECT id, quantity_on_hand FROM tools WHERE code = :c
                """
            ),
            {"c": code},
        ).mappings().first()
        if not row:
            continue
        tid = row["id"]
        qty = row["quantity_on_hand"] or 0
        events = conn.execute(
            sa.text("SELECT COUNT(*) FROM tool_events WHERE tool_id = :id"),
            {"id": tid},
        ).scalar()
        purchases = conn.execute(
            sa.text("SELECT COUNT(*) FROM material_purchases WHERE tool_id = :id"),
            {"id": tid},
        ).scalar()
        if events or purchases or float(qty) != 0.0:
            log.info(
                "KEEP consumable %s (in use: events=%s purchases=%s qty=%s)",
                code,
                events,
                purchases,
                qty,
            )
            continue
        conn.execute(sa.text("DELETE FROM tools WHERE id = :id"), {"id": tid})
        log.info("DELETED consumable %s", code)

    # Materials: only unused names from MATERIAL_INSERT_NAMES.
    for name in MATERIAL_INSERT_NAMES:
        row = conn.execute(
            sa.text(
                "SELECT id FROM material_catalog WHERE lower(name) = lower(:n)"
            ),
            {"n": name},
        ).mappings().first()
        if not row:
            continue
        mid = row["id"]
        refs = conn.execute(
            sa.text(
                "SELECT COUNT(*) FROM material_purchases WHERE material_catalog_id = :id"
            ),
            {"id": mid},
        ).scalar()
        if refs:
            log.info("KEEP material %s (referenced by %s PO lines)", name, refs)
            continue
        conn.execute(
            sa.text("DELETE FROM material_catalog WHERE id = :id"), {"id": mid}
        )
        log.info("DELETED material %s", name)

    # Strip exact grades this migration appended.
    for name, grades in GRADE_APPENDS.items():
        row = conn.execute(
            sa.text(
                "SELECT id, grades FROM material_catalog WHERE lower(name) = lower(:n)"
            ),
            {"n": name},
        ).mappings().first()
        if not row:
            continue
        current = _parse_grades(row["grades"])
        drop = {_norm(g) for g in grades}
        kept = [g for g in current if _norm(g) not in drop]
        if kept != current:
            conn.execute(
                sa.text(
                    "UPDATE material_catalog SET grades = CAST(:g AS json) WHERE id = :id"
                ),
                {"id": row["id"], "g": json.dumps(kept)},
            )
            log.info("GRADES stripped on %s: %s", name, grades)
