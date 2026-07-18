from datetime import datetime
from decimal import Decimal, InvalidOperation

from app.extensions import db
from app.models.job_order import JobOrder, JobOrderStatus, JobPriority
from app.models.operation import Operation, OperationStatus
from app.models.user import User, UserRole
from app.constants.machines import VALID_MACHINE_CODES
from app.utils.errors import AppError


def _parse_date(value):
    if isinstance(value, str):
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    return value


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


def _normalize_machines(codes):
    if codes is None:
        return []
    if not isinstance(codes, list):
        raise AppError("machinesNeeded must be a list", "VALIDATION_ERROR", 400)
    cleaned = []
    for code in codes:
        code = str(code).strip().upper()
        if code not in VALID_MACHINE_CODES:
            raise AppError(
                f"Invalid machine '{code}'. Allowed: {', '.join(sorted(VALID_MACHINE_CODES))}",
                "VALIDATION_ERROR",
                400,
            )
        if code not in cleaned:
            cleaned.append(code)
    return cleaned


def _validate_worker(worker_id):
    worker = User.query.get(worker_id)
    if not worker or worker.role != UserRole.PRODUCTION_WORKER or not worker.active:
        raise AppError("Invalid worker assignment", "VALIDATION_ERROR", 400)
    return worker


def check_job_access(job_order, user_id, user_role):
    if user_role in (UserRole.ADMIN.value, UserRole.OFFICE_STAFF.value):
        return True
    if user_role == UserRole.PRODUCTION_WORKER.value:
        if job_order.assigned_worker_id != user_id:
            raise AppError("Access denied", "FORBIDDEN", 403)
        return True
    raise AppError("Access denied", "FORBIDDEN", 403)


def list_job_orders(user_id, user_role, status=None):
    from sqlalchemy.orm import joinedload

    query = JobOrder.query.options(joinedload(JobOrder.operations), joinedload(JobOrder.client))
    if user_role == UserRole.PRODUCTION_WORKER.value:
        query = query.filter_by(assigned_worker_id=user_id)
    if status:
        query = query.filter_by(status=JobOrderStatus(status))
    return query.order_by(JobOrder.due_date.asc()).all()


def get_job_order(job_id, user_id, user_role):
    job = JobOrder.query.get(job_id)
    if not job:
        raise AppError("Job order not found", "NOT_FOUND", 404)
    check_job_access(job, user_id, user_role)
    return job


def create_job_order(data, created_by_id):
    if not data.get("operations"):
        raise AppError("At least one operation is required", "VALIDATION_ERROR", 400)

    worker_id = data.get("assignedWorkerId")
    if worker_id:
        _validate_worker(worker_id)

    priority = data.get("priority", "MODERATE")
    try:
        priority_enum = JobPriority(priority)
    except ValueError:
        raise AppError("priority must be HIGH, MODERATE, or LOW", "VALIDATION_ERROR", 400)

    try:
        job = JobOrder(
            client_id=data["clientId"],
            title=data["title"],
            description=data.get("description"),
            due_date=_parse_date(data["dueDate"]),
            status=JobOrderStatus.ASSIGNED if worker_id else JobOrderStatus.UNASSIGNED,
            priority=priority_enum,
            quantity=_parse_decimal(data.get("quantity"), "quantity"),
            unit_of_measure=(data.get("unitOfMeasure") or None),
            amount=_parse_decimal(data.get("amount"), "amount"),
            raw_materials=_normalize_raw_materials(data.get("rawMaterials")),
            assigned_worker_id=worker_id,
            created_by_id=created_by_id,
        )
        db.session.add(job)
        db.session.flush()

        for op_data in data["operations"]:
            operation = Operation(
                job_order_id=job.id,
                seq=op_data["seq"],
                name=op_data["name"],
                machines_needed=_normalize_machines(op_data.get("machinesNeeded")),
                status=OperationStatus.PENDING,
            )
            db.session.add(operation)

        db.session.commit()
        return job
    except AppError:
        db.session.rollback()
        raise
    except Exception:
        db.session.rollback()
        raise


def update_job_order(job, data):
    try:
        if "clientId" in data:
            job.client_id = data["clientId"]
        if "title" in data:
            job.title = data["title"]
        if "description" in data:
            job.description = data["description"]
        if "dueDate" in data:
            job.due_date = _parse_date(data["dueDate"])
        if "priority" in data:
            try:
                job.priority = JobPriority(data["priority"])
            except ValueError:
                raise AppError("priority must be HIGH, MODERATE, or LOW", "VALIDATION_ERROR", 400)
        if "quantity" in data:
            job.quantity = _parse_decimal(data.get("quantity"), "quantity")
        if "unitOfMeasure" in data:
            job.unit_of_measure = data.get("unitOfMeasure") or None
        if "amount" in data:
            job.amount = _parse_decimal(data.get("amount"), "amount")
        if "rawMaterials" in data:
            job.raw_materials = _normalize_raw_materials(data.get("rawMaterials"))
        if "assignedWorkerId" in data and data["assignedWorkerId"]:
            _validate_worker(data["assignedWorkerId"])
            job.assigned_worker_id = data["assignedWorkerId"]
            if job.status == JobOrderStatus.UNASSIGNED:
                job.status = JobOrderStatus.ASSIGNED

        if "operations" in data:
            Operation.query.filter_by(job_order_id=job.id).delete()
            for op_data in data["operations"]:
                operation = Operation(
                    job_order_id=job.id,
                    seq=op_data["seq"],
                    name=op_data["name"],
                    machines_needed=_normalize_machines(op_data.get("machinesNeeded")),
                    status=OperationStatus(op_data.get("status", "PENDING")),
                )
                db.session.add(operation)

        db.session.commit()
        return job
    except AppError:
        db.session.rollback()
        raise
    except Exception:
        db.session.rollback()
        raise


def reassign_worker(job, worker_id):
    _validate_worker(worker_id)
    try:
        job.assigned_worker_id = worker_id
        if job.status == JobOrderStatus.UNASSIGNED:
            job.status = JobOrderStatus.ASSIGNED
        db.session.commit()
        return job
    except Exception:
        db.session.rollback()
        raise
