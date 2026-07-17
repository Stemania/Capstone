from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import get_current_user_id, get_current_user_role, require_roles
from app.models.user import UserRole
from app.services import job_order_service as jo_service

job_orders_bp = Blueprint("job_orders", __name__)


@job_orders_bp.route("", methods=["GET"])
@jwt_required()
def list_job_orders():
    status = request.args.get("status")
    jobs = jo_service.list_job_orders(get_current_user_id(), get_current_user_role(), status)
    return jsonify([j.to_dict() for j in jobs])


@job_orders_bp.route("", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def create_job_order():
    data = request.get_json() or {}
    required = ["clientId", "title", "dueDate", "operations"]
    for field in required:
        if field not in data:
            return jsonify({"error": {"code": "VALIDATION_ERROR", "message": f"{field} is required"}}), 400

    job = jo_service.create_job_order(data, get_current_user_id())
    return jsonify(job.to_dict(include_operations=True)), 201


@job_orders_bp.route("/<job_id>", methods=["GET"])
@jwt_required()
def get_job_order(job_id):
    job = jo_service.get_job_order(job_id, get_current_user_id(), get_current_user_role())
    return jsonify(job.to_dict(include_operations=True))


@job_orders_bp.route("/<job_id>", methods=["PATCH"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def update_job_order(job_id):
    job = jo_service.get_job_order(job_id, get_current_user_id(), get_current_user_role())
    data = request.get_json() or {}
    job = jo_service.update_job_order(job, data)
    return jsonify(job.to_dict(include_operations=True))


@job_orders_bp.route("/<job_id>/reassign", methods=["PATCH"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def reassign_job(job_id):
    job = jo_service.get_job_order(job_id, get_current_user_id(), get_current_user_role())
    data = request.get_json() or {}
    worker_id = data.get("assignedWorkerId")
    if not worker_id:
        return jsonify({"error": {"code": "VALIDATION_ERROR", "message": "assignedWorkerId required"}}), 400

    job = jo_service.reassign_worker(job, worker_id)
    return jsonify(job.to_dict(include_operations=True))


@job_orders_bp.route("/<job_id>/operations", methods=["GET"])
@jwt_required()
def list_operations(job_id):
    job = jo_service.get_job_order(job_id, get_current_user_id(), get_current_user_role())
    return jsonify([op.to_dict() for op in job.operations])
