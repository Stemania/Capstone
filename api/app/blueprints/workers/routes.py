from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import require_roles
from app.models.user import User, UserRole
from app.models.worker_skill import WorkerSkill
from app.services.worker_availability import get_busy_workers
from app.services.worker_profile_service import (
    is_checking_operation,
    operation_skill_holders,
    query_assignable_workers,
)
from app.services.worker_suggestion_service import suggest_workers

workers_bp = Blueprint("workers", __name__)


@workers_bp.route("", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def list_workers():
    exclude_operation_id = request.args.get("excludeOperationId")
    scheduled_start = request.args.get("scheduledStart")
    scheduled_end = request.args.get("scheduledEnd")
    machine_type_id = request.args.get("machineTypeId")
    operation_type_id = request.args.get("operationTypeId")
    operation_name = request.args.get("operationName")
    for_checking = str(request.args.get("forChecking") or "").lower() in (
        "1",
        "true",
        "yes",
    )
    busy = get_busy_workers(
        start=scheduled_start,
        end=scheduled_end,
        exclude_operation_id=exclude_operation_id,
    )
    # Admin is Checking-only: never list them for machine ops; for no-machine
    # ops only when the caller is loading Checking.
    include_admin = (not machine_type_id) and (
        for_checking or is_checking_operation(operation_type_id, operation_name)
    )
    query = query_assignable_workers(include_admin=include_admin)
    if machine_type_id:
        query = query.join(WorkerSkill, WorkerSkill.worker_id == User.id).filter(
            WorkerSkill.machine_type_id == machine_type_id
        )
    else:
        _ot, holders = operation_skill_holders(
            operation_type_id=operation_type_id, operation_name=operation_name
        )
        if holders is not None:
            query = query.filter(User.id.in_(list(holders)))
    workers = query.all()
    result = []
    for w in workers:
        data = w.to_dict(include_profile=True, include_skills=True)
        conflict = busy.get(w.id)
        data["available"] = conflict is None
        if conflict:
            data["activeJobId"] = conflict.job_order_id
            data["activeJobTitle"] = conflict.operation_name
            data["conflictOperationId"] = conflict.id
        result.append(data)
    return jsonify(result)


@workers_bp.route("/suggest", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def suggest():
    data = request.get_json() or {}
    operations = data.get("operations", [])
    machine_type_id = data.get("machineTypeId")
    operation_type_id = data.get("operationTypeId")
    operation_name = data.get("operationName")

    if not operations and not machine_type_id and not operation_type_id and not operation_name:
        return jsonify(
            {"error": {"code": "VALIDATION_ERROR", "message": "operations or machineTypeId required"}}
        ), 400

    result = suggest_workers(
        operations,
        exclude_job_id=data.get("excludeJobId"),
        scheduled_start=data.get("scheduledStart"),
        scheduled_end=data.get("scheduledEnd"),
        exclude_operation_id=data.get("excludeOperationId"),
        machine_type_id=machine_type_id,
        operation_type_id=operation_type_id,
        operation_name=operation_name,
    )
    return jsonify(result)
