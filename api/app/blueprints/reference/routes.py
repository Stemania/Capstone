from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.middleware.rbac import require_roles
from app.models.material_catalog import MATERIAL_CATEGORIES, MATERIAL_UNITS
from app.models.user import UserRole
from app.services import material_catalog_service as catalog
from app.services import shop_details_service as shop

material_catalog_bp = Blueprint("material_catalog", __name__)
shop_details_bp = Blueprint("shop_details", __name__)


@material_catalog_bp.route("", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def list_materials():
    include_inactive = str(request.args.get("includeInactive", "")).lower() in ("1", "true", "yes")
    rows = catalog.list_items(
        search=request.args.get("search") or None, include_inactive=include_inactive
    )
    return jsonify(
        {
            "items": [r.to_dict() for r in rows],
            "units": MATERIAL_UNITS,
            "categories": MATERIAL_CATEGORIES,
        }
    )


@material_catalog_bp.route("", methods=["POST"])
@jwt_required()
@require_roles(UserRole.OFFICE_STAFF)
def create_material():
    return jsonify(catalog.create_item(request.get_json() or {}).to_dict()), 201


@material_catalog_bp.route("/<item_id>", methods=["PATCH"])
@jwt_required()
@require_roles(UserRole.OFFICE_STAFF)
def update_material(item_id):
    return jsonify(catalog.update_item(item_id, request.get_json() or {}).to_dict())


@shop_details_bp.route("", methods=["GET"])
@jwt_required()
def get_shop_details():
    return jsonify(shop.get_shop_details())


@shop_details_bp.route("", methods=["PUT"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def put_shop_details():
    return jsonify(shop.update_shop_details(request.get_json() or {}, get_jwt_identity()))
