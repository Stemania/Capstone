from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import get_current_user_id, get_current_user_role, require_roles
from app.models.user import UserRole
from app.services import job_order_service as jo_service
from app.services.schedule_service import (
    material_constraint_label,
    propose_schedule,
    resolve_material_not_before_utc,
    validate_schedule,
)

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
    awaiting = str(request.args.get("awaitingMaterial", "")).lower() in (
        "1",
        "true",
        "yes",
    )
    role = get_current_user_role()
    jobs = jo_service.list_job_orders(
        get_current_user_id(), role, status, scope, awaiting_material=awaiting
    )
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


@job_orders_bp.route("/<job_id>", methods=["DELETE"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def delete_job_order(job_id):
    role = get_current_user_role()
    job = jo_service.get_job_order(job_id, get_current_user_id(), role)
    jo_service.delete_job_order(job)
    return "", 204


@job_orders_bp.route("/<job_id>/release", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def release_job_order(job_id):
    role = get_current_user_role()
    job = jo_service.get_job_order(job_id, get_current_user_id(), role)
    return jsonify(jo_service.release_job_order(job))


@job_orders_bp.route("/<job_id>/material-received", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def mark_material_received(job_id):
    role = get_current_user_role()
    job = jo_service.get_job_order(job_id, get_current_user_id(), role)
    data = request.get_json() or {}
    updated = jo_service.mark_material_received(job, data.get("receivedDate"))
    return jsonify(updated.to_dict(include_operations=True, viewer_role=role))


@job_orders_bp.route("/<job_id>/material-purchases", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def list_material_purchases(job_id):
    from app.services import material_purchase_service as mp_service

    jo_service.get_job_order(job_id, get_current_user_id(), get_current_user_role())
    rows = mp_service.list_purchases_for_job(job_id)
    return jsonify([r.to_dict() for r in rows])


@job_orders_bp.route("/<job_id>/material-purchases", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def create_material_purchase(job_id):
    from app.services import material_purchase_service as mp_service

    role = get_current_user_role()
    job = jo_service.get_job_order(job_id, get_current_user_id(), role)
    data = request.get_json() or {}
    purchase = mp_service.create_purchase(job, data)
    return jsonify(purchase.to_dict()), 201


@job_orders_bp.route("/<job_id>/material-purchases/<purchase_id>", methods=["PATCH"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def update_material_purchase(job_id, purchase_id):
    from app.models.material_purchase import MaterialPurchase
    from app.services import material_purchase_service as mp_service
    from app.utils.errors import AppError

    jo_service.get_job_order(job_id, get_current_user_id(), get_current_user_role())
    purchase = MaterialPurchase.query.filter_by(
        id=purchase_id, job_order_id=job_id
    ).first()
    if not purchase:
        raise AppError("Purchase not found", "NOT_FOUND", 404)
    data = request.get_json() or {}
    updated = mp_service.update_purchase(purchase, data)
    return jsonify(updated.to_dict())


@job_orders_bp.route(
    "/<job_id>/material-purchases/<purchase_id>/received", methods=["POST"]
)
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def mark_purchase_received(job_id, purchase_id):
    from app.models.material_purchase import MaterialPurchase
    from app.services import material_purchase_service as mp_service
    from app.utils.errors import AppError

    jo_service.get_job_order(job_id, get_current_user_id(), get_current_user_role())
    purchase = MaterialPurchase.query.filter_by(
        id=purchase_id, job_order_id=job_id
    ).first()
    if not purchase:
        raise AppError("Purchase not found", "NOT_FOUND", 404)
    data = request.get_json() or {}
    updated = mp_service.mark_purchase_received(purchase, data.get("receivedDate"))
    return jsonify(updated.to_dict())


@job_orders_bp.route("/<job_id>/material-purchases/<purchase_id>", methods=["DELETE"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def delete_material_purchase(job_id, purchase_id):
    from app.models.material_purchase import MaterialPurchase
    from app.services import material_purchase_service as mp_service
    from app.utils.errors import AppError

    jo_service.get_job_order(job_id, get_current_user_id(), get_current_user_role())
    purchase = MaterialPurchase.query.filter_by(
        id=purchase_id, job_order_id=job_id
    ).first()
    if not purchase:
        raise AppError("Purchase not found", "NOT_FOUND", 404)
    mp_service.delete_purchase(purchase)
    return jsonify({"ok": True})


@job_orders_bp.route("/<job_id>/deliver", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def deliver_job_order(job_id):
    role = get_current_user_role()
    job = jo_service.get_job_order(job_id, get_current_user_id(), role)
    job = jo_service.mark_job_delivered(job)
    return jsonify(job.to_dict(include_operations=True, viewer_role=role))


@job_orders_bp.route("/<job_id>/invoice", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def get_sales_invoice(job_id):
    from app.utils.errors import AppError

    job = jo_service.get_job_order(job_id, get_current_user_id(), get_current_user_role())
    if job.sales_invoice is None:
        raise AppError("No sales invoice has been issued for this job", "NOT_FOUND", 404)
    return jsonify(job.sales_invoice.to_dict())


@job_orders_bp.route("/<job_id>/invoice", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def issue_sales_invoice(job_id):
    from app.services import sales_invoice_service as si_service

    user_id = get_current_user_id()
    job = jo_service.get_job_order(job_id, user_id, get_current_user_role())
    invoice = si_service.issue_invoice(job, request.get_json() or {}, user_id)
    return jsonify(invoice.to_dict()), 201


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
    material_nb = resolve_material_not_before_utc(
        job.material_status,
        job.material_received_date,
        job.material_expected_date,
    )
    result = propose_schedule(
        ops,
        job.due_date,
        exclude_job_id=job.id,
        anchor_utc=jo_service._parse_datetime(data.get("anchor")) if data.get("anchor") else None,
        lock_before_sequence=data.get("lockBeforeSequence"),
        honor_machine_pins=bool(data.get("honorMachinePins")),
        material_not_before_utc=material_nb,
        material_constraint_reason=material_constraint_label(
            job.material_status,
            job.material_received_date,
            job.material_expected_date,
        ),
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
    material_nb = resolve_material_not_before_utc(
        data.get("materialStatus", "NOT_REQUIRED"),
        jo_service._parse_date(data.get("materialReceivedDate")),
        jo_service._parse_date(data.get("materialExpectedDate")),
    )
    result = propose_schedule(
        data["operations"],
        due,
        exclude_job_id=data.get("excludeJobId"),
        anchor_utc=jo_service._parse_datetime(data.get("anchor")) if data.get("anchor") else None,
        lock_before_sequence=data.get("lockBeforeSequence"),
        honor_machine_pins=bool(data.get("honorMachinePins")),
        material_not_before_utc=material_nb,
        material_constraint_reason=material_constraint_label(
            data.get("materialStatus", "NOT_REQUIRED"),
            jo_service._parse_date(data.get("materialReceivedDate")),
            jo_service._parse_date(data.get("materialExpectedDate")),
        ),
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
