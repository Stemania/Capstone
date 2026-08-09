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
        JobOperation.assigned_worker_id == worker_id,
        JobOperation.status.in_(ACTIVE_OP_STATUSES),
    )
    if exclude_operation_id:
        query = query.filter(JobOperation.id != exclude_operation_id)
    return query.all()


def get_busy_workers(start=None, end=None, exclude_operation_id=None):
    """
    Map worker_id -> conflicting JobOperation.
    With a proposed window: overlap on scheduled_start/end.
    Without a window: workers who currently have an IN_PROGRESS operation.
    """
    start = _parse_dt(start)
    end = _parse_dt(end)
    busy = {}

    if start and end:
        ops = JobOperation.query.filter(
            JobOperation.assigned_worker_id.isnot(None),
            JobOperation.status.in_(ACTIVE_OP_STATUSES),
            JobOperation.scheduled_start.isnot(None),
            JobOperation.scheduled_end.isnot(None),
        ).all()
        for op in ops:
            if exclude_operation_id and op.id == exclude_operation_id:
                continue
            if _windows_overlap(start, end, op.scheduled_start, op.scheduled_end):
                busy[op.assigned_worker_id] = op
        return busy

    ops = JobOperation.query.filter(
        JobOperation.assigned_worker_id.isnot(None),
        JobOperation.status == OperationStatus.IN_PROGRESS,
    ).all()
    for op in ops:
        if exclude_operation_id and op.id == exclude_operation_id:
            continue
        busy[op.assigned_worker_id] = op
    return busy


def assert_worker_available(
    worker_id,
    start=None,
    end=None,
    exclude_operation_id=None,
):
    busy = get_busy_workers(
        start=start, end=end, exclude_operation_id=exclude_operation_id
    )
    conflict = busy.get(worker_id)
    if conflict:
        label = conflict.operation_name or "another operation"
        raise AppError(
            f"Worker is unavailable — schedule conflicts with '{label}'",
            "CONFLICT",
            409,
        )


def is_worker_available(worker_id, start=None, end=None, exclude_operation_id=None):
    busy = get_busy_workers(
        start=start, end=end, exclude_operation_id=exclude_operation_id
    )
    return worker_id not in busy
