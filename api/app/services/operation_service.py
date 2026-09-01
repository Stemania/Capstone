"""Operation start/pause/resume/complete with append-only time logs."""

from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal

from app.extensions import db
from app.models.job_order import JobOrderStatus
from app.models.operation import JobOperation, OperationStatus
from app.models.operation_time import (
    MachineDowntime,
    OperationPauseReason,
    OperationTimeEvent,
    OperationTimeLog,
)
from app.models.user import UserRole
from app.services.job_order_service import (
    advance_part_condition,
    check_job_access,
    derive_job_status,
)
from app.utils.errors import AppError


def _parse_timestamp(value):
    if value is None or value == "":
        return datetime.now(timezone.utc)
    if isinstance(value, str):
        ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return ts
    if getattr(value, "tzinfo", None) is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _ensure_utc(dt):
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def list_my_operations(worker_id):
    from sqlalchemy.orm import joinedload
    from app.models.job_order import JobOrder, PRODUCTION_VISIBLE_STATUSES

    return (
        JobOperation.query.options(
            joinedload(JobOperation.job_order).joinedload(JobOrder.client),
            joinedload(JobOperation.machine_type),
            joinedload(JobOperation.assigned_worker),
            joinedload(JobOperation.time_logs),
        )
        .join(JobOrder, JobOperation.job_order_id == JobOrder.id)
        .filter(
            JobOperation.assigned_worker_id == worker_id,
            JobOrder.status.in_(tuple(PRODUCTION_VISIBLE_STATUSES)),
        )
        .order_by(JobOperation.sequence_no.asc())
        .all()
    )


def _assert_worker_owns(operation, user_id, user_role):
    check_job_access(operation.job_order, user_id, user_role)
    if user_role == UserRole.PRODUCTION_WORKER.value:
        if operation.assigned_worker_id != user_id:
            raise AppError(
                "You can only update operations assigned to you", "FORBIDDEN", 403
            )


def _append_log(operation, worker_id, event, event_at, reason=None, note=None):
    log = OperationTimeLog(
        operation_id=operation.id,
        worker_id=worker_id,
        event=event,
        event_at=_ensure_utc(event_at),
        reason=reason,
        note=note,
    )
    db.session.add(log)
    return log


def _ordered_logs(operation):
    logs = list(operation.time_logs or [])
    logs.sort(key=lambda L: (_ensure_utc(L.event_at), L.created_at or _ensure_utc(L.event_at)))
    return logs


def compute_worked_hours(operation) -> Decimal | None:
    """Sum START/RESUME → PAUSE/COMPLETE intervals. Ignores gaps while paused."""
    logs = _ordered_logs(operation)
    if not logs:
        return None

    total_seconds = 0.0
    open_start = None
    saw_close = False
    for log in logs:
        ev = log.event
        at = _ensure_utc(log.event_at)
        if ev in (OperationTimeEvent.START, OperationTimeEvent.RESUME):
            if open_start is None:
                open_start = at
        elif ev in (OperationTimeEvent.PAUSE, OperationTimeEvent.COMPLETE):
            if open_start is not None and at > open_start:
                total_seconds += (at - open_start).total_seconds()
                saw_close = True
            open_start = None

    if not saw_close:
        return None
    return Decimal(str(round(total_seconds / 3600.0, 4)))


def recompute_variance(operation):
    worked = compute_worked_hours(operation)
    operation.actual_worked_hours = worked
    est = operation.estimated_hours
    if worked is None or est is None or Decimal(str(est)) == 0:
        operation.variance_hours = None
        operation.variance_pct = None
        return
    est_d = Decimal(str(est))
    variance = worked - est_d
    operation.variance_hours = variance
    operation.variance_pct = (variance / est_d) * Decimal("100")


def _last_event(operation):
    logs = _ordered_logs(operation)
    return logs[-1] if logs else None


