"""One-off cleanup of seeded/sample people and companies.

Used by ``flask cleanup-seed-data`` (dry run unless ``--apply``). Merges seed
suppliers and clients into real records, remaps ``@bmsc.local`` workers onto
real employees, then deletes the seed accounts. Not seeding — safe to invoke
in any environment; never runs from migrations or deploy.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable

from sqlalchemy import MetaData, inspect, text

from app.extensions import db
from app.utils.db_url import mask_database_url

KEEP_SUPPLIER_NAMES = {
    "Railim Industrial Corporation",
    "Raitech Industrial Corporation",
    "STP Industrial Inc.",
}
# Exact seed/duplicate names → keep-supplier name.
MERGE_SUPPLIERS = {
    "Railim Industrial Corporation (duplicate)": "Railim Industrial Corporation",
    "STP Industrial Hardware Inc. (duplicate)": "STP Industrial Inc.",
    "Metro Hardware": "STP Industrial Inc.",
    "Seno Metals": "Railim Industrial Corporation",
}

KEEP_USER_NAMES = {
    "admin user",
    "office staff",
    "test",
    "anthony pajantoy",
    "ariel macairap",
    "emerson agao",
    "ervin agao",
    "geoff agao",
    "gio agao",
    "jerick aringo",
    "john rey ganal",
    "joseph carido",
    "marvin fondevilla",
    "marvin sese",
    "melvin cablao",
    "olimpio grajo iii",
    "pao bobila",
}

SEED_WORKER_EMAIL_SUFFIX = "@bmsc.local"
CLIENT_PREFIXES = ("HIST-SEED ", "TC-SEED ")
TITLE_PREFIXES = ("[HIST-SEED] ", "[TC-SEED] ")
TEXT_PREFIXES = ("HIST-SEED ", "TC-SEED ")
NOTIFICATION_CLIENT = "TC-SEED Notification Client (TC-29)"
BSU_NAME = "BSU"

# When deleting a worker these are removed, not remapped.
USER_OWNED_DELETE_TABLES = {
    "worker_profiles",
    "worker_skills",
    "worker_schedules",
    "user_devices",
    "user_photos",
    "password_reset_tokens",
    "offline_action_receipts",
}

OPEN_OP_STATUSES = ("PENDING", "SCHEDULED", "IN_PROGRESS", "REWORK")

FAKE_EMAIL_RE = re.compile(
    r"(@hist-seed\.local|@example\.com|@tc-seed\.local|@.*\.local)$", re.I
)
FAKE_CONTACT_RE = re.compile(r"replace with a real contact", re.I)


@dataclass
class MoveCounts:
    by_table: dict[str, int] = field(default_factory=dict)

    def add(self, table: str, n: int = 1) -> None:
        if n:
            self.by_table[table] = self.by_table.get(table, 0) + n


@dataclass
class CleanupReport:
    database: str = ""
    host: str = ""
    db_name: str = ""
    nothing_to_do: bool = False
    suppliers_cleared_seed: list[str] = field(default_factory=list)
    suppliers_merged: list[dict] = field(default_factory=list)
    suppliers_left_seed: list[str] = field(default_factory=list)
    clients_renamed: list[dict] = field(default_factory=list)
    clients_merged: list[dict] = field(default_factory=list)
    clients_contacts_cleared: list[str] = field(default_factory=list)
    worker_mapping: list[dict] = field(default_factory=list)
    worker_moves: dict[str, dict[str, int]] = field(default_factory=dict)
    attendance_dropped: int = 0
    open_ops_unassigned: list[dict] = field(default_factory=list)
    workers_deleted: list[str] = field(default_factory=list)
    workers_listed_only: list[str] = field(default_factory=list)
    text_cleanup: dict[str, int] = field(default_factory=dict)
    finals: dict = field(default_factory=dict)

    def has_work(self) -> bool:
        return bool(
            self.suppliers_cleared_seed
            or self.suppliers_merged
            or self.clients_renamed
            or self.clients_merged
            or self.worker_mapping
            or self.text_cleanup
            or self.open_ops_unassigned
        )


def database_label(url=None) -> tuple[str, str, str]:
    """Return (masked host/db, host, db name) for the current engine URL."""
    raw = url if url is not None else str(db.engine.url)
    masked = mask_database_url(raw)
    host, _, db_name = masked.partition("/")
    return masked, host, db_name


def _fk_refs(*parent_tables: str) -> list[tuple[str, str, str]]:
    """(child_table, child_column, parent_table) for FKs pointing at parents."""
    parents = set(parent_tables)
    out = []
    md = MetaData()
    md.reflect(bind=db.engine)
    for table in md.tables.values():
        for fk in table.foreign_keys:
            ref = fk.column.table.name
            if ref in parents:
                out.append((table.name, fk.parent.name, ref))
    return out


def _unique_column_sets(table_name: str) -> list[tuple[str, ...]]:
    """Full unique keys only. Partial unique indexes (e.g. one DRAFT per
    supplier) are skipped — Postgres enforces them on UPDATE; we catch that
    and delete the conflicting source row then."""
    insp = inspect(db.engine)
    sets = []
    for uq in insp.get_unique_constraints(table_name):
        cols = tuple(uq.get("column_names") or ())
        if cols:
            sets.append(cols)
    for idx in insp.get_indexes(table_name):
        if not idx.get("unique"):
            continue
        # Partial unique indexes (postgresql_where) must not be treated as
        # full-table unique — that falsely conflicts every order per supplier.
        dialect_opts = idx.get("dialect_options") or {}
        if dialect_opts.get("postgresql_where") is not None:
            continue
        if idx.get("duplicates_constraint"):
            continue
        cols = tuple(idx.get("column_names") or ())
        if cols:
            sets.append(cols)
    return sets


def _force_delete_row(table: str, pk_cols: list[str], pk_vals: dict) -> None:
    """Delete one row, clearing or deleting children that RESTRICT first."""
    # Children that reference this table.
    for child_table, child_col, parent in _fk_refs(table):
        if parent != table:
            continue
        # Match child rows pointing at this PK (single-column FK only).
        if len(pk_cols) != 1:
            continue
        parent_pk = pk_cols[0]
        child_pk = list(
            inspect(db.engine).get_pk_constraint(child_table).get("constrained_columns") or []
        )
        kids = db.session.execute(
            text(f"SELECT * FROM {child_table} WHERE {child_col} = :v"),
            {"v": pk_vals[f"pk_{parent_pk}"]},
        ).mappings().all()
        nullable = any(
            c["name"] == child_col and c.get("nullable", True)
            for c in inspect(db.engine).get_columns(child_table)
        )
        for kid in kids:
            if nullable:
                if child_pk:
                    where = " AND ".join(f"{c} = :k_{c}" for c in child_pk)
                    db.session.execute(
                        text(f"UPDATE {child_table} SET {child_col} = NULL WHERE {where}"),
                        {f"k_{c}": kid[c] for c in child_pk},
                    )
                else:
                    db.session.execute(
                        text(
                            f"UPDATE {child_table} SET {child_col} = NULL "
                            f"WHERE {child_col} = :v"
                        ),
                        {"v": pk_vals[f"pk_{parent_pk}"]},
                    )
            elif child_pk:
                _force_delete_row(child_table, child_pk, {f"pk_{c}": kid[c] for c in child_pk})
    where_pk = " AND ".join(f"{c} = :pk_{c}" for c in pk_cols)
    db.session.execute(text(f"DELETE FROM {table} WHERE {where_pk}"), pk_vals)


def _reassign_fk(
    table: str,
    column: str,
    old_id: str,
    new_id: str,
    counts: MoveCounts,
) -> int:
    """Point ``table.column`` from old_id to new_id. On unique conflict, delete
    the old row instead. Returns rows moved + deleted."""
    if old_id == new_id:
        return 0
    moved = deleted = 0
    rows = db.session.execute(
        text(f"SELECT * FROM {table} WHERE {column} = :old"),
        {"old": old_id},
    ).mappings().all()
    if not rows:
        return 0

    uq_sets = [cols for cols in _unique_column_sets(table) if column in cols]
    pk_cols = list(inspect(db.engine).get_pk_constraint(table).get("constrained_columns") or [])

    for row in rows:
        conflict = False
        for cols in uq_sets:
            vals = {c: (new_id if c == column else row[c]) for c in cols}
            if any(v is None for v in vals.values()):
                continue
            where = " AND ".join(f"{c} = :{c}" for c in cols)
            if pk_cols:
                where += " AND NOT (" + " AND ".join(
                    f"{c} IS NOT DISTINCT FROM :pk_{c}" for c in pk_cols
                ) + ")"
                for c in pk_cols:
                    vals[f"pk_{c}"] = row[c]
            hit = db.session.execute(
                text(f"SELECT 1 FROM {table} WHERE {where} LIMIT 1"),
                vals,
            ).first()
            if hit:
                conflict = True
                break
        if not conflict and pk_cols:
            # Attempt update; catch partial-unique / other integrity errors.
            where_pk = " AND ".join(f"{c} = :pk_{c}" for c in pk_cols)
            try:
                with db.session.begin_nested():
                    db.session.execute(
                        text(f"UPDATE {table} SET {column} = :new WHERE {where_pk}"),
                        {"new": new_id, **{f"pk_{c}": row[c] for c in pk_cols}},
                    )
                moved += 1
                counts.add(table, 1)
                continue
            except Exception:
                conflict = True
        if conflict:
            if pk_cols:
                _force_delete_row(table, pk_cols, {f"pk_{c}": row[c] for c in pk_cols})
            else:
                db.session.execute(
                    text(f"DELETE FROM {table} WHERE {column} = :old"),
                    {"old": old_id},
                )
            deleted += 1
            counts.add(f"{table} (deleted, unique)", 1)
        else:
            # No PK path (rare): bulk update.
            db.session.execute(
                text(f"UPDATE {table} SET {column} = :new WHERE {column} = :old"),
                {"new": new_id, "old": old_id},
            )
            moved += 1
            counts.add(table, 1)
            break
    return moved + deleted


def _reassign_all_fks(
    old_id: str,
    new_id: str,
    parent_tables: Iterable[str],
    counts: MoveCounts,
    *,
    skip_tables: set[str] | None = None,
    skip_columns: set[tuple[str, str]] | None = None,
) -> None:
    skip_tables = skip_tables or set()
    skip_columns = skip_columns or set()
    for table, column, _parent in _fk_refs(*parent_tables):
        if table in skip_tables or (table, column) in skip_columns:
            continue
        _reassign_fk(table, column, old_id, new_id, counts)


def _delete_rows(table: str, column: str, value: str) -> int:
    result = db.session.execute(
        text(f"DELETE FROM {table} WHERE {column} = :v"),
        {"v": value},
    )
    return result.rowcount or 0


# --- Suppliers -----------------------------------------------------------------


def _supplier_by_name(name: str):
    from app.models.supplier import Supplier

    return Supplier.query.filter(db.func.lower(Supplier.name) == name.lower()).first()


def cleanup_suppliers(report: CleanupReport) -> None:
    from app.models.supplier import Supplier

    for name in KEEP_SUPPLIER_NAMES:
        s = _supplier_by_name(name)
        if s and s.is_seed:
            s.is_seed = False
            report.suppliers_cleared_seed.append(s.name)

    for src_name, dest_name in MERGE_SUPPLIERS.items():
        src = _supplier_by_name(src_name)
        dest = _supplier_by_name(dest_name)
        if not src:
            continue
        if not dest:
            report.suppliers_left_seed.append(f"{src_name} (no target {dest_name!r})")
            continue
        if src.id == dest.id:
            continue
        counts = MoveCounts()
        _reassign_all_fks(src.id, dest.id, ("suppliers",), counts)
        db.session.flush()
        db.session.delete(src)
        db.session.flush()
        report.suppliers_merged.append(
            {"from": src_name, "to": dest_name, "moved": dict(counts.by_table)}
        )

    for s in Supplier.query.filter_by(is_seed=True).order_by(Supplier.name).all():
        if s.name in KEEP_SUPPLIER_NAMES:
            continue
        if s.name in MERGE_SUPPLIERS:
            continue
        report.suppliers_left_seed.append(s.name)


# --- Clients -------------------------------------------------------------------


def _strip_client_prefix(name: str) -> str | None:
    for p in CLIENT_PREFIXES:
        if name.startswith(p):
            return name[len(p) :].strip()
    return None


def _is_fake_contact(contact, email, mobile) -> bool:
    if email and FAKE_EMAIL_RE.search(email.strip()):
        return True
    if contact and FAKE_CONTACT_RE.search(contact):
        return True
    if contact and FAKE_EMAIL_RE.search(contact.strip()):
        return True
    if mobile and FAKE_EMAIL_RE.search(str(mobile).strip()):
        return True
    return False


def _clear_fake_contacts(client, report: CleanupReport) -> None:
    if _is_fake_contact(client.contact, client.email, client.mobile_number):
        client.contact = None
        client.email = None
        client.mobile_number = None
        client.notify_by_email = False
        client.notify_by_sms = False
        report.clients_contacts_cleared.append(client.name)


def _merge_client(src, dest, report: CleanupReport) -> None:
    counts = MoveCounts()
    _reassign_all_fks(src.id, dest.id, ("clients",), counts)
    db.session.flush()
    name = src.name
    db.session.delete(src)
    db.session.flush()
    report.clients_merged.append(
        {"from": name, "to": dest.name, "moved": dict(counts.by_table)}
    )


def cleanup_clients(report: CleanupReport) -> None:
    from app.models.client import Client

    # Special: notification client → BSU
    note = Client.query.filter(Client.name == NOTIFICATION_CLIENT).first()
    bsu = Client.query.filter(db.func.lower(Client.name) == BSU_NAME.lower()).first()
    if note and bsu:
        _merge_client(note, bsu, report)
    elif note and not bsu:
        report.clients_merged.append(
            {"from": note.name, "to": "(missing BSU — left alone)", "moved": {}}
        )

    seeded = [
        c
        for c in Client.query.order_by(Client.created_at.asc(), Client.name.asc()).all()
        if _strip_client_prefix(c.name)
    ]
    # Group by stripped name (case-insensitive).
    groups: dict[str, list] = defaultdict(list)
    for c in seeded:
        stripped = _strip_client_prefix(c.name)
        if stripped:
            groups[stripped.lower()].append((c, stripped))

    for _key, members in groups.items():
        stripped = members[0][1]
        # Prefer an already-real client with that name.
        real = (
            Client.query.filter(db.func.lower(Client.name) == stripped.lower())
            .filter(~Client.name.in_([m[0].name for m in members]))
            .first()
        )
        if real is None:
            # Exact match among non-prefixed existing (may already exist as Sanitary Care).
            real = (
                Client.query.filter(db.func.lower(Client.name) == stripped.lower())
                .filter(~Client.name.like("HIST-SEED %"))
                .filter(~Client.name.like("TC-SEED %"))
                .first()
            )

        if real is not None:
            for c, _s in members:
                if c.id == real.id:
                    continue
                if db.session.get(Client, c.id) is None:
                    continue
                _merge_client(c, real, report)
            continue

        # Rename first (oldest), merge the rest into it.
        keep_client, keep_stripped = members[0]
        if keep_client.name != keep_stripped:
            old = keep_client.name
            keep_client.name = keep_stripped
            _clear_fake_contacts(keep_client, report)
            report.clients_renamed.append({"from": old, "to": keep_stripped})
            db.session.flush()
        else:
            _clear_fake_contacts(keep_client, report)

        for c, _s in members[1:]:
            if db.session.get(Client, c.id) is None:
                continue
            _merge_client(c, keep_client, report)


# --- Workers -------------------------------------------------------------------


def _worker_load(user_id: str) -> int:
    """How many history rows a worker already carries (for even spreading)."""
    n = 0
    for sql in (
        "SELECT count(*) FROM operations WHERE assigned_worker_id = :id",
        "SELECT count(*) FROM operation_time_logs WHERE worker_id = :id",
        "SELECT count(*) FROM tool_events WHERE worker_id = :id",
        "SELECT count(*) FROM attendance_records WHERE worker_id = :id",
    ):
        n += db.session.execute(text(sql), {"id": user_id}).scalar() or 0
    return n


def _skill_types(user_id: str) -> set[str]:
    rows = db.session.execute(
        text("SELECT machine_type_id FROM worker_skills WHERE worker_id = :id"),
        {"id": user_id},
    ).all()
    return {r[0] for r in rows}


def _build_worker_mapping(seeded: list, keepers: list) -> list[tuple]:
    """Map each seeded worker → a keep worker. Prefer shared skills, else fewest rows."""
    loads = {k.id: _worker_load(k.id) for k in keepers}
    skills = {k.id: _skill_types(k.id) for k in keepers}
    mapping = []
    for seed in seeded:
        seed_skills = _skill_types(seed.id)
        best = None
        best_key = None
        for k in keepers:
            shared = len(seed_skills & skills[k.id])
            key = (-shared, loads[k.id], k.full_name.lower())
            if best_key is None or key < best_key:
                best_key = key
                best = k
        mapping.append((seed, best))
        loads[best.id] = loads.get(best.id, 0) + _worker_load(seed.id) + 1
    return mapping


def _intervals_overlap(a0, a1, b0, b1) -> bool:
    if not a0 or not a1 or not b0 or not b1:
        return False
    return a0 < b1 and b0 < a1


def _handle_open_operations(seed, keep, report: CleanupReport) -> None:
    from app.models.job_order import JobOrder
    from app.models.operation import JobOperation, OperationStatus
    from app.services.job_order_service import mark_needs_replan

    open_statuses = [OperationStatus[s] for s in OPEN_OP_STATUSES if s in OperationStatus.__members__]
    ops = (
        JobOperation.query.filter(
            JobOperation.assigned_worker_id == seed.id,
            JobOperation.status.in_(open_statuses),
        ).all()
    )
    keep_ops = (
        JobOperation.query.filter(
            JobOperation.assigned_worker_id == keep.id,
            JobOperation.status.in_(open_statuses),
        ).all()
    )
    for op in ops:
        conflict = any(
            _intervals_overlap(
                op.scheduled_start, op.scheduled_end, other.scheduled_start, other.scheduled_end
            )
            for other in keep_ops
        )
        if conflict:
            op.assigned_worker_id = None
            job = db.session.get(JobOrder, op.job_order_id)
            if job is not None:
                mark_needs_replan(
                    job,
                    "Seed worker removed; booking conflict",
                    f"Operation '{op.operation_name}' was unassigned during seed cleanup "
                    f"because it overlapped {keep.full_name}'s schedule.",
                    dedupe_key=f"seed-cleanup-unassign:{op.id}",
                )
            report.open_ops_unassigned.append(
                {
                    "operationId": op.id,
                    "jobId": op.job_order_id,
                    "from": seed.full_name,
                    "wouldHaveBeen": keep.full_name,
                    "status": op.status.value if op.status else None,
                }
            )
        else:
            op.assigned_worker_id = keep.id
            keep_ops.append(op)
            report.worker_moves.setdefault(seed.email or seed.id, {})
            report.worker_moves[seed.email or seed.id]["operations"] = (
                report.worker_moves[seed.email or seed.id].get("operations", 0) + 1
            )


def _delete_user_owned(user_id: str) -> None:
    """Drop PIN devices, sessions, tokens, skills, schedule, profile for a seed user."""
    _delete_rows("user_invitations", "user_id", user_id)
    _delete_rows("user_devices", "user_id", user_id)
    _delete_rows("user_photos", "user_id", user_id)
    _delete_rows("password_reset_tokens", "user_id", user_id)
    _delete_rows("offline_action_receipts", "user_id", user_id)
    _delete_rows("worker_skills", "worker_id", user_id)
    _delete_rows("worker_schedules", "worker_id", user_id)
    _delete_rows("worker_profiles", "user_id", user_id)


def cleanup_workers(report: CleanupReport) -> None:
    from app.models.user import User, UserRole

    keepers = [
        u
        for u in User.query.filter_by(role=UserRole.PRODUCTION_WORKER).all()
        if (u.full_name or "").strip().lower() in KEEP_USER_NAMES
    ]
    # Also keep non-worker named accounts (Admin User, Office Staff, test) — never delete them.
    keep_ids = {u.id for u in keepers}
    for u in User.query.all():
        if (u.full_name or "").strip().lower() in KEEP_USER_NAMES:
            keep_ids.add(u.id)

    seeded = [
        u
        for u in User.query.filter_by(role=UserRole.PRODUCTION_WORKER)
        .order_by(User.email.asc(), User.full_name.asc())
        .all()
        if (u.email or "").lower().endswith(SEED_WORKER_EMAIL_SUFFIX) and u.id not in keep_ids
    ]

    # Anything else that looks seeded (listed only).
    for u in User.query.order_by(User.full_name).all():
        email = (u.email or "").lower()
        name = (u.full_name or "").strip().lower()
        if u.id in keep_ids:
            continue
        if u in seeded:
            continue
        if email.endswith(SEED_WORKER_EMAIL_SUFFIX) and u.role != UserRole.PRODUCTION_WORKER:
            report.workers_listed_only.append(
                f"{u.full_name} <{u.email}> role={u.role.value} (not a worker — left alone)"
            )
        elif name.startswith("hist-seed") or name.startswith("tc-seed"):
            report.workers_listed_only.append(f"{u.full_name} <{u.email}> (looks seeded — left alone)")

    if not seeded:
        return
    if not keepers:
        for s in seeded:
            report.workers_listed_only.append(
                f"{s.full_name} <{s.email}> (no real employees to map onto — left alone)"
            )
        return

    mapping = _build_worker_mapping(seeded, keepers)
    for seed, keep in mapping:
        report.worker_mapping.append(
            {
                "from": seed.full_name,
                "fromEmail": seed.email,
                "to": keep.full_name,
                "toId": keep.id,
            }
        )
        counts = MoveCounts()
        key = seed.email or seed.id

        # Open ops first (special overlap rules); skip assigned_worker later.
        _handle_open_operations(seed, keep, report)
        db.session.flush()

        # Attendance: move unless keep already has that day.
        att_rows = db.session.execute(
            text("SELECT id, work_date FROM attendance_records WHERE worker_id = :id"),
            {"id": seed.id},
        ).all()
        for att_id, work_date in att_rows:
            exists = db.session.execute(
                text(
                    "SELECT 1 FROM attendance_records WHERE worker_id = :k AND work_date = :d LIMIT 1"
                ),
                {"k": keep.id, "d": work_date},
            ).first()
            if exists:
                db.session.execute(
                    text("DELETE FROM attendance_records WHERE id = :id"),
                    {"id": att_id},
                )
                report.attendance_dropped += 1
                counts.add("attendance_records (dropped)", 1)
            else:
                db.session.execute(
                    text("UPDATE attendance_records SET worker_id = :k WHERE id = :id"),
                    {"k": keep.id, "id": att_id},
                )
                counts.add("attendance_records", 1)

        skip_tables = set(USER_OWNED_DELETE_TABLES) | {
            "user_invitations",  # invitee rows deleted with the seed account
            "attendance_records",
        }
        skip_columns = {("operations", "assigned_worker_id")}

        _reassign_all_fks(
            seed.id,
            keep.id,
            ("users",),
            counts,
            skip_tables=skip_tables,
            skip_columns=skip_columns,
        )
        # Remaining ops still pointing at the seed (completed, or open that moved).
        _reassign_fk("operations", "assigned_worker_id", seed.id, keep.id, counts)

        _delete_user_owned(seed.id)
        db.session.flush()
        # Safety net for any leftover FKs (e.g. invitations.created_by_id).
        _reassign_all_fks(seed.id, keep.id, ("users",), counts, skip_tables={"users"})
        db.session.flush()
        db.session.delete(seed)
        db.session.flush()
        report.workers_deleted.append(f"{seed.full_name} <{key}>")
        report.worker_moves[key] = dict(counts.by_table)


# --- Leftover seed text --------------------------------------------------------


def cleanup_seed_text(report: CleanupReport) -> None:
    """Strip known seed prefixes from visible title/notes fields only."""
    # Job titles: [HIST-SEED] / [TC-SEED]
    for prefix in TITLE_PREFIXES:
        result = db.session.execute(
            text(
                "UPDATE job_orders SET title = substr(title, :n) "
                "WHERE title LIKE :pat"
            ),
            {"n": len(prefix) + 1, "pat": prefix + "%"},
        )
        if result.rowcount:
            report.text_cleanup["job_orders.title"] = (
                report.text_cleanup.get("job_orders.title", 0) + result.rowcount
            )

    # Job descriptions / PO numbers / supplier order notes: HIST-SEED / TC-SEED
    text_targets = [
        ("job_orders", "description"),
        ("job_orders", "client_po_number"),
        ("supplier_orders", "notes"),
        ("machine_downtimes", "note"),
        ("work_calendar_exceptions", "note"),
        ("stocktakes", "notes"),
        ("tool_events", "reason"),
    ]
    for table, column in text_targets:
        # Skip if column missing (older schemas).
        cols = {c["name"] for c in inspect(db.engine).get_columns(table)}
        if column not in cols:
            continue
        for prefix in TEXT_PREFIXES:
            result = db.session.execute(
                text(
                    f"UPDATE {table} SET {column} = substr({column}, :n) "
                    f"WHERE {column} LIKE :pat"
                ),
                {"n": len(prefix) + 1, "pat": prefix + "%"},
            )
            if result.rowcount:
                key = f"{table}.{column}"
                report.text_cleanup[key] = report.text_cleanup.get(key, 0) + result.rowcount


def _final_totals() -> dict:
    from app.models.client import Client
    from app.models.supplier import Supplier
    from app.models.user import User, UserRole, UserStatus

    by_role = {}
    for role in UserRole:
        by_role[role.value] = User.query.filter(
            User.role == role,
            User.status == UserStatus.ACTIVE,
            User.active.is_(True),
        ).count()
    return {
        "suppliers": Supplier.query.count(),
        "clients": Client.query.count(),
        "activeUsersByRole": by_role,
    }


def run(*, apply: bool = False, confirm_host: str | None = None) -> CleanupReport:
    """Run cleanup in one transaction. Dry run rolls back; ``apply`` commits.

    When ``apply`` is True, ``confirm_host`` must equal the database host
    (case-insensitive). Pass ``confirm_host`` from the CLI after prompting.
    """
    masked, host, db_name = database_label()
    report = CleanupReport(database=masked, host=host, db_name=db_name)

    if apply:
        if not confirm_host or confirm_host.strip().lower() != host.lower():
            raise ValueError(
                f"Host confirmation failed (expected {host!r}, got {confirm_host!r}). Aborted."
            )

    try:
        cleanup_suppliers(report)
        cleanup_clients(report)
        cleanup_workers(report)
        cleanup_seed_text(report)
        db.session.flush()
        report.finals = _final_totals()
        report.nothing_to_do = not report.has_work()
    except Exception:
        db.session.rollback()
        raise

    if apply:
        db.session.commit()
    else:
        db.session.rollback()
    return report


def report_lines(report: CleanupReport, *, applied: bool) -> list[str]:
    verb = "Applied" if applied else "Would apply"
    out = [
        f"Database: {report.database}",
        f"Mode: {'APPLY (committed)' if applied else 'DRY RUN (rolled back)'}",
        "",
    ]
    if report.nothing_to_do:
        out.append("Nothing to do - database already clean of targeted seed records.")
        out.append("")
        out.append(
            f"Final totals: suppliers={report.finals.get('suppliers')}, "
            f"clients={report.finals.get('clients')}, "
            f"active users by role={report.finals.get('activeUsersByRole')}"
        )
        return out

    out.append(f"SUPPLIERS — {verb}")
    out.append(f"  Seed flag cleared ({len(report.suppliers_cleared_seed)}):")
    for n in report.suppliers_cleared_seed or ["(none)"]:
        out.append(f"    - {n}")
    out.append(f"  Merged then deleted ({len(report.suppliers_merged)}):")
    for row in report.suppliers_merged or []:
        moved = ", ".join(f"{k}={v}" for k, v in (row.get("moved") or {}).items()) or "no FK rows"
        out.append(f"    - {row['from']!r} → {row['to']!r}  [{moved}]")
    if report.suppliers_left_seed:
        out.append("  Other seed-flagged suppliers (left alone):")
        for n in report.suppliers_left_seed:
            out.append(f"    - {n}")
    out.append("")

    out.append(f"CLIENTS — {verb}")
    out.append(f"  Renamed ({len(report.clients_renamed)}):")
    for row in report.clients_renamed or []:
        out.append(f"    - {row['from']!r} → {row['to']!r}")
    out.append(f"  Merged then deleted ({len(report.clients_merged)}):")
    for row in report.clients_merged or []:
        moved = ", ".join(f"{k}={v}" for k, v in (row.get("moved") or {}).items()) or "no FK rows"
        out.append(f"    - {row['from']!r} → {row['to']!r}  [{moved}]")
    out.append(f"  Contacts cleared ({len(report.clients_contacts_cleared)}):")
    for n in report.clients_contacts_cleared or ["(none)"]:
        out.append(f"    - {n}")
    out.append("")

    out.append(f"WORKERS — {verb}")
    out.append(f"  Mapping ({len(report.worker_mapping)}):")
    for row in report.worker_mapping or []:
        out.append(f"    - {row['from']} <{row['fromEmail']}> → {row['to']}")
    out.append("  Rows moved per seeded worker:")
    if not report.worker_moves:
        out.append("    - (none)")
    for email, moves in report.worker_moves.items():
        moved = ", ".join(f"{k}={v}" for k, v in moves.items()) or "none"
        out.append(f"    - {email}: {moved}")
    out.append(f"  Attendance rows dropped (unique day): {report.attendance_dropped}")
    out.append(f"  Open operations unassigned + jobs flagged ({len(report.open_ops_unassigned)}):")
    for row in report.open_ops_unassigned or []:
        out.append(
            f"    - op {row['operationId']} job {row['jobId']} "
            f"({row['from']} → would be {row['wouldHaveBeen']}, {row['status']})"
        )
    out.append(f"  Deleted workers ({len(report.workers_deleted)}):")
    for n in report.workers_deleted or ["(none)"]:
        out.append(f"    - {n}")
    if report.workers_listed_only:
        out.append("  Listed only (not removed):")
        for n in report.workers_listed_only:
            out.append(f"    - {n}")
    out.append("")

    out.append(f"TEXT CLEANUP — {verb}")
    if not report.text_cleanup:
        out.append("  - (none)")
    for k, v in sorted(report.text_cleanup.items()):
        out.append(f"  - {k}: {v}")
    out.append("")

    out.append(
        f"Final totals: suppliers={report.finals.get('suppliers')}, "
        f"clients={report.finals.get('clients')}, "
        f"active users by role={report.finals.get('activeUsersByRole')}"
    )
    return out
