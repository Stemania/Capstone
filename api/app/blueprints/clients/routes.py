from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.extensions import db
from app.middleware.rbac import require_roles
from app.models.client import Client
from app.models.user import UserRole
from app.utils.errors import AppError

clients_bp = Blueprint("clients", __name__)


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
    if not data.get("name"):
        raise AppError("Name is required", "VALIDATION_ERROR", 400)

    client = Client(name=data["name"], contact=data.get("contact"))
    db.session.add(client)
    db.session.commit()
    return jsonify(client.to_dict()), 201
