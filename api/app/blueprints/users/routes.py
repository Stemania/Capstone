from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import require_roles
from app.models.user import User, UserRole
from app.services.auth_service import create_user, get_user_by_id, update_user

users_bp = Blueprint("users", __name__)


@users_bp.route("", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def list_users():
    role = request.args.get("role")
    active = request.args.get("active")
    query = User.query
    if role:
        query = query.filter_by(role=UserRole(role))
    if active is not None:
        query = query.filter_by(active=active.lower() == "true")
    users = query.order_by(User.full_name).all()
    return jsonify([u.to_dict(include_profile=True) for u in users])


@users_bp.route("", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def create_user_route():
    data = request.get_json() or {}
    required = ["email", "password", "fullName", "role"]
    for field in required:
        if not data.get(field):
            return jsonify({"error": {"code": "VALIDATION_ERROR", "message": f"{field} is required"}}), 400

    user = create_user(
        {
            "email": data["email"],
            "password": data["password"],
            "fullName": data["fullName"],
            "role": UserRole(data["role"]),
            "active": data.get("active", True),
            "skills": data.get("skills"),
        }
    )
    return jsonify(user.to_dict(include_profile=True)), 201


@users_bp.route("/<user_id>", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def get_user(user_id):
    user = get_user_by_id(user_id)
    return jsonify(user.to_dict(include_profile=True))


@users_bp.route("/<user_id>", methods=["PATCH"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def update_user_route(user_id):
    user = get_user_by_id(user_id)
    data = request.get_json() or {}
    payload = {}
    if "email" in data:
        payload["email"] = data["email"]
    if "fullName" in data:
        payload["fullName"] = data["fullName"]
    if "role" in data:
        payload["role"] = UserRole(data["role"])
    if "active" in data:
        payload["active"] = data["active"]
    if "password" in data:
        payload["password"] = data["password"]
    if "skills" in data:
        payload["skills"] = data["skills"]

    user = update_user(user, payload)
    return jsonify(user.to_dict(include_profile=True))


@users_bp.route("/<user_id>", methods=["DELETE"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def deactivate_user(user_id):
    user = get_user_by_id(user_id)
    user.active = False
    from app.extensions import db
    db.session.commit()
    return jsonify({"message": "User deactivated"})
