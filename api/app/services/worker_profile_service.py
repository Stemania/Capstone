from datetime import datetime, time

from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models.machine import MachineType
from app.models.user import User, UserRole
from app.models.worker_profile import WorkerProfile
from app.models.worker_skill import (
    CalendarExceptionType,
    OperationType,
    WorkCalendarException,
    WorkerSchedule,
    WorkerSkill,
)
from app.utils.errors import AppError

# Production workers always; Admins only when they have a WorkerProfile
# (Production In-charge — Checking only; see is_checking_operation).
ASSIGNABLE_ROLES = (UserRole.PRODUCTION_WORKER, UserRole.ADMIN)


def _parse_time(value):
    if value is None or value == "":
        return None
    if isinstance(value, time):
        return value
    parts = str(value).strip().split(":")
    hour = int(parts[0])
    minute = int(parts[1]) if len(parts) > 1 else 0
    return time(hour, minute)


def _parse_date(value):
    if value is None or value == "":
        return None
    if hasattr(value, "isoformat") and not isinstance(value, str):
        return value
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def is_checking_operation(operation_type_id=None, operation_name=None) -> bool:
    """True when the operation is Checking (Admin's only assignable work)."""
    if operation_type_id:
        ot = OperationType.query.get(operation_type_id)
        if ot:
            code = (ot.code or "").strip().upper()
            name = (ot.name or "").strip().lower()
            if code == "CHECKING" or name == "checking":
                return True
    name = (operation_name or "").strip().lower()
    return name == "checking"


def is_assignable_worker(user: User | None) -> bool:
    """True if this user can be assigned to a job operation."""
    if not user or not user.active:
        return False
    if user.role == UserRole.PRODUCTION_WORKER:
        return True
    if user.role == UserRole.ADMIN and user.worker_profile is not None:
        return True
    return False


def assert_worker_allowed_for_operation(
    user: User,
    *,
    machine_type_id=None,
    operation_type_id=None,
    operation_name=None,
):
    """Admins may only be assigned to Checking (no machine)."""
    if user.role != UserRole.ADMIN:
        return
    if machine_type_id:
        raise AppError(
            "Admin can only be assigned to Checking",
            "VALIDATION_ERROR",
            400,
        )
    if not is_checking_operation(operation_type_id, operation_name):
        raise AppError(
            "Admin can only be assigned to Checking",
            "VALIDATION_ERROR",
            400,
        )


def query_assignable_workers(*, include_admin: bool = True):
    """
    Active production workers, optionally plus Admins with a worker profile.

    Pass include_admin=False for machine / non-Checking assignment lists so
    Admin does not appear. Checking and shop calendars keep include_admin=True.
    """
    role_filter = User.role == UserRole.PRODUCTION_WORKER
    if include_admin:
        role_filter = db.or_(
            role_filter,
            db.and_(User.role == UserRole.ADMIN, WorkerProfile.id.isnot(None)),
        )
    return (
        User.query.options(joinedload(User.worker_profile))
        .outerjoin(WorkerProfile, WorkerProfile.user_id == User.id)
        .filter(User.active.is_(True), role_filter)
        .order_by(User.full_name)
    )


def ensure_worker_profile(user):
    if user.role not in ASSIGNABLE_ROLES:
        return
    if not user.worker_profile:
        db.session.add(WorkerProfile(user_id=user.id))
        db.session.flush()


def get_worker_or_404(worker_id):
    user = User.query.get(worker_id)
    if not user or not is_assignable_worker(user):
        raise AppError("Worker not found", "NOT_FOUND", 404)
    return user


def list_worker_skills(worker_id):
    get_worker_or_404(worker_id)
    return (
        WorkerSkill.query.filter_by(worker_id=worker_id)
        .order_by(WorkerSkill.is_primary.desc(), WorkerSkill.proficiency.desc())
        .all()
    )


