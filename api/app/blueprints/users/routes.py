from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.extensions import db
from app.middleware.rbac import get_current_user_id, require_roles
from app.models.user import User, UserRole, UserStatus
from app.models.user_security import InvitationChannel
from app.services.auth_service import get_user_by_id, update_user
from app.services.device_pin_service import revoke_all_devices_for_user
from app.services.invitation_service import (
    create_invited_user,
    resend_invitation,
    revoke_invitation,
)
from app.utils.errors import AppError

users_bp = Blueprint("users", __name__)


@users_bp.route("", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def list_users():
    role = request.args.get("role")
    active = request.args.get("active")
    status = request.args.get("status")
    query = User.query
    if role:
        query = query.filter_by(role=UserRole(role))
    if status:
        query = query.filter_by(status=UserStatus(status))
    elif active is not None:
        query = query.filter_by(active=active.lower() == "true")
    users = query.order_by(User.full_name).all()
    return jsonify(
        [u.to_dict(include_profile=True, include_skills=True) for u in users]
    )


@users_bp.route("", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def create_user_route():
    data = request.get_json() or {}
    required = ["email", "fullName", "role", "mobileNumber"]
    for field in required:
        if not data.get(field):
            return (
                jsonify(
                    {
                        "error": {
                            "code": "VALIDATION_ERROR",
                            "message": f"{field} is required",
                        }
                    }
                ),
                400,
            )
    if data.get("password"):
        return (
            jsonify(
                {
                    "error": {
                        "code": "VALIDATION_ERROR",
                        "message": "Passwords are set by the user via invitation",
                    }
                }
            ),
            400,
        )

    channel_raw = (data.get("inviteChannel") or data.get("channel") or "EMAIL").upper()
    try:
        channel = InvitationChannel(channel_raw)
    except ValueError as exc:
        raise AppError("inviteChannel must be EMAIL or SMS", "VALIDATION_ERROR", 400) from exc

    user, invitation, _raw = create_invited_user(
        full_name=data["fullName"],
        email=data["email"],
        mobile_number=data["mobileNumber"],
        role=UserRole(data["role"]),
        channel=channel,
        created_by_id=get_current_user_id(),
    )
    payload = user.to_dict(include_profile=True, include_skills=True)
    payload["invitation"] = invitation.to_dict()
    return jsonify(payload), 201


@users_bp.route("/<user_id>", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def get_user(user_id):
    user = get_user_by_id(user_id)
    return jsonify(
        user.to_dict(include_profile=True, include_skills=True, include_schedule=True)
    )


@users_bp.route("/<user_id>", methods=["PATCH"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def update_user_route(user_id):
    user = get_user_by_id(user_id)
    data = request.get_json() or {}
    payload = {}
    if "email" in data:
        payload["email"] = data["email"]
    if "mobileNumber" in data:
        payload["mobileNumber"] = data["mobileNumber"]
    if "fullName" in data:
        payload["fullName"] = data["fullName"]
    if "role" in data:
        payload["role"] = UserRole(data["role"])
    if "status" in data:
        payload["status"] = data["status"]
    if "active" in data:
        payload["active"] = data["active"]
    # Admin must not set passwords directly.
    if "password" in data and data["password"]:
        raise AppError(
            "Admins cannot set user passwords; use invitation or ask the user to change it",
            "VALIDATION_ERROR",
            400,
        )

    user = update_user(user, payload)
    return jsonify(user.to_dict(include_profile=True, include_skills=True))


@users_bp.route("/<user_id>", methods=["DELETE"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def deactivate_user(user_id):
    user = get_user_by_id(user_id)
    user.status = UserStatus.DISABLED
    user.sync_active_flag()
    db.session.commit()
    revoke_all_devices_for_user(user.id)
    return jsonify({"message": "User disabled"})


@users_bp.route("/<user_id>/invite", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def resend_invite(user_id):
    user = get_user_by_id(user_id)
    data = request.get_json() or {}
    channel = None
    if data.get("channel") or data.get("inviteChannel"):
        channel = InvitationChannel(
            (data.get("channel") or data.get("inviteChannel")).upper()
        )
    invitation, _raw = resend_invitation(user, get_current_user_id(), channel)
    return jsonify(invitation.to_dict())


@users_bp.route("/<user_id>/invite", methods=["DELETE"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def revoke_invite(user_id):
    user = get_user_by_id(user_id)
    count = revoke_invitation(user)
    return jsonify({"revoked": count})


@users_bp.route("/<user_id>/devices", methods=["DELETE"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def revoke_user_devices(user_id):
    get_user_by_id(user_id)
    count = revoke_all_devices_for_user(user_id)
    return jsonify({"revoked": count})
