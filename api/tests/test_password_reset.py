"""Forgot-password and reset-token tests."""

from datetime import datetime, timedelta, timezone

import pytest

from app import create_app
from app.config import Config
from app.extensions import bcrypt, db
from app.models.user import User, UserRole, UserStatus
from app.models.user_security import InvitationChannel, PasswordResetToken
from app.services.device_pin_service import register_device_after_password_login, set_device_pin
from app.services.invitation_service import hash_invite_secret
from app.services.password_reset_service import request_password_reset


class LocalTxnConfig(Config):
    TESTING = True
    ENV = "production"
    DEBUG = False
    RATELIMIT_ENABLED = False
    RATELIMIT_STORAGE_URI = "memory://"


@pytest.fixture
def app():
    return create_app(LocalTxnConfig)


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture(autouse=True)
def _rollback_txn(app, monkeypatch):
    with app.app_context():
        monkeypatch.setattr(db.session, "commit", db.session.flush)
        try:
            yield
        finally:
            db.session.rollback()
            db.session.remove()


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


def _issue_reset(user, raw_secret="reset-secret-token", channel=InvitationChannel.EMAIL):
    reset = PasswordResetToken(
        user_id=user.id,
        token_hash=hash_invite_secret(raw_secret),
        channel=channel,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    db.session.add(reset)
    db.session.flush()
    return reset, raw_secret


def test_reset_request_same_response_for_unknown_user(client):
    known = _active_user("known_reset@test.local", "+639170000100")
    db.session.flush()

    known_resp = client.post(
        "/api/v1/auth/password-reset/request",
        json={"identifier": known.email},
    )
    unknown_resp = client.post(
        "/api/v1/auth/password-reset/request",
        json={"identifier": "nobody@test.local"},
    )

    assert known_resp.status_code == 200
    assert unknown_resp.status_code == 200
    assert known_resp.get_json() == unknown_resp.get_json()


def test_reset_request_creates_token_for_active_user(client):
    user = _active_user("reset_active@test.local", "+639170000101")
    db.session.flush()

    response = client.post(
        "/api/v1/auth/password-reset/request",
        json={"identifier": user.email},
    )
    assert response.status_code == 200

    tokens = PasswordResetToken.query.filter_by(user_id=user.id).all()
    assert len(tokens) == 1
    assert tokens[0].is_active


def test_reset_request_ignored_for_invited_user(client):
    db.session.add(
        User(
            email="invited_reset@test.local",
            mobile_number="+639170000102",
            password_hash=None,
            full_name="Invited",
            role=UserRole.OFFICE_STAFF,
            status=UserStatus.INVITED,
            active=False,
        )
    )
    db.session.flush()

    response = client.post(
        "/api/v1/auth/password-reset/request",
        json={"identifier": "invited_reset@test.local"},
    )
    assert response.status_code == 200
    assert PasswordResetToken.query.count() == 0


def test_validate_and_confirm_reset(client):
    user = _active_user("reset_flow@test.local", "+639170000103", password="Oldpass1!")
    _, raw = _issue_reset(user)
    db.session.flush()

    validate = client.post(
        "/api/v1/auth/password-reset/validate",
        json={"token": raw},
    )
    assert validate.status_code == 200
    assert validate.get_json()["valid"] is True

    confirm = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={
            "token": raw,
            "password": "Newpass1!",
            "passwordConfirm": "Newpass1!",
        },
    )
    assert confirm.status_code == 200
    assert confirm.get_json()["user"]["email"] == user.email

    login_old = client.post(
        "/api/v1/auth/login",
        json={"identifier": user.email, "password": "Oldpass1!"},
    )
    assert login_old.status_code == 401

    login_new = client.post(
        "/api/v1/auth/login",
        json={"identifier": user.email, "password": "Newpass1!"},
    )
    assert login_new.status_code == 200


def test_expired_reset_rejected(client):
    user = _active_user("reset_expired@test.local", "+639170000104")
    reset, raw = _issue_reset(user)
    reset.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.session.flush()

    response = client.post(
        "/api/v1/auth/password-reset/validate",
        json={"token": raw},
    )
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "RESET_EXPIRED"


def test_reset_revokes_device_pins(client):
    user = _active_user("reset_pin@test.local", "+639170000105", password="Oldpass1!")
    device_id = "reset-device-1"
    register_device_after_password_login(user, device_id, "Phone")
    set_device_pin(user, device_id, "482917", "Phone")
    _, raw = _issue_reset(user)
    db.session.flush()

    confirm = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={
            "token": raw,
            "password": "Newpass1!",
            "passwordConfirm": "Newpass1!",
        },
    )
    assert confirm.status_code == 200

    pin_unlock = client.post(
        "/api/v1/auth/pin/unlock",
        json={"deviceId": device_id, "pin": "482917"},
    )
    assert pin_unlock.status_code == 401
