from datetime import datetime, time, timedelta

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


def resolve_operation_type(operation_type_id=None, operation_name=None):
    if operation_type_id:
        ot = db.session.get(OperationType, operation_type_id)
        if ot:
            return ot
    if operation_name:
        name = str(operation_name).strip()
        return OperationType.query.filter(
            (OperationType.name.ilike(name))
            | (OperationType.code.ilike(name.replace(" ", "_")))
        ).first()
    return None


def is_skill_tracked_type(ot) -> bool:
    """Operation types that use no machine carry their own worker skill.
    Checking (Admin's work) and outsourced types are left out."""
    return bool(
        ot
        and not ot.default_machine_type_id
        and not ot.is_outsourced
        and (ot.code or "").upper() != "CHECKING"
    )


def operation_skill_holders(machine_type_id=None, operation_type_id=None, operation_name=None):
    """(operation type, {worker_id: WorkerSkill}) when an operation without a
    machine is skill-tracked and at least one worker has that skill recorded;
    otherwise (operation type or None, None) and every worker qualifies."""
    if machine_type_id:
        return None, None
    ot = resolve_operation_type(operation_type_id, operation_name)
    if not is_skill_tracked_type(ot):
        return ot, None
    rows = WorkerSkill.query.filter_by(operation_type_id=ot.id).all()
    if not rows:
        return ot, None
    return ot, {s.worker_id: s for s in rows}


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
    skills_payload: [{machineTypeId | operationTypeId, proficiency, isPrimary}, ...]
    operationTypeId is for operation types that use no machine (Layout, Welding...).
    Empty list clears all skills.
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
        oid = item.get("operationTypeId")
        if bool(mid) == bool(oid):
            raise AppError(
                "Each skill needs a machine type or an operation type", "VALIDATION_ERROR", 400
            )
        key = ("machine", mid) if mid else ("operation", oid)
        if key in seen:
            raise AppError("Duplicate skill", "VALIDATION_ERROR", 400)
        seen.add(key)
        if mid:
            mt = MachineType.query.get(mid)
            if not mt:
                raise AppError("Invalid machineTypeId", "VALIDATION_ERROR", 400)
        else:
            ot = db.session.get(OperationType, oid)
            if not ot:
                raise AppError("Invalid operationTypeId", "VALIDATION_ERROR", 400)
            if not is_skill_tracked_type(ot):
                raise AppError(
                    f"{ot.name} does not take a worker skill "
                    "(it uses a machine, is outsourced, or is Checking)",
                    "VALIDATION_ERROR",
                    400,
                )
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
                machine_type_id=mid or None,
                operation_type_id=oid or None,
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


def list_calendar_exceptions(from_s=None, to_s=None):
    q = WorkCalendarException.query
    d0 = _parse_date(from_s)
    d1 = _parse_date(to_s)
    if d0:
        q = q.filter(WorkCalendarException.date >= d0)
    if d1:
        q = q.filter(WorkCalendarException.date <= d1)
    return q.order_by(WorkCalendarException.date.asc()).all()


def _default_shop_schedule_by_dow():
    """Mon–Sat 08:00–17:00 fallback when an op has no worker schedule."""
    from app.services.schedule_calendar import default_shop_schedule_by_dow

    return default_shop_schedule_by_dow()


def create_calendar_exception(data):
    try:
        exc_type = CalendarExceptionType(data["type"])
    except (KeyError, ValueError):
        raise AppError("Invalid calendar exception type", "VALIDATION_ERROR", 400)
    d0 = _parse_date(data.get("date") or data.get("from") or data.get("dateFrom"))
    d1 = _parse_date(data.get("dateTo") or data.get("to") or data.get("date"))
    if not d0:
        raise AppError("date required", "VALIDATION_ERROR", 400)
    if not d1:
        d1 = d0
    if d1 < d0:
        raise AppError("'dateTo' must be on or after 'date'", "VALIDATION_ERROR", 400)

    start_t = _parse_time(data.get("startTime"))
    end_t = _parse_time(data.get("endTime"))
    if exc_type == CalendarExceptionType.HOLIDAY_NO_WORK:
        start_t = None
        end_t = None
    elif not start_t or not end_t:
        raise AppError(
            "startTime and endTime are required for overtime and special working days",
            "VALIDATION_ERROR",
            400,
        )
    elif end_t <= start_t:
        raise AppError("endTime must be after startTime", "VALIDATION_ERROR", 400)

    note = data.get("note")
    created = []
    cur = d0

    while cur <= d1:
        existing = WorkCalendarException.query.filter_by(date=cur).first()
        if existing:
            raise AppError(
                f"An exception already exists on {cur.isoformat()}. "
                "Delete or update it first.",
                "CONFLICT",
                409,
            )
        row = WorkCalendarException(
            date=cur,
            type=exc_type,
            start_time=start_t,
            end_time=end_t,
            note=note,
        )
        db.session.add(row)
        created.append(row)
        cur += timedelta(days=1)
    db.session.commit()
    return created


