"""Consumable purchases: recorded by the Office Staff, read by the Admin too."""

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import get_current_user_id, require_roles
from app.models.user import UserRole
from app.services import consumable_purchase_service as purchases

consumables_bp = Blueprint("consumables", __name__)


@consumables_bp.route("/purchases", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def list_purchases():
    tool_id = request.args.get("toolId")
    return jsonify(purchases.purchase_rows([tool_id] if tool_id else None))


@consumables_bp.route("/purchases", methods=["POST"])
@jwt_required()
@require_roles(UserRole.OFFICE_STAFF)
def record_purchase():
    purchase = purchases.record_purchase(request.get_json() or {}, get_current_user_id())
    return jsonify(purchase.to_dict()), 201


@consumables_bp.route("/purchases/<purchase_id>", methods=["DELETE"])
@jwt_required()
@require_roles(UserRole.OFFICE_STAFF)
def void_purchase(purchase_id):
    purchases.void_purchase(purchase_id, get_current_user_id())
    return jsonify({"removed": True})
