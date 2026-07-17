from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import require_roles
from app.models.user import User, UserRole
from app.services.worker_suggestion_service import suggest_workers

workers_bp = Blueprint("workers", __name__)


@workers_bp.route("", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def list_workers():
    workers = (
        User.query.filter_by(role=UserRole.PRODUCTION_WORKER, active=True)
        .order_by(User.full_name)
        .all()
    )
    return jsonify([w.to_dict(include_profile=True) for w in workers])


@workers_bp.route("/suggest", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def suggest():
    data = request.get_json() or {}
    operations = data.get("operations", [])
    if not operations:
        return jsonify({"error": {"code": "VALIDATION_ERROR", "message": "operations required"}}), 400

    suggestions = suggest_workers(operations)
    return jsonify({"suggestions": suggestions})