def start_operation(operation, user_id, user_role, timestamp):
    from app.constants.machines import assert_machine_type_available
    from app.models.job_order import JobOrderStatus

    _assert_worker_owns(operation, user_id, user_role)

    job = operation.job_order
    if job.status == JobOrderStatus.DRAFT:
        raise AppError(
            "This job has not been released to production yet",
            "INVALID_TRANSITION",
            409,
        )

    if operation.status == OperationStatus.IN_PROGRESS:
        last = _last_event(operation)
        if last and last.event == OperationTimeEvent.START:
            return operation
        if last and last.event in (OperationTimeEvent.START, OperationTimeEvent.RESUME):
            return operation

    if operation.status == OperationStatus.COMPLETED:
        raise AppError(
            "Cannot start a completed operation", "INVALID_TRANSITION", 409
        )

    assert_machine_type_available(
        operation.machine_type_id,
        exclude_operation_id=operation.id,
    )
    if operation.machine_unit_id:
        _assert_unit_not_down(operation.machine_unit_id)

    ts = _parse_timestamp(timestamp)
    before_status = job.status
    try:
        operation.status = OperationStatus.IN_PROGRESS
        if not operation.actual_start:
            operation.actual_start = ts
        _append_log(
            operation,
            operation.assigned_worker_id or user_id,
            OperationTimeEvent.START,
            ts,
        )
        job.status = derive_job_status(job)
        db.session.commit()
        if (
            before_status != JobOrderStatus.IN_PROGRESS
            and job.status == JobOrderStatus.IN_PROGRESS
        ):
            from app.models.notification import NotificationMilestone
            from app.services.notification_service import safe_notify_job_milestone

            safe_notify_job_milestone(job.id, NotificationMilestone.JOB_STARTED)
        return operation
    except Exception:
        db.session.rollback()
        raise


def pause_operation(operation, user_id, user_role, reason, note=None, timestamp=None):
    _assert_worker_owns(operation, user_id, user_role)

    if operation.status != OperationStatus.IN_PROGRESS:
        raise AppError(
            "Only in-progress operations can be paused", "INVALID_TRANSITION", 409
        )

    last = _last_event(operation)
    if last and last.event == OperationTimeEvent.PAUSE:
        return operation
    if not last or last.event not in (
        OperationTimeEvent.START,
        OperationTimeEvent.RESUME,
    ):
        raise AppError(
            "Operation is not actively running", "INVALID_TRANSITION", 409
        )

    try:
        pause_reason = OperationPauseReason(reason) if reason else None
    except ValueError:
        raise AppError("Invalid pause reason", "VALIDATION_ERROR", 400)

    if pause_reason is None:
        raise AppError("reason is required to pause", "VALIDATION_ERROR", 400)

    ts = _parse_timestamp(timestamp)
    try:
        _append_log(
            operation,
            operation.assigned_worker_id or user_id,
            OperationTimeEvent.PAUSE,
            ts,
            reason=pause_reason,
            note=note,
        )
        db.session.commit()
        return operation
    except Exception:
        db.session.rollback()
        raise


def resume_operation(operation, user_id, user_role, timestamp=None):
    from app.constants.machines import assert_machine_type_available

    _assert_worker_owns(operation, user_id, user_role)

    if operation.status != OperationStatus.IN_PROGRESS:
        raise AppError(
            "Only in-progress operations can be resumed", "INVALID_TRANSITION", 409
        )

    last = _last_event(operation)
    if not last or last.event != OperationTimeEvent.PAUSE:
        raise AppError(
            "Operation is not paused", "INVALID_TRANSITION", 409
        )

    assert_machine_type_available(
        operation.machine_type_id,
        exclude_operation_id=operation.id,
    )
    if operation.machine_unit_id:
        _assert_unit_not_down(operation.machine_unit_id)

    ts = _parse_timestamp(timestamp)
    try:
        _append_log(
            operation,
            operation.assigned_worker_id or user_id,
            OperationTimeEvent.RESUME,
            ts,
        )
        db.session.commit()
        return operation
    except Exception:
        db.session.rollback()
        raise


