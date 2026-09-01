"""Forgot-password request and reset completion."""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone

from flask import current_app
from flask_jwt_extended import create_access_token, create_refresh_token

from app.extensions import bcrypt, db
from app.models.user import User, UserStatus
from app.models.user_security import InvitationChannel, PasswordResetToken
from app.services.audit_service import write_audit_event
from app.services.auth_service import _find_user_by_identifier
from app.services.device_pin_service import revoke_all_devices_for_user
from app.services.invitation_service import hash_invite_secret
from app.utils.errors import AppError
from app.utils.passwords import validate_password
from app.utils.phone import looks_like_email, looks_like_mobile

logger = logging.getLogger(__name__)

RESET_TTL = timedelta(hours=1)

GENERIC_REQUEST_MESSAGE = (
    "If an account exists for that email or mobile, you will receive reset instructions shortly."
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


def _channel_for_identifier(identifier: str, user: User) -> InvitationChannel:
    raw = (identifier or "").strip()
    if looks_like_mobile(raw):
        return InvitationChannel.SMS
    if looks_like_email(raw):
        return InvitationChannel.EMAIL
    if user.email and raw.lower() == user.email:
        return InvitationChannel.EMAIL
    return InvitationChannel.SMS


def _deliver_reset(user: User, reset: PasswordResetToken, raw_secret: str) -> None:
    cfg = dict(current_app.config)
    frontend = (cfg.get("FRONTEND_URL") or "http://localhost:5173").rstrip("/")
    if reset.channel == InvitationChannel.EMAIL:
        link = f"{frontend}/reset-password?token={raw_secret}"
        body = (
            f"Hello {user.full_name},\n\n"
            f"We received a request to reset your Brothers Machine Shop password.\n"
            f"Use this link (expires in 1 hour):\n\n"
            f"{link}\n\n"
            f"If you did not request this, ignore this message. Your password will not change.\n"
        )
        from app.services.notification_providers import build_email_provider

        provider, _ = build_email_provider(cfg)
        recipient = user.email
        provider.send(recipient, body, subject="Reset your Brothers Machine Shop password")
    else:
        body = (
            f"BMSC password reset code: {raw_secret}. "
            f"Enter it with your email/mobile at {frontend}/reset-password. Expires in 1h."
        )
        from app.services.notification_providers import build_sms_provider

        provider, _ = build_sms_provider(cfg)
        recipient = user.mobile_number
        provider.send(recipient, body)

    logger.info(
        "Password reset sent user_id=%s to=%s channel=%s provider=%s",
        user.id,
        recipient,
        reset.channel.value,
        provider.name,
    )


def request_password_reset(identifier: str) -> dict:
    user = _find_user_by_identifier(identifier)
    if (
        user
        and user.status == UserStatus.ACTIVE
        and user.password_hash
    ):
        channel = _channel_for_identifier(identifier, user)
        if channel == InvitationChannel.SMS and not user.mobile_number:
            channel = InvitationChannel.EMAIL
        if channel == InvitationChannel.EMAIL and not user.email:
            return {"message": GENERIC_REQUEST_MESSAGE}

        _invalidate_open_resets(user.id)

        if channel == InvitationChannel.SMS:
            raw_secret = f"{secrets.randbelow(1_000_000):06d}"
        else:
            raw_secret = secrets.token_urlsafe(32)

        reset = PasswordResetToken(
            user_id=user.id,
            token_hash=hash_invite_secret(raw_secret),
            channel=channel,
            expires_at=_utcnow() + RESET_TTL,
        )
        db.session.add(reset)
        write_audit_event(
            "PASSWORD_RESET_REQUESTED",
            "PasswordResetToken",
            None,
            after={"userId": user.id, "channel": channel.value},
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
