from datetime import datetime, timezone

from app.extensions import db
from app.models.job_order import JobOrderStatus
from app.models.operation import OperationStatus
from app.services.job_order_service import check_job_access
from app.utils.errors import AppError


def _parse_timestamp(value):
    if isinstance(value, str):
        ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return ts
    return value


def _update_job_status(job):
    ops = job.operations
    if not ops:
        return

    any_in_progress = any(op.status == OperationStatus.IN_PROGRESS for op in ops)
    all_completed = all(op.status == OperationStatus.COMPLETED for op in ops)
    any_started = any(
        op.status in (OperationStatus.IN_PROGRESS, OperationStatus.COMPLETED) for op in ops
    )

    if all_completed:
        job.status = JobOrderStatus.COMPLETED
    elif any_in_progress or any_started:
        job.status = JobOrderStatus.IN_PROGRESS


def start_operation(operation, user_id, user_role, timestamp):
    from app.constants.machines import assert_machines_available

    check_job_access(operation.job_order, user_id, user_role)

    if operation.status == OperationStatus.IN_PROGRESS:
        return operation

    if operation.status == OperationStatus.COMPLETED:
        raise AppError(
            "Cannot start a completed operation", "INVALID_TRANSITION", 409
        )

    # Machines become "in use" when an operation starts
    assert_machines_available(
        operation.machines_needed or [],
        exclude_operation_id=operation.id,
    )

    try:
        operation.status = OperationStatus.IN_PROGRESS
        operation.started_at = _parse_timestamp(timestamp)
        _update_job_status(operation.job_order)
        db.session.commit()
        return operation
    except Exception:
        db.session.rollback()
        raise


def complete_operation(operation, user_id, user_role, timestamp):
    check_job_access(operation.job_order, user_id, user_role)

    if operation.status == OperationStatus.COMPLETED:
        return operation

    if operation.status == OperationStatus.PENDING:
        raise AppError(
            "Operation must be started before completing", "INVALID_TRANSITION", 409
        )

    try:
        operation.status = OperationStatus.COMPLETED
        operation.completed_at = _parse_timestamp(timestamp)
        _update_job_status(operation.job_order)
        db.session.commit()
        return operation
    except Exception:
        db.session.rollback()
        raise
