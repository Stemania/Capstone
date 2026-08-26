from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    get_jwt_identity,
    jwt_required,
)

from app.extensions import limiter
from app.middleware.rbac import get_current_user_id
from app.models.user import User
from app.services.auth_service import (
    authenticate_user,
    change_own_password,
    get_user_by_id,
)
from app.services.device_pin_service import (
    device_pin_status,
    list_user_devices,
    register_device_after_password_login,
    remove_device_pin,
    revoke_device,
    set_device_pin,
    unlock_with_pin,
)
from app.services.invitation_service import accept_invitation, validate_invitation_secret
from app.utils.errors import AppError

auth_bp = Blueprint("auth", __name__)


def _tokens_for(user: User) -> dict:
    claims = {"role": user.role.value}
    return {
        "accessToken": create_access_token(identity=user.id, additional_claims=claims),
        "refreshToken": create_refresh_token(identity=user.id, additional_claims=claims),
        "user": user.to_dict(include_profile=True),
    }


def _limit_login():
    return current_app.config.get("AUTH_RATE_LIMIT_LOGIN", "10 per minute")


def _limit_pin_unlock():
    return current_app.config.get("AUTH_RATE_LIMIT_PIN_UNLOCK", "20 per minute")


def _limit_invite_validate():
    return current_app.config.get("AUTH_RATE_LIMIT_INVITE_VALIDATE", "10 per minute")


def _limit_invite_accept():
    return current_app.config.get("AUTH_RATE_LIMIT_INVITE_ACCEPT", "5 per minute")


@auth_bp.route("/login", methods=["POST"])
@limiter.limit(
    _limit_login,
    error_message="Too many login attempts. Please wait a minute and try again.",
)
def login():
    data = request.get_json() or {}
    identifier = data.get("identifier") or data.get("email") or data.get("mobile")
    password = data.get("password")
    if not identifier or not password:
        return (
            jsonify(
                {
                    "error": {
                        "code": "VALIDATION_ERROR",
                        "message": "Email or mobile and password are required",
                    }
                }
            ),
            400,
        )

    user = authenticate_user(identifier, password)
    device_id = data.get("deviceId")
    device_label = data.get("deviceLabel")
    register_device_after_password_login(user, device_id, device_label)
    payload = _tokens_for(user)
    if device_id:
        payload["device"] = device_pin_status(user.id, device_id)
    return jsonify(payload)


@auth_bp.route("/refresh", methods=["POST"])
@jwt_required(refresh=True)
def refresh():
    user_id = get_jwt_identity()
    user = get_user_by_id(user_id)
    if user.status.value != "ACTIVE":
        raise AppError("Account is not active", "FORBIDDEN", 403)
    claims = {"role": user.role.value}
    access_token = create_access_token(identity=user.id, additional_claims=claims)
    return jsonify({"accessToken": access_token})


@auth_bp.route("/me", methods=["GET"])
@jwt_required()
def me():
    user = get_user_by_id(get_current_user_id())
    return jsonify(user.to_dict(include_profile=True))


@auth_bp.route("/invitation/validate", methods=["POST"])
@limiter.limit(
    _limit_invite_validate,
    error_message="Too many invitation checks. Please wait a minute and try again.",
)
def invitation_validate():
    data = request.get_json() or {}
    token = data.get("token") or data.get("code")
    identifier = data.get("identifier") or data.get("email") or data.get("mobile")
    result = validate_invitation_secret(token or "", identifier)
    return jsonify(result)


@auth_bp.route("/invitation/accept", methods=["POST"])
@limiter.limit(
    _limit_invite_accept,
    error_message="Too many invitation attempts. Please wait a minute and try again.",
)
def invitation_accept():
    data = request.get_json() or {}
    token = data.get("token") or data.get("code")
    password = data.get("password")
    confirm = data.get("passwordConfirm") or data.get("confirmPassword")
    identifier = data.get("identifier") or data.get("email") or data.get("mobile")
    result = accept_invitation(token or "", password or "", confirm or "", identifier)
    device_id = data.get("deviceId")
    device_label = data.get("deviceLabel")
    user = get_user_by_id(result["user"]["id"])
    register_device_after_password_login(user, device_id, device_label)
    if device_id:
        result["device"] = device_pin_status(user.id, device_id)
    return jsonify(result)


@auth_bp.route("/password", methods=["POST"])
@jwt_required()
def change_password():
    user = get_user_by_id(get_current_user_id())
    data = request.get_json() or {}
    change_own_password(
        user,
        data.get("currentPassword") or "",
        data.get("newPassword") or "",
    )
    return jsonify({"message": "Password updated"})


@auth_bp.route("/pin/unlock", methods=["POST"])
@limiter.limit(
    _limit_pin_unlock,
    error_message="Too many PIN attempts. Please wait a minute and try again.",
)
def pin_unlock():
    data = request.get_json() or {}
    result = unlock_with_pin(data.get("deviceId") or "", data.get("pin") or "")
    return jsonify(result)


@auth_bp.route("/pin", methods=["POST"])
@jwt_required()
def pin_set():
    user = get_user_by_id(get_current_user_id())
    data = request.get_json() or {}
    device = set_device_pin(
        user,
        data.get("deviceId") or "",
        data.get("pin") or "",
        data.get("deviceLabel"),
    )
    return jsonify(device.to_dict()), 201


@auth_bp.route("/pin", methods=["DELETE"])
@jwt_required()
def pin_remove():
    user = get_user_by_id(get_current_user_id())
    data = request.get_json() or {}
    remove_device_pin(user, data.get("deviceId") or "")
    return jsonify({"message": "PIN removed"})


@auth_bp.route("/pin/status", methods=["GET"])
@jwt_required()
def pin_status():
    user = get_user_by_id(get_current_user_id())
    device_id = request.args.get("deviceId") or ""
    return jsonify(device_pin_status(user.id, device_id))


@auth_bp.route("/devices", methods=["GET"])
@jwt_required()
def devices_list():
    user = get_user_by_id(get_current_user_id())
    return jsonify([d.to_dict() for d in list_user_devices(user.id)])


@auth_bp.route("/devices/<device_row_id>", methods=["DELETE"])
@jwt_required()
def devices_revoke(device_row_id):
    user = get_user_by_id(get_current_user_id())
    device = revoke_device(user.id, device_row_id)
    return jsonify(device.to_dict())
