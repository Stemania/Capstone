"""Sign-in sessions tied to a device row.

Tokens from a password login, PIN unlock, invitation or password reset carry
the device row id ("did"). Every authenticated request checks that row, so
signing a device out (or deleting its row) ends that browser's session at once.

Tokens issued before device-bound sessions have no "did". They keep working
until their next refresh; refresh then upgrades them if the browser's device is
still signed in, otherwise the user signs in again once.
"""

from __future__ import annotations

from datetime import datetime, timezone

from flask import jsonify
from flask_jwt_extended import create_access_token, create_refresh_token

from app.extensions import db
from app.models.user import User, UserStatus
from app.models.user_security import UserDevice
from app.utils.errors import AppError

DEVICE_CLAIM = "did"


def _claims(user: User, device: UserDevice | None) -> dict:
    claims = {"role": user.role.value}
    if device is not None:
        claims[DEVICE_CLAIM] = device.id
    return claims


def issue_tokens(user: User, device: UserDevice | None = None) -> dict:
    claims = _claims(user, device)
    return {
        "accessToken": create_access_token(identity=user.id, additional_claims=claims),
        "refreshToken": create_refresh_token(identity=user.id, additional_claims=claims),
        "user": user.to_dict(include_profile=True),
    }


def account_session_ended(payload: dict) -> bool:
    """A disabled account, or one whose role changed, ends every token it holds,
    including tokens that are not bound to a device."""
    user = db.session.get(User, payload.get("sub"))
    if user is None or user.status == UserStatus.DISABLED:
        return True
    role = payload.get("role")
    return role is not None and role != user.role.value


def device_session_ended(payload: dict) -> bool:
    did = payload.get(DEVICE_CLAIM)
    if not did:
        return False
    device = db.session.get(UserDevice, did)
    return device is None or device.revoked_at is not None or device.user_id != payload.get("sub")


def refresh_session(user: User, payload: dict, device_id: str | None) -> dict:
    """New access token; also a new refresh token when upgrading an old session."""
    did = payload.get(DEVICE_CLAIM)
    if did:
        device = db.session.get(UserDevice, did)
        upgrade = False
    else:
        device = None
        if device_id:
            device = UserDevice.query.filter(
                UserDevice.user_id == user.id,
                UserDevice.device_id == device_id,
                UserDevice.revoked_at.is_(None),
            ).first()
        upgrade = True
    if device is None or device.revoked_at is not None:
        raise AppError("Your session has ended. Sign in again.", "SESSION_EXPIRED", 401)

    device.last_used_at = datetime.now(timezone.utc)
    db.session.commit()
    claims = _claims(user, device)
    result = {"accessToken": create_access_token(identity=user.id, additional_claims=claims)}
    if upgrade:
        result["refreshToken"] = create_refresh_token(identity=user.id, additional_claims=claims)
    return result


def register_jwt_callbacks(jwt_manager) -> None:
    @jwt_manager.token_in_blocklist_loader
    def _ended(_header, payload):
        return account_session_ended(payload) or device_session_ended(payload)

    @jwt_manager.revoked_token_loader
    def _ended_response(_header, _payload):
        return (
            jsonify(
                {
                    "error": {
                        "code": "DEVICE_SIGNED_OUT",
                        "message": "This device was signed out. Sign in again.",
                    }
                }
            ),
            401,
        )