def update_calendar_exception(exc_id, data):
    row = WorkCalendarException.query.get(exc_id)
    if not row:
        raise AppError("Exception not found", "NOT_FOUND", 404)

    if "type" in data and data["type"] is not None:
        try:
            row.type = CalendarExceptionType(data["type"])
        except ValueError:
            raise AppError("Invalid calendar exception type", "VALIDATION_ERROR", 400)

    if "date" in data and data["date"] is not None:
        new_d = _parse_date(data["date"])
        if not new_d:
            raise AppError("Invalid date", "VALIDATION_ERROR", 400)
        clash = (
            WorkCalendarException.query.filter(
                WorkCalendarException.date == new_d,
                WorkCalendarException.id != row.id,
            ).first()
        )
        if clash:
            raise AppError(
                f"An exception already exists on {new_d.isoformat()}",
                "CONFLICT",
                409,
            )
        row.date = new_d

    if "note" in data:
        row.note = data.get("note")

    if row.type == CalendarExceptionType.HOLIDAY_NO_WORK:
        row.start_time = None
        row.end_time = None
    else:
        if "startTime" in data:
            row.start_time = _parse_time(data.get("startTime"))
        if "endTime" in data:
            row.end_time = _parse_time(data.get("endTime"))
        if not row.start_time or not row.end_time:
            raise AppError(
                "startTime and endTime are required for overtime and special working days",
                "VALIDATION_ERROR",
                400,
            )
        if row.end_time <= row.start_time:
            raise AppError("endTime must be after startTime", "VALIDATION_ERROR", 400)

    db.session.commit()
    return row


def delete_calendar_exception(exc_id):
    row = WorkCalendarException.query.get(exc_id)
    if not row:
        raise AppError("Exception not found", "NOT_FOUND", 404)
    db.session.delete(row)
    db.session.commit()


def calendar_exception_delete_impact(exc_id):
    """
    Count scheduled ops with working time inside the hours this exception
    (OT / special day) adds, i.e. work that would be stranded if it were removed.
    """
    from datetime import datetime, timedelta, timezone

    from app.models.operation import JobOperation, OperationStatus
    from app.services.schedule_calendar import (
        SHOP_TZ,
        build_worker_working_windows,
        derive_working_segments,
        intersect_intervals,
        load_calendar_exceptions,
        load_worker_schedule_maps,
        subtract_intervals,
    )

    row = WorkCalendarException.query.get(exc_id)
    if not row:
        raise AppError("Exception not found", "NOT_FOUND", 404)

    on_date = row.date
    with_exc = load_calendar_exceptions(on_date, on_date)
    with_exc[on_date] = row
    without_exc = {d: e for d, e in with_exc.items() if d != on_date}

    day_start = datetime.combine(on_date, time.min, tzinfo=SHOP_TZ)
    day_end = day_start + timedelta(days=1)
    day_start_utc = day_start.astimezone(timezone.utc)
    day_end_utc = day_end.astimezone(timezone.utc)

    ops = (
        JobOperation.query.filter(
            JobOperation.scheduled_start.isnot(None),
            JobOperation.scheduled_end.isnot(None),
            JobOperation.scheduled_start < day_end_utc,
            JobOperation.scheduled_end > day_start_utc,
            JobOperation.status.in_(
                (
                    OperationStatus.SCHEDULED,
                    OperationStatus.IN_PROGRESS,
                    OperationStatus.REWORK,
                )
            ),
        ).all()
    )

    default_sched = _default_shop_schedule_by_dow()
    schedule_cache = {}
    affected = []
    day_utc = [(day_start_utc, day_end_utc)]

    for op in ops:
        wid = op.assigned_worker_id
        if wid:
            if wid not in schedule_cache:
                loaded = load_worker_schedule_maps(wid)
                schedule_cache[wid] = loaded if loaded else default_sched
            sched = schedule_cache[wid]
        else:
            sched = default_sched

        worked_today = intersect_intervals(
            derive_working_segments(op.scheduled_start, op.scheduled_end, sched, with_exc),
            day_utc,
        )
        remaining_windows = build_worker_working_windows(
            sched, without_exc, day_start_utc, day_end_utc
        )
        stranded = bool(subtract_intervals(worked_today, remaining_windows))

        if stranded:
            job = op.job_order
            year = job.created_at.year if job and job.created_at else on_date.year
            short = (job.id or "")[:4].upper() if job else ""
            affected.append(
                {
                    "id": op.id,
                    "jobOrderId": op.job_order_id,
                    "jobNumber": f"JO-{year}-{short}" if job else None,
                    "operationName": op.operation_name,
                    "scheduledStart": op.scheduled_start.isoformat()
                    if op.scheduled_start
                    else None,
                    "scheduledEnd": op.scheduled_end.isoformat()
                    if op.scheduled_end
                    else None,
                }
            )

    return {
        "exceptionId": row.id,
        "date": on_date.isoformat(),
        "type": row.type.value,
        "affectedCount": len(affected),
        "affectedOperations": affected,
    }


