from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.middleware.rbac import require_roles
from app.models.material_catalog import (
    CONSUMABLE_UNITS,
    MATERIAL_CATEGORIES,
    MATERIAL_UNITS,
)
from app.models.user import UserRole
from app.services import catalog_service as unified
from app.services import material_catalog_service as catalog
from app.services import shop_details_service as shop

material_catalog_bp = Blueprint("material_catalog", __name__)
catalog_bp = Blueprint("catalog", __name__)
shop_details_bp = Blueprint("shop_details", __name__)

_STAFF = (UserRole.ADMIN, UserRole.OFFICE_STAFF)


def _flag(name) -> bool:
    return str(request.args.get(name, "")).lower() in ("1", "true", "yes")


@catalog_bp.route("", methods=["GET"])
@jwt_required()
@require_roles(*_STAFF)
def list_catalog():
    items = unified.list_unified(
        search=request.args.get("search") or None,
        type_filter=request.args.get("type") or "all",
        include_inactive=_flag("includeInactive"),
    )
    return jsonify({"items": items, **unified.reference_lists()})


@catalog_bp.route("", methods=["POST"])
@jwt_required()
@require_roles(*_STAFF)
def create_catalog_item():
    return jsonify(unified.create_item(request.get_json() or {})), 201


@catalog_bp.route("/materials/<item_id>", methods=["PATCH"])
@jwt_required()
@require_roles(*_STAFF)
def update_catalog_material(item_id):
    return jsonify(unified.update_item("MATERIAL", item_id, request.get_json() or {}))


@catalog_bp.route("/consumables/<item_id>", methods=["PATCH"])
@jwt_required()
@require_roles(*_STAFF)
def update_catalog_consumable(item_id):
    return jsonify(unified.update_item("CONSUMABLE", item_id, request.get_json() or {}))


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
            "consumableUnits": CONSUMABLE_UNITS,
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
