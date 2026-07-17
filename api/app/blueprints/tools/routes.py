from flask import Blueprint, jsonify, request, send_file
from flask_jwt_extended import jwt_required

from app.middleware.rbac import get_current_user_id, require_roles
from app.models.tool import Tool
from app.models.user import UserRole
from app.services import tool_event_service as te_service
from app.utils.errors import AppError

tools_bp = Blueprint("tools", __name__)


@tools_bp.route("", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def list_tools():
    tools = Tool.query.order_by(Tool.name).all()
    return jsonify([t.to_dict(include_custody=True) for t in tools])


@tools_bp.route("", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def create_tool():
    data = request.get_json() or {}
    if not data.get("name"):
        raise AppError("Name is required", "VALIDATION_ERROR", 400)

    tool = te_service.create_tool(data["name"], data.get("code"))
    return jsonify(tool.to_dict()), 201


@tools_bp.route("/my", methods=["GET"])
@jwt_required()
@require_roles(UserRole.PRODUCTION_WORKER)
def my_tools():
    """Tools whose latest event is a BORROW by the current worker."""
    tools = te_service.list_held_tools(get_current_user_id())
    return jsonify(tools)


@tools_bp.route("/scan", methods=["POST"])
@jwt_required()
@require_roles(UserRole.PRODUCTION_WORKER)
def scan_tool():
    data = request.get_json() or {}
    code = data.get("code")
    if not code:
        raise AppError("Tool code is required", "VALIDATION_ERROR", 400)

    event = te_service.scan_tool(code, get_current_user_id(), data.get("jobOrderId"))
    return jsonify(event.to_dict()), 201


@tools_bp.route("/events", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def list_events():
    tool_id = request.args.get("toolId")
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("perPage", 50, type=int)
    pagination = te_service.list_tool_events(tool_id, page, per_page)
    return jsonify(
        {
            "items": [e.to_dict() for e in pagination.items],
            "total": pagination.total,
            "page": pagination.page,
            "pages": pagination.pages,
        }
    )


@tools_bp.route("/<tool_id>", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def get_tool(tool_id):
    tool = Tool.query.get(tool_id)
    if not tool:
        raise AppError("Tool not found", "NOT_FOUND", 404)
    return jsonify(tool.to_dict(include_custody=True))


@tools_bp.route("/<tool_id>/qr", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def get_tool_qr(tool_id):
    tool = Tool.query.get(tool_id)
    if not tool:
        raise AppError("Tool not found", "NOT_FOUND", 404)

    buffer = te_service.generate_qr_png(tool.code)
    return send_file(buffer, mimetype="image/png", download_name=f"{tool.code}.png")


@tools_bp.route("/<tool_id>/custody", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def get_custody(tool_id):
    tool = Tool.query.get(tool_id)
    if not tool:
        raise AppError("Tool not found", "NOT_FOUND", 404)
    return jsonify({"custody": te_service.get_current_custody(tool_id)})
