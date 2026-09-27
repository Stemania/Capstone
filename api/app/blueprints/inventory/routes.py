from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import get_current_user_id, require_roles
from app.models.user import UserRole
from app.services import inventory_service as inventory
from app.services import stocktake_service as stocktake

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


@inventory_bp.route("/usage/consumables", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def usage_consumables():
    return jsonify(
        inventory.usage_consumables(
            from_s=request.args.get("from"),
            to_s=request.args.get("to"),
        )
    )


@inventory_bp.route("/stocktakes/form", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def stocktake_form():
    return jsonify(stocktake.stocktake_form())


@inventory_bp.route("/stocktakes", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def list_stocktakes():
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("perPage", 20, type=int)
    pagination = stocktake.list_stocktakes(page, per_page)
    return jsonify(
        {
            "items": [s.to_dict() for s in pagination.items],
            "total": pagination.total,
            "page": pagination.page,
            "pages": pagination.pages,
        }
    )


@inventory_bp.route("/material-purchases", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def list_material_purchases():
    from app.services import material_purchase_service as mp_service

    return jsonify(
        mp_service.list_purchases(
            from_s=request.args.get("from"),
            to_s=request.args.get("to"),
            supplier_id=request.args.get("supplierId"),
            material=request.args.get("material"),
            status=request.args.get("status"),
        )
    )


@inventory_bp.route("/stocktakes", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def create_stocktake():
    data = request.get_json() or {}
    st = stocktake.submit_stocktake(
        get_current_user_id(),
        data.get("lines"),
        counted_on=data.get("countedOn"),
        notes=data.get("notes"),
    )
    return jsonify(st.to_dict(include_lines=True)), 201


@inventory_bp.route("/stocktakes/<stocktake_id>", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def get_stocktake(stocktake_id):
    st = stocktake.get_stocktake(stocktake_id)
    return jsonify(st.to_dict(include_lines=True))
