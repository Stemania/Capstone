from datetime import datetime, timezone

from app.extensions import db
from app.models.operation import JobOperation, OperationStatus
from app.models.user import UserRole
from app.services.job_order_service import (
    advance_part_condition,
    check_job_access,
    derive_job_status,
)
from app.utils.errors import AppError


def _parse_timestamp(value):
    if isinstance(value, str):
        ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return ts
    return value


def list_my_operations(worker_id):
    from sqlalchemy.orm import joinedload
    from app.models.job_order import JobOrder

    return (
        JobOperation.query.options(
            joinedload(JobOperation.job_order).joinedload(JobOrder.client),
            joinedload(JobOperation.machine_type),
            joinedload(JobOperation.assigned_worker),
        )
        .filter(JobOperation.assigned_worker_id == worker_id)
        .order_by(JobOperation.sequence_no.asc())
        .all()
    )


def start_operation(operation, user_id, user_role, timestamp):
    from app.constants.machines import assert_machine_type_available

    check_job_access(operation.job_order, user_id, user_role)

    if user_role == UserRole.PRODUCTION_WORKER.value:
        if operation.assigned_worker_id != user_id:
            raise AppError("You can only start operations assigned to you", "FORBIDDEN", 403)

    if operation.status == OperationStatus.IN_PROGRESS:
        return operation

    if operation.status == OperationStatus.COMPLETED:
        raise AppError(
            "Cannot start a completed operation", "INVALID_TRANSITION", 409
        )

    assert_machine_type_available(
        operation.machine_type_id,
        exclude_operation_id=operation.id,
    )

    try:
        operation.status = OperationStatus.IN_PROGRESS
        operation.actual_start = _parse_timestamp(timestamp)
        operation.job_order.status = derive_job_status(operation.job_order)
        db.session.commit()
        return operation
    except Exception:
        db.session.rollback()
        raise


def complete_operation(operation, user_id, user_role, timestamp):
    check_job_access(operation.job_order, user_id, user_role)

    if user_role == UserRole.PRODUCTION_WORKER.value:
        if operation.assigned_worker_id != user_id:
            raise AppError("You can only complete operations assigned to you", "FORBIDDEN", 403)

    if operation.status == OperationStatus.COMPLETED:
        return operation

    if operation.status in (OperationStatus.PENDING, OperationStatus.SCHEDULED):
        raise AppError(
            "Operation must be started before completing", "INVALID_TRANSITION", 409
        )

    try:
        operation.status = OperationStatus.COMPLETED
        operation.actual_end = _parse_timestamp(timestamp)
        operation.job_order.status = derive_job_status(operation.job_order)
        advance_part_condition(operation.job_order)
        db.session.commit()
        return operation
    except Exception:
        db.session.rollback()
        raise
