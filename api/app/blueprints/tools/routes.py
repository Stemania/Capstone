from flask import Blueprint, jsonify, request, send_file
from flask_jwt_extended import jwt_required

from app.middleware.rbac import get_current_user_id, require_roles
from app.models.tool import Tool, ToolCategory
from app.models.user import UserRole
from app.services import tool_event_service as te_service
from app.services import tool_type_service as tt_service
from app.utils.errors import AppError

tools_bp = Blueprint("tools", __name__)


# --- Consumables (stocktake catalog) ---


@tools_bp.route("", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF, UserRole.PRODUCTION_WORKER)
def list_tools():
    category = request.args.get("category", "CONSUMABLE")
    q = Tool.query.order_by(Tool.name)
    if category:
        try:
            q = q.filter_by(category=ToolCategory(category.upper()))
        except ValueError as exc:
            raise AppError("Invalid category", "VALIDATION_ERROR", 400) from exc
    tools = q.all()
    worker_id = get_current_user_id()
    return jsonify(
        [t.to_dict(include_custody=True, worker_id=worker_id) for t in tools]
    )


@tools_bp.route("", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def create_tool():
    data = request.get_json() or {}
    data.setdefault("category", "CONSUMABLE")
    tool = te_service.create_tool(data)
    return jsonify(tool.to_dict(include_custody=True)), 201


@tools_bp.route("/my", methods=["GET"])
@jwt_required()
@require_roles(UserRole.PRODUCTION_WORKER)
def my_tools():
    return jsonify(te_service.list_held_tools(get_current_user_id()))


@tools_bp.route("/my/history", methods=["GET"])
@jwt_required()
@require_roles(UserRole.PRODUCTION_WORKER)
def my_tool_history():
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("perPage", 50, type=int)
    pagination = te_service.list_worker_tool_events(get_current_user_id(), page, per_page)
    return jsonify(
        {
            "items": [e.to_dict() for e in pagination.items],
            "total": pagination.total,
            "page": pagination.page,
            "pages": pagination.pages,
        }
    )


@tools_bp.route("/scan", methods=["POST"])
@jwt_required()
@require_roles(UserRole.PRODUCTION_WORKER)
def scan_tool():
    data = request.get_json() or {}
    code = data.get("code")
    if not code:
        raise AppError("Asset code is required", "VALIDATION_ERROR", 400)

    event = te_service.scan_tool(
        code,
        get_current_user_id(),
        data.get("intent"),
        data.get("quantity"),
    )
    return jsonify(event.to_dict()), 201


@tools_bp.route("/events", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def list_events():
    tool_id = request.args.get("toolId")
    category = request.args.get("category")
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("perPage", 50, type=int)
    pagination = te_service.list_tool_events(tool_id, page, per_page, category=category)
    return jsonify(
        {
            "items": [e.to_dict() for e in pagination.items],
            "total": pagination.total,
            "page": pagination.page,
            "pages": pagination.pages,
        }
    )


# --- Tool types / units (must be before /<tool_id> catch-alls) ---


@tools_bp.route("/types", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF, UserRole.PRODUCTION_WORKER)
def list_tool_types():
    only_out = request.args.get("onlyWithOut", "false").lower() in ("1", "true", "yes")
    include_units = request.args.get("includeUnits", "false").lower() in (
        "1",
        "true",
        "yes",
    )
    return jsonify(
        tt_service.list_tool_types(only_with_out=only_out, include_units=include_units)
    )


@tools_bp.route("/units/lookup", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF, UserRole.PRODUCTION_WORKER)
def lookup_unit():
    code = request.args.get("code")
    if not code:
        raise AppError("code is required", "VALIDATION_ERROR", 400)
    return jsonify(tt_service.get_unit_by_asset_code(code))


@tools_bp.route("/types", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def create_tool_type():
    data = request.get_json() or {}
    return jsonify(tt_service.create_tool_type(data)), 201


@tools_bp.route("/types/<type_id>", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF, UserRole.PRODUCTION_WORKER)
def get_tool_type(type_id):
    return jsonify(tt_service.get_tool_type(type_id, include_units=True))


@tools_bp.route("/types/<type_id>", methods=["PATCH"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def patch_tool_type(type_id):
    data = request.get_json() or {}
    return jsonify(tt_service.update_tool_type(type_id, data))


@tools_bp.route("/types/<type_id>/units", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def create_unit(type_id):
    data = request.get_json() or {}
    return jsonify(tt_service.create_tool_unit(type_id, data)), 201


@tools_bp.route("/units/<unit_id>", methods=["PATCH"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def patch_unit(unit_id):
    data = request.get_json() or {}
    return jsonify(tt_service.update_tool_unit(unit_id, data))


@tools_bp.route("/units/<unit_id>/qr", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def unit_qr(unit_id):
    unit = tt_service.get_tool_unit(unit_id)
    buffer = te_service.generate_qr_png(unit.asset_code)
    return send_file(
        buffer, mimetype="image/png", download_name=f"{unit.asset_code}.png"
    )


@tools_bp.route("/<tool_id>", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def get_tool(tool_id):
    tool = Tool.query.get(tool_id)
    if not tool:
        raise AppError("Item not found", "NOT_FOUND", 404)
    return jsonify(tool.to_dict(include_custody=True))


@tools_bp.route("/<tool_id>", methods=["PATCH"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def patch_tool(tool_id):
    data = request.get_json() or {}
    tool = te_service.update_tool(tool_id, data)
    return jsonify(tool.to_dict(include_custody=True))


@tools_bp.route("/<tool_id>/qr", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def get_tool_qr(tool_id):
    tool = Tool.query.get(tool_id)
    if not tool:
        raise AppError("Item not found", "NOT_FOUND", 404)

    buffer = te_service.generate_qr_png(tool.code)
    return send_file(buffer, mimetype="image/png", download_name=f"{tool.code}.png")


@tools_bp.route("/<tool_id>/adjust", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def adjust_stock(tool_id):
    data = request.get_json() or {}
    event = te_service.adjust_stock(
        tool_id,
        get_current_user_id(),
        data.get("quantity"),
        data.get("reason"),
    )
    return jsonify(event.to_dict()), 201