def replace_worker_skills(worker_id, skills_payload):
    """
    Bulk replace skills.
    skills_payload: [{machineTypeId, proficiency, isPrimary}, ...]
    Empty list clears all skills (worker cannot operate any machine).
    """
    worker = get_worker_or_404(worker_id)
    ensure_worker_profile(worker)

    if not isinstance(skills_payload, list):
        raise AppError("skills must be a list", "VALIDATION_ERROR", 400)

    WorkerSkill.query.filter_by(worker_id=worker_id).delete()
    seen = set()
    primary_set = False
    for item in skills_payload:
        mid = item.get("machineTypeId")
        if not mid:
            raise AppError("machineTypeId required", "VALIDATION_ERROR", 400)
        if mid in seen:
            raise AppError("Duplicate machineTypeId", "VALIDATION_ERROR", 400)
        seen.add(mid)
        mt = MachineType.query.get(mid)
        if not mt:
            raise AppError("Invalid machineTypeId", "VALIDATION_ERROR", 400)
        try:
            proficiency = int(item.get("proficiency", 3))
        except (TypeError, ValueError):
            raise AppError("proficiency must be 1-5", "VALIDATION_ERROR", 400)
        if proficiency < 1 or proficiency > 5:
            raise AppError("proficiency must be 1-5", "VALIDATION_ERROR", 400)
        is_primary = bool(item.get("isPrimary", False))
        if is_primary and primary_set:
            is_primary = False
        if is_primary:
            primary_set = True
        db.session.add(
            WorkerSkill(
                worker_id=worker_id,
                machine_type_id=mid,
                proficiency=proficiency,
                is_primary=is_primary,
            )
        )
    db.session.commit()
    return list_worker_skills(worker_id)


def list_worker_schedules(worker_id):
    get_worker_or_404(worker_id)
    return (
        WorkerSchedule.query.filter_by(worker_id=worker_id)
        .order_by(WorkerSchedule.day_of_week)
        .all()
    )


def replace_worker_schedules(worker_id, schedule_payload):
    """
    Expect 7 day rows: [{dayOfWeek, startTime, endTime, isWorking}, ...]
    """
    worker = get_worker_or_404(worker_id)
    ensure_worker_profile(worker)
    if not isinstance(schedule_payload, list) or len(schedule_payload) != 7:
        raise AppError("schedule must include 7 days", "VALIDATION_ERROR", 400)

    WorkerSchedule.query.filter_by(worker_id=worker_id).delete()
    seen_days = set()
    for item in schedule_payload:
        dow = item.get("dayOfWeek")
        try:
            dow = int(dow)
        except (TypeError, ValueError):
            raise AppError("dayOfWeek must be 0-6", "VALIDATION_ERROR", 400)
        if dow < 0 or dow > 6 or dow in seen_days:
            raise AppError("dayOfWeek must be unique 0-6", "VALIDATION_ERROR", 400)
        seen_days.add(dow)
        is_working = bool(item.get("isWorking", True))
        start = _parse_time(item.get("startTime")) if is_working else None
        end = _parse_time(item.get("endTime")) if is_working else None
        if is_working and (not start or not end):
            raise AppError("startTime and endTime required for working days", "VALIDATION_ERROR", 400)
        db.session.add(
            WorkerSchedule(
                worker_id=worker_id,
                day_of_week=dow,
                start_time=start,
                end_time=end,
                is_working=is_working,
            )
        )
    db.session.commit()
    return list_worker_schedules(worker_id)


def list_calendar_exceptions():
    return WorkCalendarException.query.order_by(WorkCalendarException.date.desc()).all()


def create_calendar_exception(data):
    try:
        exc_type = CalendarExceptionType(data["type"])
    except (KeyError, ValueError):
        raise AppError("Invalid calendar exception type", "VALIDATION_ERROR", 400)
    d = _parse_date(data.get("date"))
    if not d:
        raise AppError("date required", "VALIDATION_ERROR", 400)
    row = WorkCalendarException(
        date=d,
        type=exc_type,
        start_time=_parse_time(data.get("startTime")),
        end_time=_parse_time(data.get("endTime")),
        note=data.get("note"),
    )
    db.session.add(row)
    db.session.commit()
    return row


def delete_calendar_exception(exc_id):
    row = WorkCalendarException.query.get(exc_id)
    if not row:
        raise AppError("Exception not found", "NOT_FOUND", 404)
    db.session.delete(row)
    db.session.commit()


def list_operation_types(active_only=True):
    q = OperationType.query
    if active_only:
        q = q.filter_by(active=True)
    return q.order_by(OperationType.name).all()
