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


def session_ended(payload: dict) -> bool:
    """True when the token must stop working. One query per request:

    - the account is gone, disabled, or no longer has the token's role
      (this also covers tokens from a login that sent no device id);
    - the token's device was signed out, deleted, or belongs to someone else.
    """
    sub = payload.get("sub")
    did = payload.get(DEVICE_CLAIM)
    cols = [User.status, User.role]
    if did:
        cols += [UserDevice.user_id, UserDevice.revoked_at]
    query = db.session.query(*cols).select_from(User)
    if did:
        query = query.outerjoin(UserDevice, UserDevice.id == did)
    row = query.filter(User.id == sub).one_or_none()

    if row is None or row.status == UserStatus.DISABLED:
        return True
    role = payload.get("role")
    if role is not None and role != row.role.value:
        return True
    if did:
        return row.user_id != sub or row.revoked_at is not None
    return False


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
        # The token is checked by @jwt_required and again by the role check;
        # look the session up once per request.
        from flask import has_request_context, request

        if not has_request_context():
            return session_ended(payload)
        key = (payload.get("jti"), payload.get("sub"))
        memo = request.environ.setdefault("bmsc.session_ended", {})
        if key not in memo:
            memo[key] = session_ended(payload)
        return memo[key]

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
