"""Invitation, identifier login, and device PIN tests.

Runs against the local DATABASE_URL (bmsc) inside a session that always rolls
back — no bmsc_test database required.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app import create_app
from app.config import Config
from app.extensions import bcrypt, db
from app.models.user import User, UserRole, UserStatus
from app.models.user_security import InvitationChannel, UserDevice, UserInvitation
from app.services.device_pin_service import (
    register_device_after_password_login,
    set_device_pin,
)
from app.services.invitation_service import create_invited_user, issue_invitation
from app.utils.phone import normalize_ph_mobile


class LocalTxnConfig(Config):
    """Same local Postgres as development; tests never commit."""

    TESTING = True


@pytest.fixture
def app():
    return create_app(LocalTxnConfig)


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture(autouse=True)
def _rollback_txn(app, monkeypatch):
    """Use local bmsc, but never commit — flush only, then roll back.

    Keep a single app context for the whole test. Nested app_context() blocks
    tear down the session on exit and would lose flushed rows.
    """
    with app.app_context():
        monkeypatch.setattr(db.session, "commit", db.session.flush)
        try:
            yield
        finally:
            db.session.rollback()
            db.session.remove()


def _admin():
    admin = User(
        email="invite_admin@test.local",
        mobile_number="+639170000001",
        password_hash=bcrypt.generate_password_hash("Admin123!").decode("utf-8"),
        full_name="Admin",
        role=UserRole.ADMIN,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(admin)
    db.session.flush()
    return admin


def _active_user(email, mobile, password="Worker123!"):
    user = User(
        email=email,
        mobile_number=mobile,
        password_hash=bcrypt.generate_password_hash(password).decode("utf-8"),
        full_name=email.split("@")[0],
        role=UserRole.PRODUCTION_WORKER,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    db.session.flush()
    return user


def _set_pin(user, device_id, pin):
    register_device_after_password_login(user, device_id, "Test phone")
    return set_device_pin(user, device_id, pin, "Test phone")


def test_invited_user_cannot_login(client):
    db.session.add(
        User(
            email="invited@test.local",
            mobile_number="+639170000010",
            password_hash=None,
            full_name="Invited User",
            role=UserRole.OFFICE_STAFF,
            status=UserStatus.INVITED,
            active=False,
        )
    )
    db.session.flush()

    response = client.post(
        "/api/v1/auth/login",
        json={"identifier": "invited@test.local", "password": "Whatever1!"},
    )
    assert response.status_code == 401
    assert response.get_json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_expired_and_used_invitation_rejected(client):
    admin = _admin()
    user, invitation, raw = create_invited_user(
        full_name="Temp Worker",
        email="temp@test.local",
        mobile_number="09171234567",
        role=UserRole.PRODUCTION_WORKER,
        channel=InvitationChannel.EMAIL,
        created_by_id=admin.id,
    )
    invitation.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
    db.session.flush()
    expired_token = raw

    resp = client.post(
        "/api/v1/auth/invitation/validate",
        json={"token": expired_token},
    )
    assert resp.status_code == 400

    _inv, raw2 = issue_invitation(
        user, InvitationChannel.EMAIL, admin.id, commit=True
    )

    ok = client.post(
        "/api/v1/auth/invitation/accept",
        json={
            "token": raw2,
            "password": "SecurePass1!",
            "passwordConfirm": "SecurePass1!",
        },
    )
    assert ok.status_code == 200
    assert "accessToken" in ok.get_json()

    reused = client.post(
        "/api/v1/auth/invitation/accept",
        json={
            "token": raw2,
            "password": "SecurePass1!",
            "passwordConfirm": "SecurePass1!",
        },
    )
    assert reused.status_code == 400


def test_weak_password_leaves_invitation_open_for_retry(client):
    admin = _admin()
    _user, invitation, raw = create_invited_user(
        full_name="Weak Pass User",
        email="weakpass@test.local",
        mobile_number="09170002222",
        role=UserRole.OFFICE_STAFF,
        channel=InvitationChannel.EMAIL,
        created_by_id=admin.id,
    )
    invitation_id = invitation.id

    rejected = client.post(
        "/api/v1/auth/invitation/accept",
        json={
            "token": raw,
            "password": "Password123",
            "passwordConfirm": "Password123",
        },
    )
    assert rejected.status_code == 400
    message = rejected.get_json()["error"]["message"]
    assert "8 characters" in message
    assert "common password" in message.lower()

    still_open = db.session.get(UserInvitation, invitation_id)
    assert still_open is not None
    assert still_open.used_at is None
    assert still_open.revoked_at is None
    assert still_open.is_active

    ok = client.post(
        "/api/v1/auth/invitation/accept",
        json={
            "token": raw,
            "password": "SecurePass1!",
            "passwordConfirm": "SecurePass1!",
        },
    )
    assert ok.status_code == 200
    assert "accessToken" in ok.get_json()

    used = db.session.get(UserInvitation, invitation_id)
    assert used.used_at is not None


def test_login_with_email_or_mobile_formats(client):
    db.session.add(
        User(
            email="mobileuser@test.local",
            mobile_number=normalize_ph_mobile("09171234567"),
            password_hash=bcrypt.generate_password_hash("Worker123!").decode("utf-8"),
            full_name="Mobile User",
            role=UserRole.PRODUCTION_WORKER,
            status=UserStatus.ACTIVE,
            active=True,
        )
    )
    db.session.flush()

    for identifier in (
        "mobileuser@test.local",
        "09171234567",
        "639171234567",
        "+63 917 123 4567",
        "0917-123-4567",
    ):
        resp = client.post(
            "/api/v1/auth/login",
            json={"identifier": identifier, "password": "Worker123!"},
        )
        assert resp.status_code == 200, identifier
        assert "accessToken" in resp.get_json()


def test_duplicate_normalized_mobile_rejected(client):
    admin = _admin()
    create_invited_user(
        full_name="First",
        email="first@test.local",
        mobile_number="09170001111",
        role=UserRole.OFFICE_STAFF,
        channel=InvitationChannel.EMAIL,
        created_by_id=admin.id,
    )
    db.session.flush()

    login = client.post(
        "/api/v1/auth/login",
        json={"identifier": "invite_admin@test.local", "password": "Admin123!"},
    )
    assert login.status_code == 200
    token = login.get_json()["accessToken"]
    resp = client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "fullName": "Second",
            "email": "second@test.local",
            "mobileNumber": "+639170001111",
            "role": "OFFICE_STAFF",
            "inviteChannel": "EMAIL",
        },
    )
    assert resp.status_code == 409


def test_pin_unlock_rejects_unknown_or_revoked_device(client):
    user = _active_user("pinuser@test.local", "+639170000099")

    assert (
        client.post(
            "/api/v1/auth/pin/unlock",
            json={"deviceId": "00000000-0000-0000-0000-000000000001", "pin": "258369"},
        ).status_code
        == 401
    )

    _set_pin(user, "dev-known-1", "258369")
    device = UserDevice.query.filter_by(device_id="dev-known-1").first()
    device.revoked_at = datetime.now(timezone.utc)
    db.session.flush()

    assert (
        client.post(
            "/api/v1/auth/pin/unlock",
            json={"deviceId": "dev-known-1", "pin": "258369"},
        ).status_code
        == 401
    )


def test_five_failed_pin_attempts_revokes_pin(client):
    user = _active_user("pinlock@test.local", "+639170000088")
    _set_pin(user, "dev-lock", "258369")

    for _ in range(5):
        assert (
            client.post(
                "/api/v1/auth/pin/unlock",
                json={"deviceId": "dev-lock", "pin": "000000"},
            ).status_code
            == 401
        )

    device = UserDevice.query.filter_by(device_id="dev-lock").first()
    assert device is not None
    assert device.pin_hash is None
    assert device.revoked_at is not None


def test_password_change_revokes_all_device_pins(client):
    user = _active_user("pch@test.local", "+639170000077")
    _set_pin(user, "dev-a", "258369")
    _set_pin(user, "dev-b", "147258")
    user_id = user.id

    login = client.post(
        "/api/v1/auth/login",
        json={"identifier": "pch@test.local", "password": "Worker123!"},
    )
    assert login.status_code == 200
    token = login.get_json()["accessToken"]
    resp = client.post(
        "/api/v1/auth/password",
        headers={"Authorization": f"Bearer {token}"},
        json={"currentPassword": "Worker123!", "newPassword": "NewPass99!"},
    )
    assert resp.status_code == 200

    devices = UserDevice.query.filter_by(user_id=user_id).all()
    assert all(d.revoked_at is not None for d in devices)
    assert all(d.pin_hash is None for d in devices)


def test_failed_login_does_not_reveal_identifier(client):
    missing = client.post(
        "/api/v1/auth/login",
        json={"identifier": "nobody@test.local", "password": "WrongPass1!"},
    )
    db.session.add(
        User(
            email="exists@test.local",
            mobile_number="+639170000066",
            password_hash=bcrypt.generate_password_hash("RightPass1!").decode("utf-8"),
            full_name="Exists",
            role=UserRole.OFFICE_STAFF,
            status=UserStatus.ACTIVE,
            active=True,
        )
    )
    db.session.flush()

    wrong = client.post(
        "/api/v1/auth/login",
        json={"identifier": "exists@test.local", "password": "WrongPass1!"},
    )
    assert missing.status_code == 401
    assert wrong.status_code == 401
    assert missing.get_json()["error"]["message"] == wrong.get_json()["error"]["message"]
    assert missing.get_json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_normalize_ph_mobile_variants():
    assert normalize_ph_mobile("09171234567") == "+639171234567"
    assert normalize_ph_mobile("639171234567") == "+639171234567"
    assert normalize_ph_mobile("+63 917-123-4567") == "+639171234567"
