"""Export local people/clients and import them onto another database.

Used by ``flask export-people`` / ``flask import-people``. Import is dry-run
by default; ``--apply`` requires the same host confirmation as cleanup.
No passwords or photos are copied. Existing users are never modified.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, time, timezone
from pathlib import Path

from app.extensions import db
from app.services.seed_cleanup_service import (
    KEEP_USER_NAMES,
    REAL_CLIENTS,
    database_label,
)

EXPORT_VERSION = 1
DEFAULT_EXPORT_PATH = Path(r"C:\Users\Janvie\Project\people-export.json")

# Never create/overwrite these by name when they already exist on the target.
# (Any matched existing user is skipped; these are documented examples.)
PROTECTED_EXISTING_NAMES = {
    "admin user",
    "office staff",
    "test",
    "anthony serrano",
    "ericka valinado",
    "mea angel",
}

EXCLUDE_EXPORT_NAMES = {
    "admin user",
    "office staff",
    "test",
}


@dataclass
class ImportReport:
    database: str = ""
    host: str = ""
    nothing_to_do: bool = False
    workers_created: list[str] = field(default_factory=list)
    workers_skipped_existing: list[str] = field(default_factory=list)
    skills_added: int = 0
    skills_skipped_missing_type: list[str] = field(default_factory=list)
    units_assigned: int = 0
    units_skipped_missing: list[str] = field(default_factory=list)
    units_skipped_occupied: list[str] = field(default_factory=list)
    schedule_days_set: int = 0
    clients_filled: list[dict] = field(default_factory=list)
    clients_skipped: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def has_work(self) -> bool:
        return bool(
            self.workers_created
            or self.skills_added
            or self.units_assigned
            or self.schedule_days_set
            or self.clients_filled
        )


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _name_key(name: str | None) -> str:
    return (name or "").strip().lower()


def _is_exportable_worker(user) -> bool:
    from app.models.user import UserRole

    if user.role != UserRole.PRODUCTION_WORKER:
        return False
    email = (user.email or "").strip().lower()
    if email.endswith("@bmsc.local"):
        return False
    key = _name_key(user.full_name)
    if key in EXCLUDE_EXPORT_NAMES:
        return False
    if key.startswith("test "):
        return False
    # Keep-list workers, or any other non-seed production worker.
    if key in KEEP_USER_NAMES:
        return True
    return True


def _time_str(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, time):
        return value.strftime("%H:%M")
    return str(value)[:5]


def _parse_time(value: str | None):
    if not value:
        return None
    parts = value.strip().split(":")
    return time(int(parts[0]), int(parts[1]))


def build_export_payload() -> dict:
    """Snapshot exportable workers + real-client contacts (no ids, no photos)."""
    from app.models.client import Client
    from app.models.machine import MachineUnit
    from app.models.user import User, UserRole
    from app.models.worker_skill import WorkerSchedule, WorkerSkill

    workers_out = []
    workers = (
        User.query.filter(User.role == UserRole.PRODUCTION_WORKER)
        .order_by(User.full_name.asc())
        .all()
    )

    for user in workers:
        if not _is_exportable_worker(user):
            continue
        skills = (
            WorkerSkill.query.filter_by(worker_id=user.id)
            .order_by(WorkerSkill.is_primary.desc(), WorkerSkill.id.asc())
            .all()
        )
        schedules = (
            WorkerSchedule.query.filter_by(worker_id=user.id)
            .order_by(WorkerSchedule.day_of_week.asc())
            .all()
        )
        units = (
            MachineUnit.query.filter_by(default_operator_id=user.id)
            .order_by(MachineUnit.label.asc())
            .all()
        )
        workers_out.append(
            {
                "fullName": user.full_name,
                "role": user.role.value,
                "email": user.email,
                "status": user.status.value if user.status else None,
                "schedule": [
                    {
                        "dayOfWeek": s.day_of_week,
                        "startTime": _time_str(s.start_time),
                        "endTime": _time_str(s.end_time),
                        "isWorking": bool(s.is_working),
                    }
                    for s in schedules
                ],
                "skills": [
                    {
                        "machineTypeCode": (
                            s.machine_type.code if s.machine_type else None
                        ),
                        "machineTypeName": (
                            s.machine_type.name if s.machine_type else None
                        ),
                        "proficiency": s.proficiency,
                        "isPrimary": bool(s.is_primary),
                    }
                    for s in skills
                ],
                "assignedUnits": [
                    {
                        "machineTypeCode": (
                            u.machine_type.code if u.machine_type else None
                        ),
                        "machineTypeName": (
                            u.machine_type.name if u.machine_type else None
                        ),
                        "unitLabel": u.label,
                    }
                    for u in units
                ],
            }
        )

    clients_out: dict = {}
    for name in REAL_CLIENTS:
        client = Client.query.filter(db.func.lower(Client.name) == name.lower()).first()
        if not client:
            clients_out[name] = {
                "contact": None,
                "email": None,
                "mobileNumber": None,
                "notifyByEmail": False,
                "missing": True,
            }
            continue
        clients_out[name] = {
            "contact": client.contact,
            "email": client.email,
            "mobileNumber": client.mobile_number,
            "notifyByEmail": bool(client.notify_by_email),
        }

    return {
        "version": EXPORT_VERSION,
        "exportedAt": _utcnow_iso(),
        "workers": workers_out,
        "clients": clients_out,
    }


def export_people(out_path: Path | str | None = None) -> tuple[Path, dict]:
    path = Path(out_path) if out_path else DEFAULT_EXPORT_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = build_export_payload()
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path, payload


def export_summary(payload: dict) -> list[str]:
    workers = payload.get("workers") or []
    clients = payload.get("clients") or {}
    with_email = sum(1 for w in workers if w.get("email"))
    with_skills = sum(1 for w in workers if w.get("skills"))
    with_schedule = sum(1 for w in workers if w.get("schedule"))
    with_units = sum(1 for w in workers if w.get("assignedUnits"))
    client_with_contact = sum(
        1
        for c in clients.values()
        if isinstance(c, dict)
        and (c.get("contact") or c.get("email") or c.get("mobileNumber"))
    )
    return [
        f"Workers exported: {len(workers)}",
        f"  with email: {with_email}",
        f"  with schedule: {with_schedule}",
        f"  with skills: {with_skills}",
        f"  with assigned units: {with_units}",
        f"Clients exported: {len(clients)}",
        f"  with any contact field: {client_with_contact}",
    ]


def _find_machine_type(code: str | None, name: str | None):
    from app.models.machine import MachineType

    if code:
        mt = MachineType.query.filter(
            db.func.lower(MachineType.code) == code.strip().lower()
        ).first()
        if mt:
            return mt
    if name:
        return MachineType.query.filter(
            db.func.lower(MachineType.name) == name.strip().lower()
        ).first()
    return None


def _find_unit(machine_type, label: str | None):
    from app.models.machine import MachineUnit

    if not machine_type or not label:
        return None
    return MachineUnit.query.filter(
        MachineUnit.machine_type_id == machine_type.id,
        db.func.lower(MachineUnit.label) == label.strip().lower(),
    ).first()


def _find_existing_user(email: str | None, full_name: str):
    from app.models.user import User

    if email:
        found = User.query.filter(db.func.lower(User.email) == email.strip().lower()).first()
        if found:
            return found
    return User.query.filter(db.func.lower(User.full_name) == full_name.strip().lower()).first()


def _create_worker_from_export(row: dict, report: ImportReport) -> None:
    from app.models.user import User, UserRole, UserStatus
    from app.models.worker_profile import WorkerProfile
    from app.models.worker_skill import WorkerSchedule, WorkerSkill
    from app.services.worker_profile_service import add_default_hours

    status_raw = (row.get("status") or "INVITED").upper()
    try:
        status = UserStatus[status_raw]
    except KeyError:
        status = UserStatus.INVITED

    user = User(
        email=(row.get("email") or None),
        password_hash=None,
        full_name=row["fullName"],
        role=UserRole.PRODUCTION_WORKER,
        status=status,
        active=(status == UserStatus.ACTIVE),
    )
    if user.email:
        user.email = user.email.strip().lower()
    db.session.add(user)
    db.session.flush()
    db.session.add(WorkerProfile(user_id=user.id))
    db.session.flush()

    schedule_rows = row.get("schedule") or []
    if schedule_rows:
        for day in schedule_rows:
            db.session.add(
                WorkerSchedule(
                    worker_id=user.id,
                    day_of_week=int(day["dayOfWeek"]),
                    start_time=_parse_time(day.get("startTime")),
                    end_time=_parse_time(day.get("endTime")),
                    is_working=bool(day.get("isWorking", True)),
                )
            )
            report.schedule_days_set += 1
    elif add_default_hours(user.id):
        report.schedule_days_set += WorkerSchedule.query.filter_by(worker_id=user.id).count()

    for skill in row.get("skills") or []:
        mt = _find_machine_type(skill.get("machineTypeCode"), skill.get("machineTypeName"))
        label = skill.get("machineTypeCode") or skill.get("machineTypeName") or "?"
        if not mt:
            report.skills_skipped_missing_type.append(f"{row['fullName']}: {label}")
            continue
        db.session.add(
            WorkerSkill(
                worker_id=user.id,
                machine_type_id=mt.id,
                proficiency=int(skill.get("proficiency") or 3),
                is_primary=bool(skill.get("isPrimary")),
            )
        )
        report.skills_added += 1

    for unit_row in row.get("assignedUnits") or []:
        mt = _find_machine_type(
            unit_row.get("machineTypeCode"), unit_row.get("machineTypeName")
        )
        label = unit_row.get("unitLabel") or "?"
        type_label = unit_row.get("machineTypeCode") or unit_row.get("machineTypeName") or "?"
        unit = _find_unit(mt, unit_row.get("unitLabel"))
        if not unit:
            report.units_skipped_missing.append(
                f"{row['fullName']}: {type_label}/{label}"
            )
            continue
        if unit.default_operator_id and unit.default_operator_id != user.id:
            report.units_skipped_occupied.append(
                f"{row['fullName']}: {type_label}/{label}"
            )
            continue
        if unit.default_operator_id != user.id:
            unit.default_operator_id = user.id
            report.units_assigned += 1

    report.workers_created.append(row["fullName"])


def _fill_client_contacts(name: str, data: dict, report: ImportReport) -> None:
    from app.models.client import Client

    client = Client.query.filter(db.func.lower(Client.name) == name.lower()).first()
    if not client:
        report.clients_skipped.append(f"{name} (missing on target)")
        return
    filled = []
    contact = data.get("contact")
    email = data.get("email")
    mobile = data.get("mobileNumber")
    notify = data.get("notifyByEmail")

    if contact and not (client.contact or "").strip():
        client.contact = contact
        filled.append("contact")
    if email and not (client.email or "").strip():
        client.email = email
        filled.append("email")
    if mobile and not (client.mobile_number or "").strip():
        client.mobile_number = mobile
        filled.append("mobile")
    # Only set notify flag when we filled an email or contact and target flag is false
    # and source wants email updates — still only when "empty" means False default.
    if notify and not client.notify_by_email:
        client.notify_by_email = True
        filled.append("notifyByEmail")

    if filled:
        report.clients_filled.append({"name": name, "fields": filled})
    else:
        report.clients_skipped.append(f"{name} (already filled or nothing to copy)")


def import_people(
    path: Path | str,
    *,
    apply: bool = False,
    confirm_host: str | None = None,
) -> ImportReport:
    """Import people JSON. Dry run rolls back; apply commits after host confirm."""
    masked, host, _db_name = database_label()
    report = ImportReport(database=masked, host=host)

    if apply:
        if not confirm_host or confirm_host.strip().lower() != host.lower():
            raise ValueError(
                f"Host confirmation failed (expected {host!r}, got {confirm_host!r}). Aborted."
            )

    file_path = Path(path)
    payload = json.loads(file_path.read_text(encoding="utf-8"))
    if int(payload.get("version") or 0) != EXPORT_VERSION:
        report.notes.append(
            f"Unexpected export version {payload.get('version')!r}; continuing"
        )

    try:
        for row in payload.get("workers") or []:
            name = row.get("fullName") or ""
            if not name.strip():
                continue
            existing = _find_existing_user(row.get("email"), name)
            if existing:
                report.workers_skipped_existing.append(name)
                continue
            _create_worker_from_export(row, report)

        clients = payload.get("clients") or {}
        for name in REAL_CLIENTS:
            data = clients.get(name)
            if not isinstance(data, dict) or data.get("missing"):
                report.clients_skipped.append(f"{name} (not in export)")
                continue
            _fill_client_contacts(name, data, report)

        db.session.flush()
        report.nothing_to_do = not report.has_work()
    except Exception:
        db.session.rollback()
        raise

    if apply:
        db.session.commit()
    else:
        db.session.rollback()
    return report


def import_report_lines(report: ImportReport, *, applied: bool) -> list[str]:
    verb = "Applied" if applied else "Would apply"
    out = [
        f"Database: {report.database}",
        f"Mode: {'APPLY (committed)' if applied else 'DRY RUN (rolled back)'}",
        "",
    ]
    if report.nothing_to_do:
        out.append("Nothing to do.")
        return out

    out.append(f"WORKERS - {verb}")
    out.append(f"  Created ({len(report.workers_created)}):")
    for n in report.workers_created or ["(none)"]:
        out.append(f"    - {n}")
    out.append(f"  Skipped existing ({len(report.workers_skipped_existing)}):")
    for n in report.workers_skipped_existing or ["(none)"]:
        out.append(f"    - {n}")
    out.append(f"  Schedule days set: {report.schedule_days_set}")
    out.append(f"  Skills added: {report.skills_added}")
    if report.skills_skipped_missing_type:
        out.append("  Skills skipped (machine type missing on target):")
        for n in report.skills_skipped_missing_type:
            out.append(f"    - {n}")
    out.append(f"  Units assigned: {report.units_assigned}")
    if report.units_skipped_missing:
        out.append("  Units skipped (missing on target):")
        for n in report.units_skipped_missing:
            out.append(f"    - {n}")
    if report.units_skipped_occupied:
        out.append("  Units skipped (already has default operator):")
        for n in report.units_skipped_occupied:
            out.append(f"    - {n}")
    out.append("")
    out.append(f"CLIENTS - {verb}")
    out.append(f"  Contact fields filled ({len(report.clients_filled)}):")
    for row in report.clients_filled or []:
        out.append(f"    - {row['name']}: {', '.join(row['fields'])}")
    if not report.clients_filled:
        out.append("    - (none)")
    out.append(f"  Clients skipped ({len(report.clients_skipped)}):")
    for n in report.clients_skipped or ["(none)"]:
        out.append(f"    - {n}")
    for note in report.notes:
        out.append(f"Note: {note}")
    return out


__all__ = [
    "DEFAULT_EXPORT_PATH",
    "ImportReport",
    "PROTECTED_EXISTING_NAMES",
    "build_export_payload",
    "export_people",
    "export_summary",
    "import_people",
    "import_report_lines",
]
