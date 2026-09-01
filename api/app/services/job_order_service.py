from datetime import datetime
from decimal import Decimal, InvalidOperation

from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models.job_order import (
    JobOrder,
    JobOrderStatus,
    JobPriority,
    JobType,
    PartCondition,
    PRODUCTION_STATUSES,
    PRODUCTION_VISIBLE_STATUSES,
)
from app.models.machine import MachineType
from app.models.operation import JobOperation, OperationStatus
from app.models.user import User, UserRole
from app.utils.errors import AppError


def _parse_date(value):
    if value is None or value == "":
        return None
    if isinstance(value, str):
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    return value


def _parse_datetime(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _parse_decimal(value, field_name):
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise AppError(f"Invalid {field_name}", "VALIDATION_ERROR", 400)


def _normalize_raw_materials(items):
    if items is None:
        return []
    if not isinstance(items, list):
        raise AppError("rawMaterials must be a list", "VALIDATION_ERROR", 400)
    normalized = []
    for item in items:
        if isinstance(item, str):
            name = item.strip()
            if name:
                normalized.append({"name": name})
            continue
        if not isinstance(item, dict):
            raise AppError("Each raw material must be an object", "VALIDATION_ERROR", 400)
        name = (item.get("name") or "").strip()
        if not name:
            continue
        entry = {"name": name}
        if item.get("quantity") not in (None, ""):
            entry["quantity"] = float(_parse_decimal(item["quantity"], "raw material quantity"))
        if item.get("unit"):
            entry["unit"] = str(item["unit"]).strip()
        normalized.append(entry)
    return normalized


def _resolve_machine_type_id(op_data):
    mid = op_data.get("machineTypeId")
    if mid:
        mt = MachineType.query.get(mid)
        if not mt:
            raise AppError("Invalid machineTypeId", "VALIDATION_ERROR", 400)
        return mt.id
    # Legacy: machinesNeeded: ["MILLING"]
    codes = op_data.get("machinesNeeded") or []
    if codes:
        code = str(codes[0]).strip().upper()
        mt = MachineType.query.filter_by(code=code).first()
        if not mt:
            raise AppError(f"Unknown machine type '{code}'", "VALIDATION_ERROR", 400)
        return mt.id
    return None


def _validate_worker(worker_id, start=None, end=None, exclude_operation_id=None):
    worker = User.query.get(worker_id)
    if not worker or worker.role != UserRole.PRODUCTION_WORKER or not worker.active:
        raise AppError("Invalid worker assignment", "VALIDATION_ERROR", 400)
    from app.services.worker_availability import assert_worker_available

    assert_worker_available(
        worker_id,
        start=start,
        end=end,
        exclude_operation_id=exclude_operation_id,
    )
    return worker


def derive_job_status(job: JobOrder) -> JobOrderStatus:
    if job.status == JobOrderStatus.DELIVERED or job.delivered_at:
        return JobOrderStatus.DELIVERED
    # Draft is sticky until release — stage is derived from data, not stored.
    if job.status == JobOrderStatus.DRAFT:
        return JobOrderStatus.DRAFT

    ops = list(job.operations or [])
    if not ops:
        return JobOrderStatus.SCHEDULED
    if all(op.status == OperationStatus.COMPLETED for op in ops):
        return JobOrderStatus.COMPLETED
    if any(
        op.status in (OperationStatus.IN_PROGRESS, OperationStatus.COMPLETED, OperationStatus.REWORK)
        for op in ops
    ):
        return JobOrderStatus.IN_PROGRESS
    return JobOrderStatus.SCHEDULED


def _initial_part_condition(job_type: JobType) -> PartCondition:
    if job_type in (JobType.MODIFICATION, JobType.REPAIR):
        return PartCondition.CLIENT_SUPPLIED_ITEM
    return PartCondition.RAW_MATERIAL


# Furthest stage wins; never move backwards.
_PART_CONDITION_RANK = {
    PartCondition.RAW_MATERIAL: 0,
    PartCondition.CLIENT_SUPPLIED_ITEM: 0,
    PartCondition.BLANK: 1,
    PartCondition.WORK_IN_PROCESS: 2,
    PartCondition.MACHINED: 3,
    PartCondition.HEAT_TREATED: 4,
    PartCondition.FINISHED: 5,
}

_MACHINING_OP_CODES = frozenset(
    {
        "TURNING",
        "FACING",
        "THREADING",
        "TEETH_CUTTING",
        "SLOTTING",
        "GROOVING",
        "DRILLING",
        "KEYWAY",
        "SPLINE",
        "SURFACE_GRINDING",
    }
)


def _part_condition_from_op_code(code: str | None) -> PartCondition | None:
    if not code:
        return None
    if code == "BLANKING":
        return PartCondition.BLANK
    if code == "HEAT_TREATMENT":
        return PartCondition.HEAT_TREATED
    if code in _MACHINING_OP_CODES:
        return PartCondition.MACHINED
    return None


def _rank(condition: PartCondition | None) -> int:
    if condition is None:
        return 0
    return _PART_CONDITION_RANK.get(condition, 0)


def advance_part_condition(job: JobOrder):
    """Advance part stage from completed operation types; never move backwards."""
    ops = list(job.operations or [])
    if not ops:
        return

    current = job.part_condition or PartCondition.RAW_MATERIAL
    best = current

    for op in ops:
        if op.status != OperationStatus.COMPLETED:
            continue
        code = op.operation_type.code if op.operation_type else None
        stage = _part_condition_from_op_code(code)
        if stage is not None and _rank(stage) > _rank(best):
            best = stage

    if ops and all(op.status == OperationStatus.COMPLETED for op in ops):
        best = PartCondition.FINISHED

    if _rank(best) > _rank(current):
        job.part_condition = best


def check_job_access(job_order, user_id, user_role):
    if user_role in (UserRole.ADMIN.value, UserRole.OFFICE_STAFF.value):
        return True
    if user_role == UserRole.PRODUCTION_WORKER.value:
        if job_order.status == JobOrderStatus.DRAFT:
            raise AppError("Access denied", "FORBIDDEN", 403)
        has_op = any(op.assigned_worker_id == user_id for op in (job_order.operations or []))
        if not has_op:
            raise AppError("Access denied", "FORBIDDEN", 403)
        return True
    raise AppError("Access denied", "FORBIDDEN", 403)


def list_job_orders(user_id, user_role, status=None, scope=None):
    query = JobOrder.query.options(
        joinedload(JobOrder.operations).joinedload(JobOperation.assigned_worker),
        joinedload(JobOrder.operations).joinedload(JobOperation.machine_type),
        joinedload(JobOrder.client),
        joinedload(JobOrder.created_by),
    )
    if user_role == UserRole.PRODUCTION_WORKER.value:
        query = query.filter(
            JobOrder.status.in_(tuple(PRODUCTION_VISIBLE_STATUSES)),
            JobOrder.operations.any(JobOperation.assigned_worker_id == user_id),
        )
    elif scope == "drafts":
        query = query.filter_by(status=JobOrderStatus.DRAFT)
    elif scope != "all":
        query = query.filter(JobOrder.status.in_(tuple(PRODUCTION_STATUSES)))
    if status:
        query = query.filter_by(status=JobOrderStatus(status))
    return query.order_by(JobOrder.due_date.asc()).all()


def get_job_order(job_id, user_id, user_role):
    job = JobOrder.query.options(
        joinedload(JobOrder.operations).joinedload(JobOperation.assigned_worker),
        joinedload(JobOrder.operations).joinedload(JobOperation.machine_type),
        joinedload(JobOrder.operations).joinedload(JobOperation.operation_type),
        joinedload(JobOrder.operations).joinedload(JobOperation.time_logs),
        joinedload(JobOrder.client),
    ).get(job_id)
    if not job:
        raise AppError("Job order not found", "NOT_FOUND", 404)
    check_job_access(job, user_id, user_role)
    return job


def _build_operation(job_id, op_data, seq_fallback):
    from app.models.worker_skill import OperationType

    op_type_id = op_data.get("operationTypeId")
    op_type = OperationType.query.get(op_type_id) if op_type_id else None
    name = (op_data.get("operationName") or op_data.get("name") or "").strip()
    if not name and op_type:
        name = op_type.name
    if not name:
        raise AppError("Each operation requires a name", "VALIDATION_ERROR", 400)
    seq = op_data.get("sequenceNo", op_data.get("seq", seq_fallback))
    worker_id = op_data.get("assignedWorkerId")
    start = op_data.get("scheduledStart")
    end = op_data.get("scheduledEnd")
    exclude_id = op_data.get("id")
    if worker_id:
        _validate_worker(
            worker_id,
            start=start,
            end=end,
            exclude_operation_id=exclude_id,
        )
    status_raw = op_data.get("status", "PENDING")
    try:
        status = OperationStatus(status_raw)
    except ValueError:
        status = OperationStatus.PENDING

    machine_type_id = _resolve_machine_type_id(op_data)
    if not machine_type_id and op_type and op_type.default_machine_type_id:
        machine_type_id = op_type.default_machine_type_id

    kwargs = {
        "job_order_id": job_id,
        "sequence_no": int(seq),
        "operation_name": name,
        "operation_type_id": op_type.id if op_type else op_type_id,
        "machine_type_id": machine_type_id,
        "machine_unit_id": op_data.get("machineUnitId"),
        "assigned_worker_id": worker_id,
        "estimated_hours": _parse_decimal(op_data.get("estimatedHours"), "estimatedHours"),
        "scheduled_start": _parse_datetime(start),
        "scheduled_end": _parse_datetime(end),
        "status": status,
        "rework_of_operation_id": op_data.get("reworkOfOperationId"),
        "notes": op_data.get("notes"),
    }
    return JobOperation(**kwargs)


def create_job_order(data, created_by_id):
    """Office creates a DRAFT from the client PO. Operations are optional; no notify."""
    priority = data.get("priority", "MODERATE")
    try:
        priority_enum = JobPriority(priority)
    except ValueError:
        raise AppError("priority must be HIGH, MODERATE, or LOW", "VALIDATION_ERROR", 400)

    try:
        job_type = JobType(data.get("jobType", "FABRICATION"))
    except ValueError:
        raise AppError("Invalid jobType", "VALIDATION_ERROR", 400)

    try:
        job = JobOrder(
            client_id=data["clientId"],
            title=data["title"],
            description=data.get("description"),
            due_date=_parse_date(data["dueDate"]),
            client_po_number=(data.get("clientPoNumber") or None),
            po_date=_parse_date(data.get("poDate")),
            status=JobOrderStatus.DRAFT,
            priority=priority_enum,
            job_type=job_type,
            part_condition=_initial_part_condition(job_type),
            quantity=_parse_decimal(data.get("quantity"), "quantity"),
            unit_of_measure=(data.get("unitOfMeasure") or None),
            amount=_parse_decimal(data.get("amount"), "amount"),
            raw_materials=_normalize_raw_materials(data.get("rawMaterials")),
            created_by_id=created_by_id,
        )
        db.session.add(job)
        db.session.flush()

        # Optional ops on create (admin tooling); still stays DRAFT — no JOB_RECEIVED.
        for i, op_data in enumerate(data.get("operations") or [], start=1):
            op = _build_operation(job.id, op_data, i)
            db.session.add(op)

        db.session.commit()
        return get_job_order(job.id, created_by_id, UserRole.OFFICE_STAFF.value)
    except AppError:
        db.session.rollback()
        raise
    except Exception:
        db.session.rollback()
        raise


def mark_job_delivered(job):
    """Office marks the job delivered / ready for pickup. Fires JOB_DELIVERED."""
    from app.models.notification import NotificationMilestone
    from app.services.notification_service import safe_notify_job_milestone

    if job.status == JobOrderStatus.DELIVERED or job.delivered_at:
        return job

    ops = list(job.operations or [])
    if not ops or not all(op.status == OperationStatus.COMPLETED for op in ops):
        raise AppError(
            "All operations must be complete before delivery",
            "INVALID_TRANSITION",
            409,
        )

    try:
        from datetime import datetime, timezone

        job.status = JobOrderStatus.DELIVERED
        job.delivered_at = datetime.now(timezone.utc)
        db.session.commit()
        safe_notify_job_milestone(job.id, NotificationMilestone.JOB_DELIVERED)
        return job
    except AppError:
        db.session.rollback()
        raise
    except Exception:
        db.session.rollback()
        raise


def update_job_order(job, data, actor_role=None):
    """Update job fields and/or operations.

    Office may edit job information while DRAFT.
    Admin may edit operations while DRAFT.
    After release (SCHEDULED+), either role may update as before; status is re-derived.
    """
    try:
        is_draft = job.status == JobOrderStatus.DRAFT
        role = actor_role

        if is_draft and role == UserRole.OFFICE_STAFF.value and "operations" in data:
            raise AppError(
                "Office staff cannot edit operations during planning",
                "FORBIDDEN",
                403,
            )
        if is_draft and role == UserRole.ADMIN.value:
            # Admin planning screen — job info is read-only there; allow ops only.
            # Still allow incidental field patches if sent, for API flexibility,
            # but office-only restriction above is the hard gate.
            pass

        if "clientId" in data:
            job.client_id = data["clientId"]
        if "title" in data:
            job.title = data["title"]
        if "description" in data:
            job.description = data["description"]
        if "dueDate" in data:
            job.due_date = _parse_date(data["dueDate"])
        if "clientPoNumber" in data:
            job.client_po_number = data.get("clientPoNumber") or None
        if "poDate" in data:
            job.po_date = _parse_date(data.get("poDate"))
        if "priority" in data:
            try:
                job.priority = JobPriority(data["priority"])
            except ValueError:
                raise AppError("priority must be HIGH, MODERATE, or LOW", "VALIDATION_ERROR", 400)
        if "jobType" in data:
            try:
                job.job_type = JobType(data["jobType"])
            except ValueError:
                raise AppError("Invalid jobType", "VALIDATION_ERROR", 400)
            # Only reset initial stage when no ops have advanced the piece yet.
            if not any(
                op.status == OperationStatus.COMPLETED for op in (job.operations or [])
            ):
                job.part_condition = _initial_part_condition(job.job_type)
        if "partCondition" in data and data["partCondition"]:
            try:
                job.part_condition = PartCondition(data["partCondition"])
            except ValueError:
                raise AppError("Invalid partCondition", "VALIDATION_ERROR", 400)
        if "quantity" in data:
            job.quantity = _parse_decimal(data.get("quantity"), "quantity")
        if "unitOfMeasure" in data:
            job.unit_of_measure = data.get("unitOfMeasure") or None
        if "amount" in data:
            job.amount = _parse_decimal(data.get("amount"), "amount")
        if "rawMaterials" in data:
            job.raw_materials = _normalize_raw_materials(data.get("rawMaterials"))

        if "operations" in data:
            JobOperation.query.filter_by(job_order_id=job.id).delete()
            for i, op_data in enumerate(data["operations"], start=1):
                payload = dict(op_data)
                payload.pop("id", None)
                op = _build_operation(job.id, payload, i)
                db.session.add(op)
            db.session.flush()

        if job.status != JobOrderStatus.DRAFT:
            job.status = derive_job_status(job)
        advance_part_condition(job)
        db.session.commit()
        return get_job_order(job.id, job.created_by_id, UserRole.OFFICE_STAFF.value)
    except AppError:
        db.session.rollback()
        raise
    except Exception:
        db.session.rollback()
        raise


def _release_missing_items(job: JobOrder) -> list[str]:
    ops = sorted(list(job.operations or []), key=lambda o: o.sequence_no or 0)
    if not ops:
        return ["Add at least one operation before releasing."]
    missing = []
    for op in ops:
        label = op.operation_name or f"Operation {op.sequence_no}"
        seq = op.sequence_no
        if not op.assigned_worker_id:
            missing.append(f"#{seq} {label}: assign a worker")
        if op.estimated_hours is None:
            missing.append(f"#{seq} {label}: set target hours")
    return missing


def release_job_order(job):
    """Admin releases a DRAFT job to production. Fires JOB_RECEIVED."""
    from app.models.notification import NotificationMilestone
    from app.services.notification_service import safe_notify_job_milestone

    if job.status != JobOrderStatus.DRAFT:
        raise AppError(
            "Only draft jobs can be released",
            "INVALID_TRANSITION",
            409,
        )

    missing = _release_missing_items(job)
    if missing:
        raise AppError(
            "Cannot release yet — " + "; ".join(missing),
            "VALIDATION_ERROR",
            400,
        )

    try:
        job.status = JobOrderStatus.SCHEDULED
        job.status = derive_job_status(job)
        db.session.commit()
        safe_notify_job_milestone(job.id, NotificationMilestone.JOB_RECEIVED)
        return get_job_order(job.id, job.created_by_id, UserRole.ADMIN.value)
    except AppError:
        db.session.rollback()
        raise
    except Exception:
        db.session.rollback()
        raise


def assign_operation_worker(operation, worker_id):
    _validate_worker(
        worker_id,
        start=operation.scheduled_start,
        end=operation.scheduled_end,
        exclude_operation_id=operation.id,
    )
    try:
        operation.assigned_worker_id = worker_id
        if operation.status == OperationStatus.PENDING:
            operation.status = OperationStatus.SCHEDULED
        operation.job_order.status = derive_job_status(operation.job_order)
        db.session.commit()
        return operation
    except Exception:
        db.session.rollback()
        raise
