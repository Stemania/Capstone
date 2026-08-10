from decimal import Decimal, InvalidOperation

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.extensions import db
from app.middleware.rbac import require_roles
from app.models.scoring_weight import ScoringWeight
from app.models.user import User, UserRole
from app.models.worker_skill import WorkerSkill
from app.services.scoring_service import WEIGHT_KEYS, load_scoring_weights, validate_weights_sum
from app.services.worker_availability import get_busy_workers
from app.services.worker_suggestion_service import suggest_workers

workers_bp = Blueprint("workers", __name__)


@workers_bp.route("", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def list_workers():
    exclude_operation_id = request.args.get("excludeOperationId")
    scheduled_start = request.args.get("scheduledStart")
    scheduled_end = request.args.get("scheduledEnd")
    machine_type_id = request.args.get("machineTypeId")
    busy = get_busy_workers(
        start=scheduled_start,
        end=scheduled_end,
        exclude_operation_id=exclude_operation_id,
    )
    query = User.query.filter_by(role=UserRole.PRODUCTION_WORKER, active=True)
    if machine_type_id:
        # Only workers with a WorkerSkill row for this machine type
        query = query.join(WorkerSkill, WorkerSkill.worker_id == User.id).filter(
            WorkerSkill.machine_type_id == machine_type_id
        )
    workers = query.order_by(User.full_name).all()
    result = []
    for w in workers:
        data = w.to_dict(include_profile=True, include_skills=True)
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
    machine_type_id = data.get("machineTypeId")
    operation_type_id = data.get("operationTypeId")
    operation_name = data.get("operationName")

    if not operations and not machine_type_id and not operation_type_id and not operation_name:
        return jsonify(
            {"error": {"code": "VALIDATION_ERROR", "message": "operations or machineTypeId required"}}
        ), 400

    result = suggest_workers(
        operations,
        exclude_job_id=data.get("excludeJobId"),
        scheduled_start=data.get("scheduledStart"),
        scheduled_end=data.get("scheduledEnd"),
        exclude_operation_id=data.get("excludeOperationId"),
        machine_type_id=machine_type_id,
        operation_type_id=operation_type_id,
        operation_name=operation_name,
    )
    return jsonify(result)


@workers_bp.route("/scoring-weights", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def get_scoring_weights():
    weights = load_scoring_weights()
    rows = {row.key: row.to_dict() for row in ScoringWeight.query.all()}
    return jsonify(
        {
            "weights": weights,
            "items": [rows.get(k) or {"key": k, "value": weights[k]} for k in WEIGHT_KEYS],
        }
    )


@workers_bp.route("/scoring-weights", methods=["PUT"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def update_scoring_weights():
    data = request.get_json() or {}
    incoming = data.get("weights") or data
    parsed = {}
    for key in WEIGHT_KEYS:
        if key not in incoming:
            return jsonify(
                {
                    "error": {
                        "code": "VALIDATION_ERROR",
                        "message": f"Missing weight '{key}'",
                    }
                }
            ), 400
        try:
            parsed[key] = Decimal(str(incoming[key]))
        except (InvalidOperation, TypeError, ValueError):
            return jsonify(
                {
                    "error": {
                        "code": "VALIDATION_ERROR",
                        "message": f"Invalid weight value for '{key}'",
                    }
                }
            ), 400
        if parsed[key] < 0 or parsed[key] > 1:
            return jsonify(
                {
                    "error": {
                        "code": "VALIDATION_ERROR",
                        "message": f"Weight '{key}' must be between 0 and 1",
                    }
                }
            ), 400

    ok, total = validate_weights_sum({k: float(v) for k, v in parsed.items()})
    if not ok:
        return jsonify(
            {
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": f"Weights must sum to 1.0 (got {total:.4f})",
                }
            }
        ), 400

    for key, value in parsed.items():
        row = ScoringWeight.query.filter_by(key=key).first()
        if row:
            row.value = value
        else:
            db.session.add(ScoringWeight(key=key, value=value))
    db.session.commit()

    weights = load_scoring_weights()
    return jsonify({"weights": weights})
