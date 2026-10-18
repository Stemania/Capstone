"""Forgot-password request and reset completion (email only)."""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone

from flask_jwt_extended import create_access_token, create_refresh_token

from app.extensions import bcrypt, db
from app.models.notification import NotificationChannel, NotificationEvent
from app.models.user import User, UserStatus
from app.models.user_security import InvitationChannel, PasswordResetToken
from app.services.audit_service import write_audit_event
from app.services.auth_service import _find_user_by_identifier
from app.services.device_pin_service import revoke_all_devices_for_user
from app.services.invitation_service import hash_invite_secret
from app.services.notification_service import send_notification
from app.utils.errors import AppError
from app.utils.passwords import validate_password

logger = logging.getLogger(__name__)

RESET_TTL = timedelta(hours=1)

GENERIC_REQUEST_MESSAGE = (
    "If an account with that email or mobile has an email address on file, "
    "you will receive reset instructions shortly."
)


def _utcnow():
    return datetime.now(timezone.utc)


def _invalidate_open_resets(user_id: str) -> None:
    now = _utcnow()
    open_resets = PasswordResetToken.query.filter(
        PasswordResetToken.user_id == user_id,
        PasswordResetToken.used_at.is_(None),
        PasswordResetToken.revoked_at.is_(None),
    ).all()
    for reset in open_resets:
        reset.revoked_at = now


def _deliver_reset(user: User, reset: PasswordResetToken, raw_secret: str) -> None:
    """Runs after the reset token is committed; delivery problems are logged, never raised."""
    try:
        from app.services.email_templates import absolute_frontend_url, password_reset_email

        link = absolute_frontend_url(f"/reset-password?token={raw_secret}")
        content = password_reset_email(user.full_name or "", link)
        log = send_notification(
            channel=NotificationChannel.EMAIL,
            recipient=user.email,
            event=NotificationEvent.PASSWORD_RESET,
            subject=content.subject,
            body=content.text,
            html_body=content.html,
            store_body=False,
        )
        logger.info(
            "Password reset delivery user_id=%s to=%s channel=%s status=%s",
            user.id,
            user.email,
            reset.channel.value,
            log.status.value if log else "NOT_LOGGED",
        )
    except Exception:  # noqa: BLE001 - the reset token itself is already saved
        logger.exception("Password reset delivery failed user_id=%s", user.id)


def request_password_reset(identifier: str) -> dict:
    user = _find_user_by_identifier(identifier)
    if (
        user
        and user.status == UserStatus.ACTIVE
        and user.password_hash
        and user.email
    ):
        _invalidate_open_resets(user.id)
        raw_secret = secrets.token_urlsafe(32)
        reset = PasswordResetToken(
            user_id=user.id,
            token_hash=hash_invite_secret(raw_secret),
            channel=InvitationChannel.EMAIL,
            expires_at=_utcnow() + RESET_TTL,
        )
        db.session.add(reset)
        write_audit_event(
            "PASSWORD_RESET_REQUESTED",
            "PasswordResetToken",
            None,
            after={"userId": user.id, "channel": InvitationChannel.EMAIL.value},
        )
        db.session.commit()
        _deliver_reset(user, reset, raw_secret)

    return {"message": GENERIC_REQUEST_MESSAGE}


def _find_reset_by_secret(raw_secret: str) -> PasswordResetToken | None:
    if not raw_secret:
        return None
    token_hash = hash_invite_secret(raw_secret.strip())
    return PasswordResetToken.query.filter_by(token_hash=token_hash).first()


def _user_matches_identifier(user: User, identifier: str | None) -> bool:
    from app.services.invitation_service import _user_matches_identifier as invite_match

    return invite_match(user, identifier)


def _require_open_reset(
    raw_secret: str, identifier: str | None = None
) -> tuple[PasswordResetToken, User]:
    reset = _find_reset_by_secret(raw_secret)
    if not reset:
        raise AppError("Invalid or expired reset link", "RESET_INVALID", 400)
    if reset.used_at is not None:
        raise AppError("This reset link was already used", "RESET_USED", 400)
    if reset.revoked_at is not None:
        raise AppError("This reset link is no longer valid", "RESET_REVOKED", 400)
    exp = reset.expires_at
    if exp is not None and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp is None or exp <= _utcnow():
        raise AppError("This reset link has expired", "RESET_EXPIRED", 400)
    user = User.query.get(reset.user_id)
    if not user or user.status != UserStatus.ACTIVE or not user.password_hash:
        raise AppError("Invalid or expired reset link", "RESET_INVALID", 400)
    # Legacy SMS resets still require identifier match; email-link resets are optional.
    if reset.channel == InvitationChannel.SMS:
        if not identifier or not _user_matches_identifier(user, identifier):
            raise AppError("Invalid or expired reset link", "RESET_INVALID", 400)
    elif identifier and not _user_matches_identifier(user, identifier):
        raise AppError("Invalid or expired reset link", "RESET_INVALID", 400)
    return reset, user


def validate_reset_secret(raw_secret: str, identifier: str | None = None) -> dict:
    reset, user = _require_open_reset(raw_secret, identifier)
    return {
        "valid": True,
        "channel": reset.channel.value,
        "email": user.email,
        "fullName": user.full_name,
        "expiresAt": reset.expires_at.isoformat() if reset.expires_at else None,
    }


def complete_password_reset(
    raw_secret: str,
    password: str,
    password_confirm: str,
    identifier: str | None = None,
) -> dict:
    if password != password_confirm:
        raise AppError("Passwords do not match", "VALIDATION_ERROR", 400)
    validate_password(password)

    reset, user = _require_open_reset(raw_secret, identifier)

    user.password_hash = bcrypt.generate_password_hash(password).decode("utf-8")
    reset.used_at = _utcnow()

    write_audit_event(
        "PASSWORD_RESET_COMPLETED",
        "PasswordResetToken",
        reset.id,
        after={"userId": user.id},
    )
    write_audit_event("PASSWORD_CHANGED", "User", user.id, after={"via": "reset"})
    db.session.flush()
    revoke_all_devices_for_user(user.id)
    db.session.commit()

    claims = {"role": user.role.value}
    return {
        "accessToken": create_access_token(identity=user.id, additional_claims=claims),
        "refreshToken": create_refresh_token(identity=user.id, additional_claims=claims),
        "user": user.to_dict(include_profile=True),
    }
