from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import require_roles
from app.models.user import UserRole
from app.services import analytics_service as analytics

analytics_bp = Blueprint("analytics", __name__)


def _min_ops_arg():
    raw = request.args.get("minOps")
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except ValueError:
        from app.utils.errors import AppError

        raise AppError("minOps must be an integer", "VALIDATION_ERROR", 400)


@analytics_bp.route("/overview", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def overview():
    return jsonify(
        analytics.overview(
            from_s=request.args.get("from"),
            to_s=request.args.get("to"),
        )
    )


@analytics_bp.route("/efficiency/by-worker", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def by_worker():
    return jsonify(
        analytics.efficiency_by_worker(
            from_s=request.args.get("from"),
            to_s=request.args.get("to"),
            min_ops=_min_ops_arg(),
        )
    )


@analytics_bp.route("/efficiency/by-operation-type", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def by_operation_type():
    return jsonify(
        analytics.efficiency_by_operation_type(
            from_s=request.args.get("from"),
            to_s=request.args.get("to"),
            min_ops=_min_ops_arg(),
        )
    )


@analytics_bp.route("/efficiency/by-machine", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def by_machine():
    return jsonify(
        analytics.efficiency_by_machine(
            from_s=request.args.get("from"),
            to_s=request.args.get("to"),
            min_ops=_min_ops_arg(),
        )
    )


@analytics_bp.route("/efficiency/trend", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def trend():
    return jsonify(
        analytics.efficiency_trend(
            from_s=request.args.get("from"),
            to_s=request.args.get("to"),
        )
    )


@analytics_bp.route("/delays", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def delays():
    return jsonify(
        analytics.delays(
            from_s=request.args.get("from"),
            to_s=request.args.get("to"),
        )
    )


@analytics_bp.route("/sales/summary", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def sales_summary():
    return jsonify(
        analytics.sales_summary(
            from_s=request.args.get("from"),
            to_s=request.args.get("to"),
        )
    )


@analytics_bp.route("/sales/forecast", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def sales_forecast():
    return jsonify(
        analytics.sales_forecast(
            from_s=request.args.get("from"),
            to_s=request.args.get("to"),
        )
    )


@analytics_bp.route("/demand/capacity", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def demand_capacity():
    return jsonify(
        analytics.demand_capacity(
            from_s=request.args.get("from"),
            to_s=request.args.get("to"),
        )
    )
