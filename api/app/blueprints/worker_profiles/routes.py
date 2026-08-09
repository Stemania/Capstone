from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import require_roles
from app.models.user import UserRole
from app.services import worker_profile_service as wp_service
from app.services.auth_service import get_user_by_id

worker_profiles_bp = Blueprint("worker_profiles", __name__)


@worker_profiles_bp.route("/<worker_id>/skills", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def get_skills(worker_id):
    skills = wp_service.list_worker_skills(worker_id)
    return jsonify([s.to_dict() for s in skills])


@worker_profiles_bp.route("/<worker_id>/skills", methods=["PUT"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def put_skills(worker_id):
    data = request.get_json() or {}
    skills = data.get("skills", data if isinstance(data, list) else [])
    rows = wp_service.replace_worker_skills(worker_id, skills)
    return jsonify([s.to_dict() for s in rows])


@worker_profiles_bp.route("/<worker_id>/schedule", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def get_schedule(worker_id):
    rows = wp_service.list_worker_schedules(worker_id)
    return jsonify([s.to_dict() for s in rows])


@worker_profiles_bp.route("/<worker_id>/schedule", methods=["PUT"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def put_schedule(worker_id):
    data = request.get_json() or {}
    schedule = data.get("schedule", data if isinstance(data, list) else [])
    rows = wp_service.replace_worker_schedules(worker_id, schedule)
    return jsonify([s.to_dict() for s in rows])


@worker_profiles_bp.route("/<worker_id>", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def get_worker_detail(worker_id):
    user = get_user_by_id(worker_id)
    return jsonify(
        user.to_dict(include_profile=True, include_skills=True, include_schedule=True)
    )


calendar_bp = Blueprint("calendar", __name__)


@calendar_bp.route("/exceptions", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def list_exceptions():
    rows = wp_service.list_calendar_exceptions()
    return jsonify([r.to_dict() for r in rows])


@calendar_bp.route("/exceptions", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def create_exception():
    data = request.get_json() or {}
    row = wp_service.create_calendar_exception(data)
    return jsonify(row.to_dict()), 201


@calendar_bp.route("/exceptions/<exc_id>", methods=["DELETE"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def delete_exception(exc_id):
    wp_service.delete_calendar_exception(exc_id)
    return jsonify({"message": "Deleted"})


operation_types_bp = Blueprint("operation_types", __name__)


@operation_types_bp.route("", methods=["GET"])
@jwt_required()
def list_operation_types():
    active_only = request.args.get("active", "true").lower() != "false"
    rows = wp_service.list_operation_types(active_only=active_only)
    return jsonify([r.to_dict() for r in rows])
