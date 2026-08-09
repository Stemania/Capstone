from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import require_roles
from app.models.user import User, UserRole
from app.services.worker_availability import get_busy_workers, is_worker_available
from app.services.worker_suggestion_service import suggest_workers

workers_bp = Blueprint("workers", __name__)


@workers_bp.route("", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def list_workers():
    exclude_operation_id = request.args.get("excludeOperationId")
    scheduled_start = request.args.get("scheduledStart")
    scheduled_end = request.args.get("scheduledEnd")
    busy = get_busy_workers(
        start=scheduled_start,
        end=scheduled_end,
        exclude_operation_id=exclude_operation_id,
    )
    workers = (
        User.query.filter_by(role=UserRole.PRODUCTION_WORKER, active=True)
        .order_by(User.full_name)
        .all()
    )
    result = []
    for w in workers:
        data = w.to_dict(include_profile=True)
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
    if not operations:
        # allow single operationName
        if data.get("operationName"):
            operations = [data["operationName"]]
        else:
            return jsonify({"error": {"code": "VALIDATION_ERROR", "message": "operations required"}}), 400

    suggestions = suggest_workers(
        operations,
        exclude_job_id=data.get("excludeJobId"),
        scheduled_start=data.get("scheduledStart"),
        scheduled_end=data.get("scheduledEnd"),
        exclude_operation_id=data.get("excludeOperationId"),
    )
    return jsonify({"suggestions": suggestions})
