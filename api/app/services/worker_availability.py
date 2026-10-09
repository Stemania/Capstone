from datetime import datetime, timezone

from sqlalchemy import and_, or_

from app.models.operation import JobOperation, OperationStatus
from app.utils.errors import AppError


ACTIVE_OP_STATUSES = (
    OperationStatus.PENDING,
    OperationStatus.SCHEDULED,
    OperationStatus.IN_PROGRESS,
    OperationStatus.REWORK,
)


def _parse_dt(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    ts = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts


def _windows_overlap(a_start, a_end, b_start, b_end):
    if not a_start or not a_end or not b_start or not b_end:
        return False
    return a_start < b_end and b_start < a_end


def list_worker_operations(worker_id, exclude_operation_id=None):
    query = JobOperation.query.filter(
        JobOperation.crew_includes(worker_id),
        JobOperation.status.in_(ACTIVE_OP_STATUSES),
    )
    if exclude_operation_id:
        query = query.filter(JobOperation.id != exclude_operation_id)
    return query.all()


def get_busy_workers(start=None, end=None, exclude_operation_id=None, exclude_operation_ids=None):
    """
    Map worker_id -> conflicting JobOperation, for every crew member (lead and
    helpers). With a proposed window: overlap on scheduled_start/end.
    Without a window: workers who currently have an IN_PROGRESS operation.
    """
    start = _parse_dt(start)
    end = _parse_dt(end)
    busy = {}
    excluded = set(exclude_operation_ids or ())
    if exclude_operation_id:
        excluded.add(exclude_operation_id)

    if start and end:
        ops = JobOperation.query.filter(
            JobOperation.assigned_worker_id.isnot(None),
            JobOperation.status.in_(ACTIVE_OP_STATUSES),
            JobOperation.scheduled_start.isnot(None),
            JobOperation.scheduled_end.isnot(None),
        ).all()
        for op in ops:
            if op.id in excluded:
                continue
            if _windows_overlap(start, end, op.scheduled_start, op.scheduled_end):
                for wid in op.crew_ids:
                    busy[wid] = op
        return busy

    ops = JobOperation.query.filter(
        JobOperation.assigned_worker_id.isnot(None),
        JobOperation.status == OperationStatus.IN_PROGRESS,
    ).all()
    for op in ops:
        if op.id in excluded:
            continue
        for wid in op.crew_ids:
            busy[wid] = op
    return busy


def assert_worker_available(
    worker_id,
    start=None,
    end=None,
    exclude_operation_id=None,
    exclude_operation_ids=None,
    crew_ids=None,
):
    """Refuse an assignment whose window overlaps the worker's other work
    (as lead or helper). ``crew_ids`` is the whole crew of the operation being
    assigned, whose shared hours give its working periods.

    Without a window there is nothing to clash with: a worker busy on another
    job right now can still be planned for later work.
    """
    from app.services.schedule_calendar import (
        derive_working_segments,
        load_calendar_exceptions,
        load_crew_schedule_map,
        utc_to_shop,
    )
    from app.services.schedule_service import operation_working_segments

    start = _parse_dt(start)
    end = _parse_dt(end)
    if not start or not end:
        return
    excluded = set(exclude_operation_ids or ())
    if exclude_operation_id:
        excluded.add(exclude_operation_id)
    exceptions = load_calendar_exceptions(utc_to_shop(start).date(), utc_to_shop(end).date())
    mine = derive_working_segments(
        start, end, load_crew_schedule_map(crew_ids or [worker_id]), exceptions
    ) or [(start, end)]
    others = JobOperation.query.filter(
        JobOperation.crew_includes(worker_id),
        JobOperation.status.in_(ACTIVE_OP_STATUSES),
        JobOperation.scheduled_start.isnot(None),
        JobOperation.scheduled_end.isnot(None),
    ).all()
    for op in others:
        if op.id in excluded:
            continue
        theirs = operation_working_segments(op) or [(op.scheduled_start, op.scheduled_end)]
        if any(_windows_overlap(s, e, os, oe) for s, e in mine for os, oe in theirs):
            label = op.operation_name or "another operation"
            from app.extensions import db
            from app.models.user import User

            person = db.session.get(User, worker_id)
            who = person.full_name if person else "Worker"
            raise AppError(
                f"{who} is unavailable — schedule conflicts with '{label}'",
                "CONFLICT",
                409,
            )


def is_worker_available(worker_id, start=None, end=None, exclude_operation_id=None):
    busy = get_busy_workers(
        start=start, end=end, exclude_operation_id=exclude_operation_id
    )
    return worker_id not in busy
