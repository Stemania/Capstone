from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token, create_refresh_token, get_jwt_identity, jwt_required

from app.middleware.rbac import get_current_user_id
from app.models.user import User
from app.services.auth_service import authenticate_user, get_user_by_id

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json() or {}
    email = data.get("email")
    password = data.get("password")
    if not email or not password:
        return jsonify({"error": {"code": "VALIDATION_ERROR", "message": "Email and password required"}}), 400

    user = authenticate_user(email, password)
    additional_claims = {"role": user.role.value}
    access_token = create_access_token(identity=user.id, additional_claims=additional_claims)
    refresh_token = create_refresh_token(identity=user.id, additional_claims=additional_claims)

    return jsonify(
        {
            "accessToken": access_token,
            "refreshToken": refresh_token,
            "user": user.to_dict(include_profile=True),
        }
    )


@auth_bp.route("/refresh", methods=["POST"])
@jwt_required(refresh=True)
def refresh():
    user_id = get_jwt_identity()
    user = get_user_by_id(user_id)
    additional_claims = {"role": user.role.value}
    access_token = create_access_token(identity=user.id, additional_claims=additional_claims)
    return jsonify({"accessToken": access_token})


@auth_bp.route("/me", methods=["GET"])
@jwt_required()
def me():
    user = get_user_by_id(get_current_user_id())
    return jsonify(user.to_dict(include_profile=True))
