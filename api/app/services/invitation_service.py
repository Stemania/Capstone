"""Invitation issue/accept and password setup."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from flask import current_app
from flask_jwt_extended import create_access_token, create_refresh_token

from app.extensions import bcrypt, db
from app.models.user import User, UserRole, UserStatus
from app.models.user_security import InvitationChannel, UserInvitation
from app.models.worker_profile import WorkerProfile
from app.services.audit_service import write_audit_event
from app.services.notification_providers import build_email_provider, build_sms_provider
from app.utils.errors import AppError
from app.utils.passwords import validate_password
from app.utils.phone import looks_like_email, looks_like_mobile, normalize_ph_mobile

INVITE_TTL = timedelta(hours=48)


def _utcnow():
    return datetime.now(timezone.utc)


def _pepper() -> str:
    return current_app.config.get("INVITATION_TOKEN_PEPPER") or current_app.config["SECRET_KEY"]


def hash_invite_secret(raw: str) -> str:
    return hmac.new(_pepper().encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()


def _invalidate_open_invites(user_id: str) -> None:
    now = _utcnow()
    open_invites = UserInvitation.query.filter(
        UserInvitation.user_id == user_id,
        UserInvitation.used_at.is_(None),
        UserInvitation.revoked_at.is_(None),
    ).all()
    for inv in open_invites:
        inv.revoked_at = now


def create_invited_user(
    *,
    full_name: str,
    email: str,
    mobile_number: str,
    role: UserRole,
    channel: InvitationChannel,
    created_by_id: str,
) -> tuple[User, UserInvitation, str]:
    email_norm = (email or "").strip().lower()
    if not email_norm or "@" not in email_norm:
        raise AppError("Valid email is required", "VALIDATION_ERROR", 400)
    if User.query.filter_by(email=email_norm).first():
        raise AppError("Email already exists", "CONFLICT", 409)

    mobile = normalize_ph_mobile(mobile_number, required=True)
    if User.query.filter_by(mobile_number=mobile).first():
        raise AppError("Mobile number already exists", "CONFLICT", 409)

    user = User(
        email=email_norm,
        mobile_number=mobile,
        password_hash=None,
        full_name=full_name.strip(),
        role=role,
        status=UserStatus.INVITED,
        active=False,
    )
    db.session.add(user)
    db.session.flush()

    if role == UserRole.PRODUCTION_WORKER:
        db.session.add(WorkerProfile(user_id=user.id))
        from datetime import time

        from app.models.worker_skill import WorkerSchedule

        for dow in range(7):
            working = dow < 6
            db.session.add(
                WorkerSchedule(
                    worker_id=user.id,
                    day_of_week=dow,
                    start_time=time(8, 0) if working else None,
                    end_time=time(17, 0) if working else None,
                    is_working=working,
                )
            )

    invitation, raw_secret = issue_invitation(user, channel, created_by_id, commit=False)
    db.session.commit()
    _deliver_invitation(user, invitation, raw_secret)
    return user, invitation, raw_secret


def issue_invitation(
    user: User,
    channel: InvitationChannel,
    created_by_id: str,
    *,
    commit: bool = True,
) -> tuple[UserInvitation, str]:
    if user.status == UserStatus.DISABLED:
        raise AppError("Cannot invite a disabled user", "VALIDATION_ERROR", 400)
    if channel == InvitationChannel.SMS and not user.mobile_number:
        raise AppError("User has no mobile number for SMS invite", "VALIDATION_ERROR", 400)
    if channel == InvitationChannel.EMAIL and not user.email:
        raise AppError("User has no email for invite", "VALIDATION_ERROR", 400)

    _invalidate_open_invites(user.id)

    if channel == InvitationChannel.SMS:
        raw_secret = f"{secrets.randbelow(1_000_000):06d}"
    else:
        raw_secret = secrets.token_urlsafe(32)

    invitation = UserInvitation(
        user_id=user.id,
        token_hash=hash_invite_secret(raw_secret),
        channel=channel,
        expires_at=_utcnow() + INVITE_TTL,
        created_by_id=created_by_id,
    )
    db.session.add(invitation)
    if user.status != UserStatus.ACTIVE:
        user.status = UserStatus.INVITED
        user.sync_active_flag()

    write_audit_event(
        "INVITATION_SENT",
        "UserInvitation",
        None,
        after={"userId": user.id, "channel": channel.value},
    )
    if commit:
        db.session.commit()
        _deliver_invitation(user, invitation, raw_secret)
    else:
        db.session.flush()
    return invitation, raw_secret


def resend_invitation(user: User, created_by_id: str, channel: InvitationChannel | None = None):
    if user.status == UserStatus.ACTIVE and user.password_hash:
        raise AppError("User already activated", "VALIDATION_ERROR", 400)
    if user.status == UserStatus.DISABLED:
        raise AppError("User is disabled", "VALIDATION_ERROR", 400)

    last = (
        UserInvitation.query.filter_by(user_id=user.id)
        .order_by(UserInvitation.created_at.desc())
        .first()
    )
    ch = channel or (last.channel if last else InvitationChannel.EMAIL)
    return issue_invitation(user, ch, created_by_id, commit=True)


def revoke_invitation(user: User) -> int:
    now = _utcnow()
    open_invites = UserInvitation.query.filter(
        UserInvitation.user_id == user.id,
        UserInvitation.used_at.is_(None),
        UserInvitation.revoked_at.is_(None),
    ).all()
    for inv in open_invites:
        inv.revoked_at = now
    write_audit_event(
        "INVITATION_REVOKED",
        "User",
        user.id,
        after={"count": len(open_invites)},
    )
    db.session.commit()
    return len(open_invites)


def _deliver_invitation(user: User, invitation: UserInvitation, raw_secret: str) -> None:
    cfg = dict(current_app.config)
    frontend = (cfg.get("FRONTEND_URL") or "http://localhost:5173").rstrip("/")
    if invitation.channel == InvitationChannel.EMAIL:
        link = f"{frontend}/set-password?token={raw_secret}"
        body = (
            f"Hello {user.full_name},\n\n"
            f"You have been invited to Brothers Machine Shop.\n"
            f"Set your password using this link (expires in 48 hours):\n\n"
            f"{link}\n\n"
            f"If you did not expect this, ignore this message.\n"
        )
        provider, _ = build_email_provider(cfg)
        provider.send(user.email, body, subject="Set your Brothers Machine Shop password")
    else:
        body = (
            f"BMSC invite code: {raw_secret}. "
            f"Enter it with your email/mobile at {frontend}/set-password. Expires in 48h."
        )
        provider, _ = build_sms_provider(cfg)
        provider.send(user.mobile_number, body)


def _find_invitation_by_secret(raw_secret: str) -> UserInvitation | None:
    if not raw_secret:
        return None
    token_hash = hash_invite_secret(raw_secret.strip())
    return UserInvitation.query.filter_by(token_hash=token_hash).first()


def _user_matches_identifier(user: User, identifier: str | None) -> bool:
    raw = (identifier or "").strip()
    if not raw:
        return False
    if looks_like_email(raw):
        return user.email == raw.lower()
    if looks_like_mobile(raw):
        try:
            return user.mobile_number == normalize_ph_mobile(raw, required=True)
        except AppError:
            return False
    if user.email == raw.lower():
        return True
    try:
        return user.mobile_number == normalize_ph_mobile(raw, required=True)
    except AppError:
        return False


def _require_open_invitation(
    raw_secret: str, identifier: str | None = None
) -> tuple[UserInvitation, User]:
    invitation = _find_invitation_by_secret(raw_secret)
    if not invitation:
        raise AppError("Invalid invitation", "INVITE_INVALID", 400)
    if invitation.used_at is not None:
        raise AppError("This invitation was already used", "INVITE_USED", 400)
    if invitation.revoked_at is not None:
        raise AppError("This invitation was revoked", "INVITE_REVOKED", 400)
    exp = invitation.expires_at
    if exp is not None and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp is None or exp <= _utcnow():
        raise AppError("This invitation has expired", "INVITE_EXPIRED", 400)
    user = User.query.get(invitation.user_id)
    if not user or user.status == UserStatus.DISABLED:
        raise AppError("Invalid invitation", "INVITE_INVALID", 400)
    if invitation.channel == InvitationChannel.SMS:
        if not identifier or not _user_matches_identifier(user, identifier):
            raise AppError("Invalid invitation", "INVITE_INVALID", 400)
    elif identifier and not _user_matches_identifier(user, identifier):
        raise AppError("Invalid invitation", "INVITE_INVALID", 400)
    return invitation, user


def validate_invitation_secret(raw_secret: str, identifier: str | None = None) -> dict:
    invitation, user = _require_open_invitation(raw_secret, identifier)
    return {
        "valid": True,
        "channel": invitation.channel.value,
        "email": user.email,
        "fullName": user.full_name,
        "expiresAt": invitation.expires_at.isoformat() if invitation.expires_at else None,
    }


def accept_invitation(
    raw_secret: str,
    password: str,
    password_confirm: str,
    identifier: str | None = None,
) -> dict:
    if password != password_confirm:
        raise AppError("Passwords do not match", "VALIDATION_ERROR", 400)
    validate_password(password)

    invitation, user = _require_open_invitation(raw_secret, identifier)

    user.password_hash = bcrypt.generate_password_hash(password).decode("utf-8")
    user.status = UserStatus.ACTIVE
    user.sync_active_flag()
    invitation.used_at = _utcnow()

    write_audit_event(
        "INVITATION_USED",
        "UserInvitation",
        invitation.id,
        after={"userId": user.id},
    )
    write_audit_event("PASSWORD_SET", "User", user.id, after={"via": "invitation"})
    db.session.commit()

    claims = {"role": user.role.value}
    return {
        "accessToken": create_access_token(identity=user.id, additional_claims=claims),
        "refreshToken": create_refresh_token(identity=user.id, additional_claims=claims),
        "user": user.to_dict(include_profile=True),
    }
