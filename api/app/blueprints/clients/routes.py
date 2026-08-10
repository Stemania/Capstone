from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.extensions import db
from app.middleware.rbac import require_roles
from app.models.client import Client
from app.models.user import UserRole
from app.utils.errors import AppError

clients_bp = Blueprint("clients", __name__)


def _parse_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def _apply_client_fields(client: Client, data: dict, *, creating: bool = False):
    if "name" in data or creating:
        name = (data.get("name") or "").strip()
        if not name:
            raise AppError("Name is required", "VALIDATION_ERROR", 400)
        client.name = name
    if "contact" in data:
        client.contact = data.get("contact") or None
    if "email" in data:
        email = (data.get("email") or "").strip()
        client.email = email or None
    if "mobileNumber" in data or "mobile_number" in data:
        mobile = (data.get("mobileNumber") or data.get("mobile_number") or "").strip()
        client.mobile_number = mobile or None
    if "notifyByEmail" in data or "notify_by_email" in data:
        client.notify_by_email = _parse_bool(
            data.get("notifyByEmail", data.get("notify_by_email")), False
        )
    if "notifyBySms" in data or "notify_by_sms" in data:
        client.notify_by_sms = _parse_bool(
            data.get("notifyBySms", data.get("notify_by_sms")), False
        )


@clients_bp.route("", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def list_clients():
    search = request.args.get("search", "")
    query = Client.query
    if search:
        query = query.filter(Client.name.ilike(f"%{search}%"))
    clients = query.order_by(Client.name).all()
    return jsonify([c.to_dict() for c in clients])


@clients_bp.route("", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def create_client():
    data = request.get_json() or {}
    client = Client(
        name="",
        contact=None,
        email=None,
        mobile_number=None,
        notify_by_email=False,
        notify_by_sms=False,
    )
    _apply_client_fields(client, data, creating=True)
    db.session.add(client)
    db.session.commit()
    return jsonify(client.to_dict()), 201


@clients_bp.route("/<client_id>", methods=["PATCH"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def update_client(client_id):
    client = Client.query.get(client_id)
    if not client:
        raise AppError("Client not found", "NOT_FOUND", 404)
    data = request.get_json() or {}
    _apply_client_fields(client, data, creating=False)
    db.session.commit()
    return jsonify(client.to_dict())
