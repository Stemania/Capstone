"""Analytics endpoints, split by role (objective 4.1).

Administrator: production (overview, efficiency by worker / operation type /
machine, trend, delays and the Pareto, expected machine workload), plus the
transaction analytics. Office Staff: transactions only (job orders and
deliveries, sales and forecasts, demand, purchasing, consumable run-out) and
never any per-worker figures. Production worker: only their own summary.
"""

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import get_current_user_id, require_roles
from app.models.user import UserRole
from app.services import analytics_service as analytics

analytics_bp = Blueprint("analytics", __name__)

PRODUCTION = (UserRole.ADMIN,)
TRANSACTIONS = (UserRole.ADMIN, UserRole.OFFICE_STAFF)


def _min_ops_arg():
    raw = request.args.get("minOps")
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except ValueError:
        from app.utils.errors import AppError

        raise AppError("minOps must be an integer", "VALIDATION_ERROR", 400)


def _period():
    return {"from_s": request.args.get("from"), "to_s": request.args.get("to")}


@analytics_bp.route("/overview", methods=["GET"])
@jwt_required()
@require_roles(*PRODUCTION)
def overview():
    return jsonify(analytics.overview(**_period()))


@analytics_bp.route("/efficiency/by-worker", methods=["GET"])
@jwt_required()
@require_roles(*PRODUCTION)
def by_worker():
    return jsonify(analytics.efficiency_by_worker(**_period(), min_ops=_min_ops_arg()))


@analytics_bp.route("/efficiency/by-operation-type", methods=["GET"])
@jwt_required()
@require_roles(*PRODUCTION)
def by_operation_type():
    return jsonify(analytics.efficiency_by_operation_type(**_period(), min_ops=_min_ops_arg()))


@analytics_bp.route("/efficiency/by-machine", methods=["GET"])
@jwt_required()
@require_roles(*PRODUCTION)
def by_machine():
    return jsonify(analytics.efficiency_by_machine(**_period(), min_ops=_min_ops_arg()))


@analytics_bp.route("/efficiency/trend", methods=["GET"])
@jwt_required()
@require_roles(*PRODUCTION)
def trend():
    return jsonify(analytics.efficiency_trend(**_period()))


@analytics_bp.route("/delays", methods=["GET"])
@jwt_required()
@require_roles(*PRODUCTION)
def delays():
    return jsonify(analytics.delays(**_period()))


@analytics_bp.route("/demand/capacity", methods=["GET"])
@jwt_required()
@require_roles(*PRODUCTION)
def demand_capacity():
    return jsonify(analytics.demand_capacity(**_period()))


@analytics_bp.route("/job-orders", methods=["GET"])
@jwt_required()
@require_roles(*TRANSACTIONS)
def job_orders_summary():
    return jsonify(analytics.job_orders_summary(**_period()))


@analytics_bp.route("/sales/summary", methods=["GET"])
@jwt_required()
@require_roles(*TRANSACTIONS)
def sales_summary():
    return jsonify(analytics.sales_summary(**_period()))


@analytics_bp.route("/sales/forecast", methods=["GET"])
@jwt_required()
@require_roles(*TRANSACTIONS)
def sales_forecast():
    return jsonify(analytics.sales_forecast(**_period()))


@analytics_bp.route("/demand/forecast", methods=["GET"])
@jwt_required()
@require_roles(*TRANSACTIONS)
def demand_forecast():
    return jsonify(analytics.demand_forecast())


@analytics_bp.route("/consumables/run-out", methods=["GET"])
@jwt_required()
@require_roles(*TRANSACTIONS)
def consumable_run_out():
    return jsonify(analytics.consumable_run_out())


@analytics_bp.route("/purchasing", methods=["GET"])
@jwt_required()
@require_roles(*TRANSACTIONS)
def purchasing():
    return jsonify(analytics.purchasing_summary(**_period()))


@analytics_bp.route("/me", methods=["GET"])
@jwt_required()
@require_roles(UserRole.PRODUCTION_WORKER)
def my_summary():
    return jsonify(analytics.my_summary(get_current_user_id()))
