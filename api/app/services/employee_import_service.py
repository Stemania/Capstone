"""Import the shop's employees from a git-ignored CSV (`flask import-employees`).

Columns: full_name, nickname, role (ADMIN, OFFICE, WORKER), machine_skills
(machine type names separated by ";", or ALL), default_units (unit names
separated by ";").

People are matched to existing accounts by full name. New accounts are not
activated and have no password or email; the Admin invites each person once
their email or mobile number is known. Running the same file again changes
nothing: existing skill levels and default operators set by the Admin are kept.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import time
from pathlib import Path

from app.extensions import db
from app.models.machine import MachineType, MachineUnit
from app.models.user import User, UserRole, UserStatus
from app.models.worker_profile import WorkerProfile
from app.models.worker_skill import WorkerSchedule, WorkerSkill
from app.utils.errors import AppError

COLUMNS = ("full_name", "nickname", "role", "machine_skills", "default_units")
ROLES = {
    "ADMIN": UserRole.ADMIN,
    "OFFICE": UserRole.OFFICE_STAFF,
    "OFFICE_STAFF": UserRole.OFFICE_STAFF,
    "WORKER": UserRole.PRODUCTION_WORKER,
    "PRODUCTION_WORKER": UserRole.PRODUCTION_WORKER,
}
ROLE_LABEL = {
    UserRole.ADMIN: "ADMIN",
    UserRole.OFFICE_STAFF: "OFFICE",
    UserRole.PRODUCTION_WORKER: "WORKER",
}
IMPORTED_SKILL_LEVEL = 3


@dataclass
class ImportReport:
    created: list[str] = field(default_factory=list)
    changes: list[str] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)
    unchanged: int = 0


def _key(text: str) -> str:
    return " ".join((text or "").split()).casefold()


def _split(cell: str) -> list[str]:
    return [p.strip() for p in (cell or "").split(";") if p.strip()]


def read_rows(path: Path) -> list[dict]:
    if not path.is_file():
        raise AppError(f"File not found: {path}", "NOT_FOUND", 404)
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        header = [(h or "").strip() for h in (reader.fieldnames or [])]
        missing = [c for c in COLUMNS if c not in header]
        if missing:
            raise AppError(
                f"Missing column(s): {', '.join(missing)}. Expected: {', '.join(COLUMNS)}",
                "VALIDATION_ERROR",
                400,
            )
        return [
            {(k or "").strip(): (v or "").strip() for k, v in row.items()} for row in reader
        ]


def _default_schedule(user: User) -> None:
    for dow in range(7):
        working = dow < 6
        db.session.add(
            WorkerSchedule(
                worker_id=user.id,
                day_of_week=dow,
                start_time=time(8, 0) if working else None,
                end_time=time(17, 0) if working else None,
                is_working=working,
            )
        )


def import_employees(path: Path, dry_run: bool = False) -> ImportReport:
    rows = read_rows(path)
    report = ImportReport()

    machine_types = MachineType.query.order_by(MachineType.name).all()
    type_by_key = {}
    for mt in machine_types:
        type_by_key[_key(mt.name)] = mt
        type_by_key[_key(mt.code)] = mt
    unit_by_key = {
        _key(u.label): u for u in MachineUnit.query.filter_by(active=True).all()
    }
    users_by_key: dict[str, list[User]] = {}
    for u in User.query.all():
        users_by_key.setdefault(_key(u.full_name), []).append(u)

    seen_names: set[str] = set()
    claimed_units: dict[str, str] = {}

    try:
        for line_no, row in enumerate(rows, start=2):
            name = " ".join(row.get("full_name", "").split())
            where = f"line {line_no}"
            if not name:
                report.problems.append(f"{where}: no full_name; skipped")
                continue
            where = f"line {line_no} ({name})"
            if _key(name) in seen_names:
                report.problems.append(f"{where}: listed twice in the file; skipped")
                continue
            seen_names.add(_key(name))

            role_raw = row.get("role", "").upper()
            role = ROLES.get(role_raw)
            if role is None:
                report.problems.append(
                    f"{where}: role '{row.get('role', '')}' is not ADMIN, OFFICE or WORKER; skipped"
                )
                continue
            nickname = row.get("nickname", "")[:40] or None

            skill_cell = row.get("machine_skills", "")
            if skill_cell.strip().upper() == "ALL":
                wanted_types = list(machine_types)
            else:
                wanted_types = []
                for token in _split(skill_cell):
                    mt = type_by_key.get(_key(token))
                    if mt is None:
                        report.problems.append(f"{where}: machine type '{token}' not found")
                    elif mt not in wanted_types:
                        wanted_types.append(mt)

            wanted_units = []
            for token in _split(row.get("default_units", "")):
                unit = unit_by_key.get(_key(token))
                if unit is None:
                    report.problems.append(f"{where}: unit '{token}' not found")
                elif unit.id in claimed_units:
                    report.problems.append(
                        f"{where}: unit '{unit.label}' is already listed for "
                        f"{claimed_units[unit.id]}; skipped here"
                    )
                else:
                    claimed_units[unit.id] = name
                    wanted_units.append(unit)

            if role == UserRole.OFFICE_STAFF and (wanted_types or wanted_units):
                report.problems.append(
                    f"{where}: office staff take no machine skills or units; ignored"
                )
                wanted_types, wanted_units = [], []

            matches = users_by_key.get(_key(name), [])
            if len(matches) > 1:
                report.problems.append(
                    f"{where}: {len(matches)} accounts have this name; skipped"
                )
                continue

            row_changes: list[str] = []
            if matches:
                user = matches[0]
                if user.role != role:
                    report.problems.append(
                        f"{where}: the account is {ROLE_LABEL[user.role]}, the file says "
                        f"{ROLE_LABEL[role]}; role not changed"
                    )
                if user.status == UserStatus.DISABLED:
                    report.problems.append(f"{where}: the account is disabled; skipped")
                    continue
                if nickname and user.nickname != nickname:
                    row_changes.append(f"nickname {user.nickname or '(none)'} -> {nickname}")
                    user.nickname = nickname
            else:
                user = User(
                    email=None,
                    password_hash=None,
                    full_name=name,
                    nickname=nickname,
                    role=role,
                    status=UserStatus.INVITED,
                    active=False,
                )
                db.session.add(user)
                db.session.flush()
                users_by_key[_key(name)] = [user]
                report.created.append(
                    f"{name}{f' ({nickname})' if nickname else ''}, {ROLE_LABEL[role]}, not activated"
                )

            if user.role in (UserRole.PRODUCTION_WORKER, UserRole.ADMIN):
                if not WorkerProfile.query.filter_by(user_id=user.id).first():
                    db.session.add(WorkerProfile(user_id=user.id))
                if not WorkerSchedule.query.filter_by(worker_id=user.id).first():
                    _default_schedule(user)
                    row_changes.append("working hours Mon-Sat 08:00-17:00")

                have = {
                    s.machine_type_id
                    for s in WorkerSkill.query.filter_by(worker_id=user.id).all()
                }
                for mt in wanted_types:
                    if mt.id in have:
                        continue
                    db.session.add(
                        WorkerSkill(
                            worker_id=user.id,
                            machine_type_id=mt.id,
                            proficiency=IMPORTED_SKILL_LEVEL,
                            is_primary=False,
                        )
                    )
                    row_changes.append(f"skill {mt.name} level {IMPORTED_SKILL_LEVEL}")

                for unit in wanted_units:
                    if unit.default_operator_id == user.id:
                        continue
                    if unit.default_operator_id:
                        current = db.session.get(User, unit.default_operator_id)
                        report.problems.append(
                            f"{where}: {unit.label} already has "
                            f"{current.full_name if current else 'another'} as default "
                            "operator; kept"
                        )
                        continue
                    unit.default_operator_id = user.id
                    row_changes.append(f"default operator of {unit.label}")
            db.session.flush()

            if row_changes:
                report.changes.append(f"{name}: " + ", ".join(row_changes))
            elif matches:
                report.unchanged += 1
    except Exception:
        db.session.rollback()
        raise

    if dry_run:
        db.session.rollback()
    else:
        db.session.commit()
    return report
