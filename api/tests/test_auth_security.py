"""Security: console invite redaction + auth rate limits.

Runs against local DATABASE_URL (bmsc) inside a rolled-back session.
"""

import pytest

from app import create_app
from app.config import Config
from app.extensions import bcrypt, db, limiter
from app.models.user import User, UserRole, UserStatus
from app.models.user_security import InvitationChannel
from app.models.worker_profile import WorkerProfile
from app.services.invitation_service import create_invited_user
from app.services.notification_providers import ConsoleProvider, StubSmsProvider


class LocalTxnConfig(Config):
    TESTING = True
    ENV = "production"
    DEBUG = False
    RATELIMIT_ENABLED = False
    RATELIMIT_STORAGE_URI = "memory://"


class RateLimitConfig(LocalTxnConfig):
    RATELIMIT_ENABLED = True
    AUTH_RATE_LIMIT_LOGIN = "3 per minute"
    AUTH_RATE_LIMIT_PIN_UNLOCK = "3 per minute"
    AUTH_RATE_LIMIT_INVITE_VALIDATE = "3 per minute"
    AUTH_RATE_LIMIT_INVITE_ACCEPT = "3 per minute"


@pytest.fixture
def app():
    return create_app(LocalTxnConfig)


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def db_txn(app, monkeypatch):
    with app.app_context():
        monkeypatch.setattr(db.session, "commit", db.session.flush)
        try:
            yield
        finally:
            db.session.rollback()
            db.session.remove()