def complete_operation(operation, user_id, user_role, timestamp):
    _assert_worker_owns(operation, user_id, user_role)

    if operation.status == OperationStatus.COMPLETED:
        return operation

    if operation.status in (OperationStatus.PENDING, OperationStatus.SCHEDULED):
        raise AppError(
            "Operation must be started before completing", "INVALID_TRANSITION", 409
        )

    last = _last_event(operation)
    if last and last.event == OperationTimeEvent.PAUSE:
        raise AppError(
            "Resume the operation before completing", "INVALID_TRANSITION", 409
        )

    ts = _parse_timestamp(timestamp)
    job = operation.job_order
    before_status = job.status
    try:
        if not operation.actual_start:
            operation.actual_start = ts
        operation.status = OperationStatus.COMPLETED
        operation.actual_end = ts
        _append_log(
            operation,
            operation.assigned_worker_id or user_id,
            OperationTimeEvent.COMPLETE,
            ts,
        )
        # Refresh relationship for variance calc
        db.session.flush()
        recompute_variance(operation)
        from sqlalchemy.orm import joinedload
        from app.models.job_order import JobOrder

        job = (
            JobOrder.query.options(
                joinedload(JobOrder.operations).joinedload(JobOperation.operation_type),
            ).get(job.id)
        )
        job.status = derive_job_status(job)
        advance_part_condition(job)
        db.session.commit()
        if (
            before_status != JobOrderStatus.COMPLETED
            and job.status == JobOrderStatus.COMPLETED
        ):
            from app.models.notification import NotificationMilestone
            from app.services.notification_service import safe_notify_job_milestone

            safe_notify_job_milestone(job.id, NotificationMilestone.JOB_COMPLETED)
        return operation
    except Exception:
        db.session.rollback()
        raise


def create_rework_operation(operation, user_id, user_role, reason):
    """Create a follow-on PENDING op; leave the completed original intact."""
    check_job_access(operation.job_order, user_id, user_role)
    if user_role not in (
        UserRole.ADMIN.value,
        UserRole.OFFICE_STAFF.value,
    ):
        raise AppError("Only Admin or Office Staff can send for rework", "FORBIDDEN", 403)

    if operation.status != OperationStatus.COMPLETED:
        raise AppError(
            "Only completed operations can be sent for rework", "INVALID_TRANSITION", 409
        )
    if not reason or not str(reason).strip():
        raise AppError("rework reason is required", "VALIDATION_ERROR", 400)

    job = operation.job_order
    max_seq = max((op.sequence_no for op in job.operations), default=0)

    try:
        operation.rework_reason = str(reason).strip()
        follow = JobOperation(
            job_order_id=job.id,
            sequence_no=max_seq + 1,
            operation_name=operation.operation_name,
            operation_type_id=operation.operation_type_id,
            machine_type_id=operation.machine_type_id,
            machine_unit_id=None,
            assigned_worker_id=None,
            estimated_hours=operation.estimated_hours,
            status=OperationStatus.PENDING,
            rework_of_operation_id=operation.id,
            rework_reason=str(reason).strip(),
        )
        db.session.add(follow)
        job.status = derive_job_status(job)
        db.session.commit()
        return follow
    except Exception:
        db.session.rollback()
        raise


def _assert_unit_not_down(machine_unit_id):
    open_dt = (
        MachineDowntime.query.filter_by(machine_unit_id=machine_unit_id, ended_at=None)
        .order_by(MachineDowntime.started_at.desc())
        .first()
    )
    if open_dt:
        raise AppError(
            "Machine unit is currently down",
            "MACHINE_DOWN",
            409,
        )


def open_machine_downtime(machine_unit_id, reported_by_id, reason, note=None, started_at=None):
    from app.models.machine import MachineUnit

    unit = MachineUnit.query.get(machine_unit_id)
    if not unit:
        raise AppError("Machine unit not found", "NOT_FOUND", 404)
    if not reason or not str(reason).strip():
        raise AppError("reason is required", "VALIDATION_ERROR", 400)

    existing = MachineDowntime.query.filter_by(
        machine_unit_id=machine_unit_id, ended_at=None
    ).first()
    if existing:
        raise AppError(
            "Machine unit already has an open downtime record",
            "CONFLICT",
            409,
        )

    ts = _parse_timestamp(started_at)
    try:
        row = MachineDowntime(
            machine_unit_id=machine_unit_id,
            started_at=ts,
            reason=str(reason).strip(),
            reported_by_id=reported_by_id,
            note=note,
        )
        db.session.add(row)
        db.session.commit()
        return row
    except Exception:
        db.session.rollback()
        raise


def close_machine_downtime(downtime_id, ended_at=None, note=None):
    row = MachineDowntime.query.get(downtime_id)
    if not row:
        raise AppError("Downtime record not found", "NOT_FOUND", 404)
    if row.ended_at is not None:
        return row
    ts = _parse_timestamp(ended_at)
    extra = str(note).strip() if note else ""
    try:
        row.ended_at = ts
        if extra:
            row.note = f"{row.note}\nClosed: {extra}".strip() if row.note else extra
        db.session.commit()
        return row
    except Exception:
        db.session.rollback()
        raise


