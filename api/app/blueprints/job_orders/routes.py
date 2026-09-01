from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import get_current_user_id, get_current_user_role, require_roles
from app.models.user import UserRole
from app.services import job_order_service as jo_service
from app.services.schedule_service import propose_schedule, validate_schedule

job_orders_bp = Blueprint("job_orders", __name__)


@job_orders_bp.route("/machines", methods=["GET"])
@jwt_required()
def list_machines():
    from app.constants.machines import get_machine_availability

    return jsonify(get_machine_availability())


@job_orders_bp.route("/machine-units", methods=["GET"])
@jwt_required()
def list_machine_units():
    from app.models.machine import MachineUnit

    units = (
        MachineUnit.query.filter_by(active=True)
        .join(MachineUnit.machine_type)
        .order_by(MachineUnit.machine_type_id, MachineUnit.label)
        .all()
    )
    return jsonify([u.to_dict() for u in units])


@job_orders_bp.route("", methods=["GET"])
@jwt_required()
def list_job_orders():
    status = request.args.get("status")
    scope = request.args.get("scope", "production")
    role = get_current_user_role()
    jobs = jo_service.list_job_orders(get_current_user_id(), role, status, scope)
    return jsonify([j.to_dict(viewer_role=role) for j in jobs])


@job_orders_bp.route("", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def create_job_order():
    data = request.get_json() or {}
    required = ["clientId", "title", "dueDate"]
    for field in required:
        if field not in data:
            return jsonify({"error": {"code": "VALIDATION_ERROR", "message": f"{field} is required"}}), 400

    job = jo_service.create_job_order(data, get_current_user_id())
    return jsonify(job.to_dict(include_operations=True, viewer_role=get_current_user_role())), 201


@job_orders_bp.route("/<job_id>", methods=["GET"])
@jwt_required()
def get_job_order(job_id):
    role = get_current_user_role()
    job = jo_service.get_job_order(job_id, get_current_user_id(), role)
    return jsonify(job.to_dict(include_operations=True, viewer_role=role))


@job_orders_bp.route("/<job_id>", methods=["PATCH"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def update_job_order(job_id):
    role = get_current_user_role()
    job = jo_service.get_job_order(job_id, get_current_user_id(), role)
    data = request.get_json() or {}
    job = jo_service.update_job_order(job, data, actor_role=role)
    return jsonify(job.to_dict(include_operations=True, viewer_role=role))


@job_orders_bp.route("/<job_id>/release", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def release_job_order(job_id):
    role = get_current_user_role()
    job = jo_service.get_job_order(job_id, get_current_user_id(), role)
    job = jo_service.release_job_order(job)
    return jsonify(job.to_dict(include_operations=True, viewer_role=role))


@job_orders_bp.route("/<job_id>/deliver", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def deliver_job_order(job_id):
    role = get_current_user_role()
    job = jo_service.get_job_order(job_id, get_current_user_id(), role)
    job = jo_service.mark_job_delivered(job)
    return jsonify(job.to_dict(include_operations=True, viewer_role=role))


@job_orders_bp.route("/<job_id>/operations", methods=["GET"])
@jwt_required()
def list_operations(job_id):
    job = jo_service.get_job_order(job_id, get_current_user_id(), get_current_user_role())
    return jsonify([op.to_dict() for op in job.operations])


@job_orders_bp.route("/<job_id>/schedule/propose", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def propose_job_schedule(job_id):
    job = jo_service.get_job_order(job_id, get_current_user_id(), get_current_user_role())
    data = request.get_json() or {}
    operations = data.get("operations")
    if operations is not None:
        ops = operations
    else:
        ops = list(job.operations)
    result = propose_schedule(
        ops,
        job.due_date,
        exclude_job_id=job.id,
        anchor_utc=jo_service._parse_datetime(data.get("anchor")) if data.get("anchor") else None,
    )
    return jsonify(result)


@job_orders_bp.route("/schedule/propose", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def propose_draft_schedule():
    data = request.get_json() or {}
    if not data.get("operations"):
        return jsonify(
            {"error": {"code": "VALIDATION_ERROR", "message": "operations is required"}}
        ), 400
    due = jo_service._parse_date(data.get("dueDate"))
    if not due:
        return jsonify(
            {"error": {"code": "VALIDATION_ERROR", "message": "dueDate is required"}}
        ), 400
    result = propose_schedule(
        data["operations"],
        due,
        exclude_job_id=data.get("excludeJobId"),
        anchor_utc=jo_service._parse_datetime(data.get("anchor")) if data.get("anchor") else None,
    )
    return jsonify(result)


@job_orders_bp.route("/schedule/validate", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def validate_job_schedule():
    data = request.get_json() or {}
    if not data.get("operations"):
        return jsonify(
            {"error": {"code": "VALIDATION_ERROR", "message": "operations is required"}}
        ), 400
    due = jo_service._parse_date(data.get("dueDate")) if data.get("dueDate") else None
    return jsonify(validate_schedule(data["operations"], due_date=due))
