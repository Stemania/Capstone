"""Device-bound PIN unlock (optional convenience after password login)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func

from app.extensions import bcrypt, db
from app.models.user import User, UserStatus
from app.models.user_security import UserDevice
from app.services.audit_service import write_audit_event
from app.services.session_service import issue_tokens
from app.utils.errors import AppError
from app.utils.passwords import validate_pin

MAX_PIN_FAILURES = 5
# Rows without a PIN and unused this long are deleted (a session lasts at most 7 days).
STALE_DEVICE_DAYS = 30


def _utcnow():
    return datetime.now(timezone.utc)


def _get_or_create_device(user_id: str, device_id: str, device_label: str | None) -> UserDevice:
    device = UserDevice.query.filter_by(user_id=user_id, device_id=device_id).first()
    if device and device.revoked_at is None:
        if device_label:
            device.device_label = device_label
        return device
    if device and device.revoked_at is not None:
        # A fresh row id, so tokens from before the sign-out stay rejected.
        db.session.delete(device)
        db.session.flush()
    device = UserDevice(
        user_id=user_id,
        device_id=device_id,
        device_label=device_label,
        pin_failed_attempts=0,
    )
    db.session.add(device)
    db.session.flush()
    return device


def register_device_after_password_login(
    user: User, device_id: str | None, device_label: str | None = None
) -> UserDevice | None:
    if not device_id:
        return None
    prune_stale_devices(user.id)
    device = _get_or_create_device(user.id, device_id, device_label)
    device.last_used_at = _utcnow()
    db.session.commit()
    return device


def set_device_pin(
    user: User, device_id: str, pin: str, device_label: str | None = None
) -> UserDevice:
    if not device_id:
        raise AppError("deviceId is required", "VALIDATION_ERROR", 400)
    validate_pin(pin)
    # PIN may only be set on a device that already completed a password login.
    device = UserDevice.query.filter_by(user_id=user.id, device_id=device_id).first()
    if not device or device.revoked_at is not None:
        raise AppError(
            "Complete a password login on this device before setting a PIN",
            "PIN_DEVICE_REQUIRED",
            400,
        )
    if device_label:
        device.device_label = device_label
    device.pin_hash = bcrypt.generate_password_hash(pin).decode("utf-8")
    device.pin_set_at = _utcnow()
    device.pin_failed_attempts = 0
    write_audit_event(
        "PIN_SET",
        "UserDevice",
        device.id,
        after={"userId": user.id, "deviceId": device_id},
    )
    db.session.commit()
    return device


def remove_device_pin(user: User, device_id: str) -> None:
    device = UserDevice.query.filter_by(user_id=user.id, device_id=device_id).first()
    if not device or not device.pin_hash:
        raise AppError("No PIN on this device", "NOT_FOUND", 404)
    device.pin_hash = None
    device.pin_set_at = None
    device.pin_failed_attempts = 0
    write_audit_event("PIN_REMOVED", "UserDevice", device.id, after={"userId": user.id})
    db.session.commit()


def _device_not_set_up() -> AppError:
    return AppError(
        "This device isn't set up — sign in with your password",
        "PIN_DEVICE_UNKNOWN",
        401,
    )


def unlock_with_pin(device_id: str, pin: str) -> dict:
    if not device_id or not pin:
        raise _device_not_set_up()

    # One browser shares a device id across accounts. Match the row that
    # actually has a PIN, not whichever row the database returns first.
    candidates = (
        UserDevice.query.filter(
            UserDevice.device_id == device_id,
            UserDevice.revoked_at.is_(None),
            UserDevice.pin_hash.isnot(None),
        )
        .order_by(UserDevice.pin_set_at.desc())
        .all()
    )
    active: list[tuple[UserDevice, User]] = []
    for row in candidates:
        owner = db.session.get(User, row.user_id)
        if owner and owner.status == UserStatus.ACTIVE:
            active.append((row, owner))

    if not active:
        write_audit_event(
            "PIN_FAILED",
            "UserDevice",
            None,
            after={"deviceId": device_id, "reason": "unknown_or_revoked"},
        )
        db.session.commit()
        raise _device_not_set_up()

    for device, user in active:
        if bcrypt.check_password_hash(device.pin_hash, pin):
            device.pin_failed_attempts = 0
            device.last_used_at = _utcnow()
            db.session.commit()
            return issue_tokens(user, device)

    device, _user = active[0]
    device.pin_failed_attempts = (device.pin_failed_attempts or 0) + 1
    write_audit_event(
        "PIN_FAILED",
        "UserDevice",
        device.id,
        after={
            "userId": device.user_id,
            "deviceId": device_id,
            "attempts": device.pin_failed_attempts,
        },
    )
    if device.pin_failed_attempts >= MAX_PIN_FAILURES:
        device.pin_hash = None
        device.pin_set_at = None
        device.revoked_at = _utcnow()
        write_audit_event(
            "DEVICE_REVOKED",
            "UserDevice",
            device.id,
            after={"userId": device.user_id, "reason": "pin_lockout"},
        )
        db.session.commit()
        raise AppError(
            "PIN has been removed on this device. Sign in with your password.",
            "PIN_LOCKED",
            401,
        )
    db.session.commit()
    remaining = MAX_PIN_FAILURES - device.pin_failed_attempts
    raise AppError(
        f"PIN incorrect. {remaining} attempt{'s' if remaining != 1 else ''} left.",
        "PIN_INVALID",
        401,
    )


def prune_stale_devices(user_id: str) -> int:
    cutoff = _utcnow() - timedelta(days=STALE_DEVICE_DAYS)
    stale = UserDevice.query.filter(
        UserDevice.user_id == user_id,
        UserDevice.pin_hash.is_(None),
        func.coalesce(UserDevice.last_used_at, UserDevice.created_at) < cutoff,
    ).all()
    for device in stale:
        db.session.delete(device)
    if stale:
        db.session.commit()
    return len(stale)


def list_user_devices(user_id: str) -> list[UserDevice]:
    prune_stale_devices(user_id)
    return (
        UserDevice.query.filter_by(user_id=user_id)
        .order_by(func.coalesce(UserDevice.last_used_at, UserDevice.created_at).desc())
        .all()
    )


def revoke_device(user_id: str, device_row_id: str) -> UserDevice:
    device = UserDevice.query.filter_by(id=device_row_id, user_id=user_id).first()
    if not device:
        raise AppError("Device not found", "NOT_FOUND", 404)
    device.revoked_at = _utcnow()
    device.pin_hash = None
    device.pin_set_at = None
    write_audit_event("DEVICE_REVOKED", "UserDevice", device.id, after={"userId": user_id})
    db.session.commit()
    return device


def revoke_all_devices_for_user(user_id: str, keep_device_row_id: str | None = None) -> int:
    """Sign out every device; ``keep_device_row_id`` stays signed in but loses its PIN."""
    now = _utcnow()
    devices = UserDevice.query.filter(
        UserDevice.user_id == user_id,
        UserDevice.revoked_at.is_(None),
    ).all()
    revoked = 0
    for device in devices:
        device.pin_hash = None
        device.pin_set_at = None
        device.pin_failed_attempts = 0
        if device.id != keep_device_row_id:
            device.revoked_at = now
            revoked += 1
    write_audit_event(
        "DEVICE_REVOKED",
        "User",
        user_id,
        after={"count": revoked, "scope": "all" if not keep_device_row_id else "others"},
    )
    db.session.commit()
    return revoked


def sign_out_other_devices(user_id: str, current_device_row_id: str | None) -> int:
    """Sign out every device except the current one. Other devices also lose their PIN."""
    if not current_device_row_id:
        raise AppError(
            "Sign in again on this device first",
            "DEVICE_REQUIRED",
            400,
        )
    now = _utcnow()
    others = UserDevice.query.filter(
        UserDevice.user_id == user_id,
        UserDevice.revoked_at.is_(None),
        UserDevice.id != current_device_row_id,
    ).all()
    for device in others:
        device.revoked_at = now
        device.pin_hash = None
        device.pin_set_at = None
    write_audit_event(
        "DEVICE_REVOKED",
        "User",
        user_id,
        after={"count": len(others), "scope": "others"},
    )
    db.session.commit()
    return len(others)


def device_pin_status(user_id: str, device_id: str) -> dict:
    device = UserDevice.query.filter_by(user_id=user_id, device_id=device_id).first()
    if not device or device.revoked_at is not None:
        return {"known": False, "hasPin": False}
    return {"known": True, "hasPin": bool(device.pin_hash)}
