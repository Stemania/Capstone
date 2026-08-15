from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import get_current_user_id, get_current_user_role, require_roles
from app.models.operation import JobOperation
from app.models.operation_time import MachineDowntime
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


@operations_bp.route("/<operation_id>/pause", methods=["POST"])
@jwt_required()
@require_roles(UserRole.PRODUCTION_WORKER)
def pause_operation(operation_id):
    operation = JobOperation.query.get(operation_id)
    if not operation:
        raise AppError("Operation not found", "NOT_FOUND", 404)

    data = request.get_json() or {}
    reason = data.get("reason")
    if not reason:
        return jsonify({"error": {"code": "VALIDATION_ERROR", "message": "reason is required"}}), 400

    operation = op_service.pause_operation(
        operation,
        get_current_user_id(),
        get_current_user_role(),
        reason=reason,
        note=data.get("note"),
        timestamp=data.get("timestamp"),
    )
    return jsonify(operation.to_dict())


@operations_bp.route("/<operation_id>/resume", methods=["POST"])
@jwt_required()
@require_roles(UserRole.PRODUCTION_WORKER)
def resume_operation(operation_id):
    operation = JobOperation.query.get(operation_id)
    if not operation:
        raise AppError("Operation not found", "NOT_FOUND", 404)

    data = request.get_json() or {}
    operation = op_service.resume_operation(
        operation,
        get_current_user_id(),
        get_current_user_role(),
        timestamp=data.get("timestamp"),
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


@operations_bp.route("/<operation_id>/rework", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def rework_operation(operation_id):
    operation = JobOperation.query.get(operation_id)
    if not operation:
        raise AppError("Operation not found", "NOT_FOUND", 404)

    data = request.get_json() or {}
    follow = op_service.create_rework_operation(
        operation,
        get_current_user_id(),
        get_current_user_role(),
        reason=data.get("reason"),
    )
    return jsonify(follow.to_dict()), 201


@operations_bp.route("/machine-units/status", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def list_machine_unit_status():
    return jsonify(op_service.list_machine_unit_statuses())


@operations_bp.route("/machine-units/<unit_id>/downtime", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF, UserRole.PRODUCTION_WORKER)
def open_downtime(unit_id):
    data = request.get_json() or {}
    row = op_service.open_machine_downtime(
        unit_id,
        reported_by_id=get_current_user_id(),
        reason=data.get("reason"),
        note=data.get("note"),
        started_at=data.get("startedAt") or data.get("started_at"),
    )
    payload = row.to_dict()
    affected = op_service.list_affected_operations(unit_id)
    payload["affectedCount"] = len(affected)
    payload["affectedOperations"] = affected
    return jsonify(payload), 201


@operations_bp.route("/machine-units/downtime/<downtime_id>/close", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF, UserRole.PRODUCTION_WORKER)
def close_downtime(downtime_id):
    data = request.get_json() or {}
    row = op_service.close_machine_downtime(
        downtime_id,
        ended_at=data.get("endedAt") or data.get("ended_at"),
        note=data.get("note"),
    )
    return jsonify(row.to_dict())


@operations_bp.route("/machine-units/<unit_id>/downtime", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def list_unit_downtime(unit_id):
    rows = (
        MachineDowntime.query.filter_by(machine_unit_id=unit_id)
        .order_by(MachineDowntime.started_at.desc())
        .all()
    )
    return jsonify([r.to_dict() for r in rows])
