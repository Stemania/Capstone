from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import require_roles
from app.models.user import User, UserRole
from app.services.worker_availability import get_busy_workers
from app.services.worker_suggestion_service import suggest_workers

workers_bp = Blueprint("workers", __name__)


@workers_bp.route("", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def list_workers():
    exclude_job_id = request.args.get("excludeJobId")
    busy = get_busy_workers(exclude_job_id=exclude_job_id)
    workers = (
        User.query.filter_by(role=UserRole.PRODUCTION_WORKER, active=True)
        .order_by(User.full_name)
        .all()
    )
    result = []
    for w in workers:
        data = w.to_dict(include_profile=True)
        job = busy.get(w.id)
        data["available"] = job is None
        if job:
            data["activeJobId"] = job.id
            data["activeJobTitle"] = job.title
        result.append(data)
    return jsonify(result)


@workers_bp.route("/suggest", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def suggest():
    data = request.get_json() or {}
    operations = data.get("operations", [])
    if not operations:
        return jsonify({"error": {"code": "VALIDATION_ERROR", "message": "operations required"}}), 400

    suggestions = suggest_workers(
        operations, exclude_job_id=data.get("excludeJobId")
    )
    return jsonify({"suggestions": suggestions})
