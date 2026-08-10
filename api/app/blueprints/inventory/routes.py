from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import require_roles
from app.models.user import UserRole
from app.services import inventory_service as inventory

inventory_bp = Blueprint("inventory", __name__)


@inventory_bp.route("/purchase-suggestions", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def purchase_suggestions():
    lookback = request.args.get("lookbackDays", 30, type=int)
    return jsonify(inventory.purchase_suggestions(lookback_days=lookback))


@inventory_bp.route("/usage/by-worker", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def usage_by_worker():
    return jsonify(
        inventory.usage_by_worker(
            from_s=request.args.get("from"),
            to_s=request.args.get("to"),
        )
    )


@inventory_bp.route("/usage/by-item", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def usage_by_item():
    return jsonify(
        inventory.usage_by_item(
            from_s=request.args.get("from"),
            to_s=request.args.get("to"),
        )
    )