def jobs_affected_by_calendar_change(from_s, to_s=None):
    """
    Released jobs with not-yet-started operations scheduled on the changed
    date(s). Nothing is moved here; the Admin chooses which jobs to re-propose.
    """
    from datetime import datetime, timedelta, timezone

    from app.models.job_order import JobOrder, JobOrderStatus
    from app.models.operation import JobOperation, OperationStatus
    from app.services.schedule_calendar import SHOP_TZ

    d0 = _parse_date(from_s)
    d1 = _parse_date(to_s) if to_s else d0
    if not d0 or not d1:
        raise AppError("date required", "VALIDATION_ERROR", 400)
    if d1 < d0:
        d0, d1 = d1, d0

    start_utc = datetime.combine(d0, time.min, tzinfo=SHOP_TZ).astimezone(timezone.utc)
    end_utc = (
        datetime.combine(d1, time.min, tzinfo=SHOP_TZ) + timedelta(days=1)
    ).astimezone(timezone.utc)

    ops = (
        JobOperation.query.join(JobOrder)
        .filter(
            JobOrder.status.in_((JobOrderStatus.SCHEDULED, JobOrderStatus.IN_PROGRESS)),
            JobOperation.status.in_(
                (OperationStatus.PENDING, OperationStatus.SCHEDULED, OperationStatus.REWORK)
            ),
            JobOperation.actual_start.is_(None),
            JobOperation.scheduled_start.isnot(None),
            JobOperation.scheduled_end.isnot(None),
            JobOperation.scheduled_start < end_utc,
            JobOperation.scheduled_end > start_utc,
        )
        .order_by(JobOperation.scheduled_start.asc())
        .all()
    )

    jobs = {}
    for op in ops:
        job = op.job_order
        entry = jobs.get(job.id)
        if entry is None:
            entry = jobs[job.id] = {
                "jobOrderId": job.id,
                "jobNumber": job.job_number,
                "title": job.title,
                "clientName": job.client.name if job.client else None,
                "dueDate": job.due_date.isoformat() if job.due_date else None,
                "operations": [],
            }
        entry["operations"].append(
            {
                "id": op.id,
                "sequenceNo": op.sequence_no,
                "operationName": op.operation_name,
                "scheduledStart": op.scheduled_start.isoformat(),
                "scheduledEnd": op.scheduled_end.isoformat(),
            }
        )

    return {
        "from": d0.isoformat(),
        "to": d1.isoformat(),
        "jobs": list(jobs.values()),
    }


def get_shop_settings():
    """The single settings row, created with the default break when missing."""
    from app.models.shop_settings import ShopSettings

    row = db.session.get(ShopSettings, 1)
    if row is None:
        row = ShopSettings(id=1)
        db.session.add(row)
        db.session.commit()
    return row


def update_shop_break(data, actor_id):
    """Set the daily break. Returns (settings, jobs with upcoming work to re-propose)."""
    from app.constants.scheduling import SCHEDULE_HORIZON_DAYS
    from app.services.audit_service import write_audit_event
    from app.services.schedule_calendar import shop_now

    try:
        start = _parse_time(data.get("breakStart"))
        end = _parse_time(data.get("breakEnd"))
    except (TypeError, ValueError):
        raise AppError("Enter the break as HH:MM", "VALIDATION_ERROR", 400)
    if not start or not end:
        raise AppError("Enter the break start and end", "VALIDATION_ERROR", 400)
    if end <= start:
        raise AppError("The break must end after it starts", "VALIDATION_ERROR", 400)

    row = get_shop_settings()
    before = row.to_dict()
    row.break_start = start
    row.break_end = end
    row.updated_by_id = actor_id
    db.session.flush()
    write_audit_event("SHOP_BREAK_CHANGED", "ShopSettings", "1", before=before, after=row.to_dict())
    db.session.commit()

    today = shop_now().date()
    affected = jobs_affected_by_calendar_change(
        today.isoformat(), (today + timedelta(days=SCHEDULE_HORIZON_DAYS)).isoformat()
    )
    return row, affected["jobs"]


def list_operation_types(active_only=True):
    q = OperationType.query
    if active_only:
        q = q.filter_by(active=True)
    return q.order_by(OperationType.name).all()