_AFFECTED_STATUSES = (
    OperationStatus.PENDING,
    OperationStatus.SCHEDULED,
    OperationStatus.IN_PROGRESS,
    OperationStatus.REWORK,
)


def _serialize_affected_operation(op):
    job = op.job_order
    worker = op.assigned_worker
    year = job.created_at.year if job and job.created_at else datetime.now(timezone.utc).year
    short = (job.id or "")[:4].upper() if job else ""
    return {
        "id": op.id,
        "jobOrderId": op.job_order_id,
        "jobNumber": f"JO-{year}-{short}" if job else None,
        "jobTitle": job.title if job else None,
        "operationName": op.operation_name,
        "status": op.status.value if op.status else None,
        "scheduledStart": op.scheduled_start.isoformat() if op.scheduled_start else None,
        "scheduledEnd": op.scheduled_end.isoformat() if op.scheduled_end else None,
        "assignedWorkerName": worker.full_name if worker else None,
    }


def list_affected_operations(machine_unit_id):
    rows = (
        JobOperation.query.filter(
            JobOperation.machine_unit_id == machine_unit_id,
            JobOperation.status.in_(_AFFECTED_STATUSES),
        )
        .order_by(JobOperation.scheduled_start.asc(), JobOperation.sequence_no.asc())
        .all()
    )
    return [_serialize_affected_operation(op) for op in rows]


def list_machine_unit_statuses():
    from sqlalchemy.orm import joinedload
    from app.models.machine import MachineType, MachineUnit

    units = (
        MachineUnit.query.filter_by(active=True)
        .join(MachineType)
        .order_by(MachineType.name, MachineUnit.label)
        .all()
    )
    open_by = {
        row.machine_unit_id: row
        for row in MachineDowntime.query.filter(MachineDowntime.ended_at.is_(None)).all()
    }
    counts = defaultdict(int)
    unit_ids = [u.id for u in units]
    running_by_unit = {}
    next_by_unit = {}
    if unit_ids:
        for op in JobOperation.query.filter(
            JobOperation.machine_unit_id.in_(unit_ids),
            JobOperation.status.in_(_AFFECTED_STATUSES),
        ):
            counts[op.machine_unit_id] += 1

        board_ops = (
            JobOperation.query.options(
                joinedload(JobOperation.job_order),
                joinedload(JobOperation.assigned_worker),
            )
            .filter(
                JobOperation.machine_unit_id.in_(unit_ids),
                JobOperation.status.in_(
                    (OperationStatus.IN_PROGRESS, OperationStatus.SCHEDULED)
                ),
            )
            .order_by(
                JobOperation.machine_unit_id,
                JobOperation.scheduled_start.asc().nullslast(),
                JobOperation.sequence_no.asc(),
            )
            .all()
        )
        for op in board_ops:
            uid = op.machine_unit_id
            if op.status == OperationStatus.IN_PROGRESS:
                running_by_unit[uid] = op
            elif (
                op.status == OperationStatus.SCHEDULED
                and uid not in next_by_unit
                and uid not in running_by_unit
            ):
                next_by_unit[uid] = op

    out = []
    for unit in units:
        dt = open_by.get(unit.id)
        payload = unit.to_dict()
        payload["down"] = dt is not None
        payload["openDowntime"] = dt.to_dict() if dt else None
        payload["affectedCount"] = int(counts.get(unit.id, 0))
        running = running_by_unit.get(unit.id)
        nxt = next_by_unit.get(unit.id)
        payload["currentOperation"] = (
            _serialize_affected_operation(running) if running else None
        )
        payload["nextOperation"] = _serialize_affected_operation(nxt) if nxt else None
        out.append(payload)
    return out


def open_downtime_intervals_by_unit():
    """Open downtimes block the unit from started_at through a far horizon end."""
    from datetime import timedelta

    far = datetime.now(timezone.utc) + timedelta(days=3650)
    by_unit = {}
    for row in MachineDowntime.query.filter(MachineDowntime.ended_at.is_(None)).all():
        by_unit.setdefault(row.machine_unit_id, []).append(
            (_ensure_utc(row.started_at), far)
        )
    return by_unit
