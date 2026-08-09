from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import get_current_user_id, get_current_user_role, require_roles
from app.models.operation import JobOperation
from app.models.user import UserRole
from app.services import job_order_service as jo_service
from app.services import operation_service as op_service
from app.utils.errors import AppError

operations_bp = Blueprint("operations", __name__)


@operations_bp.route("/mine", methods=["GET"])
@jwt_required()
@require_roles(UserRole.PRODUCTION_WORKER)
def my_operations():
    ops = op_service.list_my_operations(get_current_user_id())
    return jsonify([op.to_dict() for op in ops])


@operations_bp.route("/<operation_id>/assign", methods=["PATCH"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def assign_operation(operation_id):
    operation = JobOperation.query.get(operation_id)
    if not operation:
        raise AppError("Operation not found", "NOT_FOUND", 404)
    data = request.get_json() or {}
    worker_id = data.get("assignedWorkerId")
    if not worker_id:
        return jsonify({"error": {"code": "VALIDATION_ERROR", "message": "assignedWorkerId required"}}), 400
    operation = jo_service.assign_operation_worker(operation, worker_id)
    return jsonify(operation.to_dict())


@operations_bp.route("/<operation_id>/start", methods=["POST"])
@jwt_required()
@require_roles(UserRole.PRODUCTION_WORKER)
def start_operation(operation_id):
    operation = JobOperation.query.get(operation_id)
    if not operation:
        raise AppError("Operation not found", "NOT_FOUND", 404)

    data = request.get_json() or {}
    timestamp = data.get("timestamp") or datetime.now(timezone.utc).isoformat()

    operation = op_service.start_operation(
        operation, get_current_user_id(), get_current_user_role(), timestamp
    )
    return jsonify(operation.to_dict())


@operations_bp.route("/<operation_id>/complete", methods=["POST"])
@jwt_required()
@require_roles(UserRole.PRODUCTION_WORKER)
def complete_operation(operation_id):
    operation = JobOperation.query.get(operation_id)
    if not operation:
        raise AppError("Operation not found", "NOT_FOUND", 404)

    data = request.get_json() or {}
    timestamp = data.get("timestamp") or datetime.now(timezone.utc).isoformat()

    operation = op_service.complete_operation(
        operation, get_current_user_id(), get_current_user_role(), timestamp
    )
    return jsonify(operation.to_dict())