def _admin():
    admin = User(
        email="sec_admin@test.local",
        mobile_number="+639170000101",
        password_hash=bcrypt.generate_password_hash("Admin123!").decode("utf-8"),
        full_name="Admin",
        role=UserRole.ADMIN,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(admin)
    db.session.flush()
    return admin


def test_console_provider_redacts_body_outside_development(app, db_txn, capsys, caplog):
    secret = "super-secret-invite-token-xyz"
    body = (
        f"Set your password: http://localhost:5173/set-password?token={secret}\n"
        f"BMSC invite code: {secret}."
    )
    assert app.config["ENV"] == "production"
    ConsoleProvider().send("worker@test.local", body, subject="Invite")

    captured = capsys.readouterr().out
    assert secret not in captured
    assert "body=[redacted]" in captured
    assert "worker@test.local" in captured
    assert secret not in caplog.text


def test_console_provider_shows_body_in_development(capsys):
    class DevConfig(LocalTxnConfig):
        ENV = "development"

    dev_app = create_app(DevConfig)
    secret = "dev-only-visible-token-abc"
    body = f"Link: http://localhost:5173/set-password?token={secret}"
    with dev_app.app_context():
        ConsoleProvider().send("dev@test.local", body, subject="Invite")

    captured = capsys.readouterr().out
    assert secret in captured


def test_invitation_delivery_logs_channel_without_secret(app, db_txn, caplog, capsys):
    import logging

    admin = _admin()
    with caplog.at_level(logging.INFO, logger="app.services.invitation_service"):
        user, invitation, raw_secret = create_invited_user(
            email="sec_invitee@test.local",
            mobile_number="+639170000102",
            full_name="Invitee",
            role=UserRole.PRODUCTION_WORKER,
            channel=InvitationChannel.EMAIL,
            created_by_id=admin.id,
        )
    assert raw_secret
    assert invitation.channel == InvitationChannel.EMAIL

    captured = capsys.readouterr().out
    log_text = caplog.text + captured
    assert raw_secret not in log_text
    assert "Invitation sent" in caplog.text
    assert "sec_invitee@test.local" in caplog.text
    assert "EMAIL" in caplog.text
    assert "provider=console" in caplog.text


def test_sms_stub_redacts_outside_development(app, db_txn, capsys):
    secret = "sms-code-999888"
    StubSmsProvider().send("+639171111111", f"BMSC invite code: {secret}. Done.")
    out = capsys.readouterr().out
    assert secret not in out
    assert "body=[redacted]" in out


@pytest.fixture
def rate_app(monkeypatch):
    application = create_app(RateLimitConfig)
    ctx = application.app_context()
    ctx.push()
    monkeypatch.setattr(db.session, "commit", db.session.flush)
    limiter.reset()
    try:
        yield application
    finally:
        db.session.rollback()
        db.session.remove()
        ctx.pop()


@pytest.fixture
def rate_client(rate_app):
    return rate_app.test_client()


def test_login_rate_limit_returns_clear_429(rate_client):
    user = User(
        email="rate_user@test.local",
        mobile_number="+639170000103",
        password_hash=bcrypt.generate_password_hash("Worker123!").decode("utf-8"),
        full_name="Rate User",
        role=UserRole.PRODUCTION_WORKER,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    db.session.flush()
    db.session.add(WorkerProfile(user_id=user.id))
    db.session.flush()
    limiter.reset()

    payload = {"identifier": "rate_user@test.local", "password": "wrong"}
    statuses = [
        rate_client.post("/api/v1/auth/login", json=payload).status_code for _ in range(4)
    ]
    assert statuses[:3] == [401, 401, 401]
    assert statuses[3] == 429
    err = rate_client.post("/api/v1/auth/login", json=payload).get_json()["error"]
    assert err["code"] == "RATE_LIMIT_EXCEEDED"
    assert "login" in err["message"].lower()


def test_pin_unlock_rate_limit_returns_clear_429(rate_client):
    limiter.reset()
    payload = {"deviceId": "missing-device", "pin": "123456"}
    statuses = [
        rate_client.post("/api/v1/auth/pin/unlock", json=payload).status_code
        for _ in range(4)
    ]
    assert all(s == 401 for s in statuses[:3])
    assert statuses[3] == 429
    err = rate_client.post("/api/v1/auth/pin/unlock", json=payload).get_json()["error"]
    assert err["code"] == "RATE_LIMIT_EXCEEDED"
    assert "pin" in err["message"].lower()


def test_invitation_validate_rate_limit_returns_clear_429(rate_client):
    limiter.reset()
    payload = {"token": "not-a-real-token", "identifier": "x@test.local"}
    statuses = [
        rate_client.post("/api/v1/auth/invitation/validate", json=payload).status_code
        for _ in range(4)
    ]
    assert all(s == 400 for s in statuses[:3])
    assert statuses[3] == 429
    err = rate_client.post(
        "/api/v1/auth/invitation/validate", json=payload
    ).get_json()["error"]
    assert err["code"] == "RATE_LIMIT_EXCEEDED"
    assert "invitation" in err["message"].lower()


def test_invitation_accept_rate_limit_returns_clear_429(rate_client):
    limiter.reset()
    payload = {
        "token": "not-a-real-token",
        "identifier": "x@test.local",
        "password": "Worker123!",
        "passwordConfirm": "Worker123!",
    }
    statuses = [
        rate_client.post("/api/v1/auth/invitation/accept", json=payload).status_code
        for _ in range(4)
    ]
    assert all(s == 400 for s in statuses[:3])
    assert statuses[3] == 429
    err = rate_client.post(
        "/api/v1/auth/invitation/accept", json=payload
    ).get_json()["error"]
    assert err["code"] == "RATE_LIMIT_EXCEEDED"
    assert "invitation" in err["message"].lower()


def test_non_auth_routes_not_rate_limited_by_default(rate_client):
    user = User(
        email="rate_admin@test.local",
        mobile_number="+639170000104",
        password_hash=bcrypt.generate_password_hash("Admin123!").decode("utf-8"),
        full_name="Rate Admin",
        role=UserRole.ADMIN,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    db.session.flush()
    limiter.reset()

    login = rate_client.post(
        "/api/v1/auth/login",
        json={"identifier": "rate_admin@test.local", "password": "Admin123!"},
    )
    assert login.status_code == 200
    token = login.get_json()["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}

    for _ in range(5):
        rate_client.post(
            "/api/v1/auth/login",
            json={"identifier": "rate_admin@test.local", "password": "wrong"},
        )

    for _ in range(6):
        resp = rate_client.get("/api/v1/job-orders", headers=headers)
        assert resp.status_code == 200


class UnreachableRedisConfig(LocalTxnConfig):
    """Rate limiting enabled but storage points at a closed Redis port."""

    RATELIMIT_ENABLED = True
    RATELIMIT_STORAGE_URI = "redis://127.0.0.1:1/0"
    AUTH_RATE_LIMIT_LOGIN = "10 per minute"


def test_login_succeeds_when_ratelimit_redis_unreachable(monkeypatch):
    application = create_app(UnreachableRedisConfig)
    ctx = application.app_context()
    ctx.push()
    monkeypatch.setattr(db.session, "commit", db.session.flush)
    try:
        assert application.config["RATELIMIT_STORAGE_URI"] == "memory://"

        user = User(
            email="failover_user@test.local",
            mobile_number="+639170000105",
            password_hash=bcrypt.generate_password_hash("Worker123!").decode("utf-8"),
            full_name="Failover User",
            role=UserRole.PRODUCTION_WORKER,
            status=UserStatus.ACTIVE,
            active=True,
        )
        db.session.add(user)
        db.session.flush()
        db.session.add(WorkerProfile(user_id=user.id))
        db.session.flush()

        client = application.test_client()
        limiter.reset()
        resp = client.post(
            "/api/v1/auth/login",
            json={"identifier": "failover_user@test.local", "password": "Worker123!"},
        )
        assert resp.status_code == 200, resp.get_json()
        assert resp.get_json().get("accessToken")
    finally:
        db.session.rollback()
        db.session.remove()
        ctx.pop()


def test_resolve_ratelimit_storage_defaults_to_memory_not_redis_url():
    from app.extensions import resolve_ratelimit_storage_uri

    class NoRedisConfig(LocalTxnConfig):
        REDIS_URL = None
        RATELIMIT_STORAGE_URI = "memory://"

    application = create_app(NoRedisConfig)
    with application.app_context():
        assert application.config["RATELIMIT_STORAGE_URI"] == "memory://"
        # Even if REDIS_URL were set, rate-limit URI must not auto-adopt it.
        application.config["REDIS_URL"] = "redis://127.0.0.1:6379/0"
        application.config["RATELIMIT_STORAGE_URI"] = "memory://"
        assert resolve_ratelimit_storage_uri(application) == "memory://"
