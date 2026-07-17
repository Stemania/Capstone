from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import get_current_user_id, get_current_user_role, require_roles
from app.models.operation import Operation
from app.models.user import UserRole
from app.services import operation_service as op_service
from app.utils.errors import AppError

operations_bp = Blueprint("operations", __name__)


@operations_bp.route("/<operation_id>/start", methods=["POST"])
@jwt_required()
@require_roles(UserRole.PRODUCTION_WORKER)
def start_operation(operation_id):
    operation = Operation.query.get(operation_id)
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
    operation = Operation.query.get(operation_id)
    if not operation:
        raise AppError("Operation not found", "NOT_FOUND", 404)

    data = request.get_json() or {}
    timestamp = data.get("timestamp") or datetime.now(timezone.utc).isoformat()

    operation = op_service.complete_operation(
        operation, get_current_user_id(), get_current_user_role(), timestamp
    )
    return jsonify(operation.to_dict())
