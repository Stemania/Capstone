"""send_notification rules: on/off switch, allowlist, one log row per attempt,
and a failed notification never breaks the user's action."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app import create_app
from app.config import TestConfig
from app.extensions import bcrypt, db
from app.models.notification import NotificationChannel, NotificationLog, NotificationStatus
from app.models.user import User, UserRole, UserStatus
from app.services import notification_service as svc


class Backend:
    name = "fake"
    delivers = True

    def __init__(self, fail=False):
        self.fail = fail
        self.sent = []

    def send(self, to, *parts):
        if self.fail:
            raise RuntimeError("smtp exploded")
        self.sent.append((to, parts))
        return "provider-id-1"


def _make_app(**overrides):
    config = type("Cfg", (TestConfig,), {"NOTIFICATIONS_ENABLED": True, **overrides})
    return create_app(config)


@pytest.fixture
def fake_db(monkeypatch):
    rows = []
    session = MagicMock()
    session.add.side_effect = rows.append
    monkeypatch.setattr(svc, "db", SimpleNamespace(session=session))
    return SimpleNamespace(rows=rows, session=session)


@pytest.fixture
def backend(monkeypatch):
    b = Backend()
    monkeypatch.setattr(svc, "get_email_backend", lambda cfg: b)
    return b


def _email(to="boss@example.com", **kw):
    return svc.send_notification(
        channel=NotificationChannel.EMAIL, recipient=to, event="TEST", subject="Hi", body="Body", **kw
    )


def test_turned_off_by_default_logs_skipped_and_sends_nothing(fake_db, backend):
    with create_app(TestConfig).app_context():
        log = _email()

    assert backend.sent == []
    assert log.status == NotificationStatus.SKIPPED
    assert log.error_message == svc.TURNED_OFF
    assert fake_db.rows == [log]


def test_allowlist_blocks_everyone_else(fake_db, backend):
    app = _make_app(NOTIFY_ALLOWLIST=" Boss@Example.com , 0917 123 4567 ")
    with app.app_context():
        blocked = _email("stranger@example.com")
        allowed = _email("BOSS@example.com")
        sms_retired = svc.send_notification(
            channel=NotificationChannel.SMS, recipient="+639171234567", event="TEST", subject="", body="hi"
        )

    assert blocked.status == NotificationStatus.SKIPPED
    assert blocked.error_message == svc.NOT_ALLOWLISTED
    assert allowed.status == NotificationStatus.SENT
    assert allowed.recipient == "boss@example.com"
    assert allowed.provider_reference == "provider-id-1"
    assert sms_retired.status == NotificationStatus.SKIPPED
    assert sms_retired.error_message == svc.SMS_RETIRED
    assert [to for to, _ in backend.sent] == ["boss@example.com"]
    assert len(fake_db.rows) == 3


def test_empty_allowlist_sends_to_anyone(fake_db, backend):
    with _make_app().app_context():
        log = _email("anyone@example.com")
    assert log.status == NotificationStatus.SENT
    assert log.sent_at is not None


def test_backend_failure_is_logged_as_failed_not_raised(fake_db, monkeypatch):
    monkeypatch.setattr(svc, "get_email_backend", lambda cfg: Backend(fail=True))
    with _make_app().app_context():
        log = _email()
    assert log.status == NotificationStatus.FAILED
    assert "smtp exploded" in log.error_message


def test_misconfigured_backend_is_failed_with_variable_names(fake_db):
    with _make_app(EMAIL_BACKEND="gmail_api", MAIL_FROM="shop@example.com").app_context():
        log = _email()
    assert log.status == NotificationStatus.FAILED
    assert "GMAIL_CLIENT_ID" in log.error_message


def test_log_write_failure_returns_none_without_raising(fake_db, backend):
    fake_db.session.commit.side_effect = RuntimeError("db down")
    with _make_app().app_context():
        assert _email() is None
    fake_db.session.rollback.assert_called()


def test_sign_in_links_are_not_stored_in_the_log(fake_db, backend):
    with _make_app().app_context():
        log = _email(store_body=False)
    assert log.message_body == svc.BODY_NOT_STORED


def test_sms_channel_is_skipped_as_retired(fake_db, backend):
    with _make_app().app_context():
        log = svc.send_notification(
            channel=NotificationChannel.SMS,
            recipient="09171234567",
            event="TEST",
            subject="",
            body="Ready",
        )
    assert backend.sent == []
    assert log.status == NotificationStatus.SKIPPED
    assert log.error_message == svc.SMS_RETIRED


# --- Against the test database: the user's action survives a failing provider ---


class FailingBackend(Backend):
    def __init__(self):
        super().__init__(fail=True)


@pytest.fixture
def failing_enabled(app, monkeypatch):
    app.config.update(NOTIFICATIONS_ENABLED=True, NOTIFY_ALLOWLIST="")
    monkeypatch.setattr(svc, "get_email_backend", lambda cfg: FailingBackend())


def _user(email, role, mobile, password="Secret123!"):
    user = User(
        email=email,
        mobile_number=mobile,
        password_hash=bcrypt.generate_password_hash(password).decode("utf-8"),
        full_name=email.split("@")[0],
        role=role,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    db.session.commit()
    return user


def _token(client, email, password="Secret123!"):
    resp = client.post("/api/v1/auth/login", json={"identifier": email, "password": password})
    assert resp.status_code == 200, resp.get_json()
    return {"Authorization": f"Bearer {resp.get_json()['accessToken']}"}


def test_invite_succeeds_when_the_email_provider_fails(app, client, failing_enabled):
    _user("notify_admin@test.local", UserRole.ADMIN, "+639170000501")
    headers = _token(client, "notify_admin@test.local")

    resp = client.post(
        "/api/v1/users",
        headers=headers,
        json={
            "email": "new.worker@test.local",
            "fullName": "New Worker",
            "role": "PRODUCTION_WORKER",
            "mobileNumber": "09170000502",
            "inviteChannel": "EMAIL",
        },
    )

    assert resp.status_code == 201, resp.get_json()
    body = resp.get_json()
    assert User.query.filter_by(email="new.worker@test.local").one().status == UserStatus.INVITED
    assert body.get("setupUrl") and "/set-password?token=" in body["setupUrl"]
    log = NotificationLog.query.filter_by(event="INVITATION").one()
    assert log.status == NotificationStatus.FAILED
    assert log.recipient == "new.worker@test.local"
    assert "token=" not in log.message_body


def test_password_reset_request_succeeds_when_the_email_provider_fails(app, client, failing_enabled):
    _user("reset_me@test.local", UserRole.OFFICE_STAFF, "+639170000503")

    resp = client.post("/api/v1/auth/password-reset/request", json={"identifier": "reset_me@test.local"})

    assert resp.status_code == 200
    log = NotificationLog.query.filter_by(event="PASSWORD_RESET").one()
    assert log.status == NotificationStatus.FAILED


def test_admin_test_endpoint_returns_the_log_row(app, client, monkeypatch):
    _user("test_admin@test.local", UserRole.ADMIN, "+639170000504")
    headers = _token(client, "test_admin@test.local")

    off = client.post("/api/v1/admin/notifications/test", headers=headers, json={"channel": "email", "to": "me@example.com"})
    assert off.status_code == 200
    assert off.get_json()["status"] == "SKIPPED"
    assert off.get_json()["event"] == "TEST"

    app.config.update(NOTIFICATIONS_ENABLED=True, NOTIFY_ALLOWLIST="me@example.com")
    sender = Backend()
    monkeypatch.setattr(svc, "get_email_backend", lambda cfg: sender)
    sent = client.post("/api/v1/admin/notifications/test", headers=headers, json={"channel": "email", "to": "me@example.com"})
    body = sent.get_json()
    assert body["status"] == "SENT"
    assert body["providerReference"] == "provider-id-1"
    assert sender.sent[0][0] == "me@example.com"

    blocked = client.post("/api/v1/admin/notifications/test", headers=headers, json={"channel": "email", "to": "other@example.com"})
    assert blocked.get_json()["status"] == "SKIPPED"
    assert blocked.get_json()["errorMessage"] == svc.NOT_ALLOWLISTED

    bad = client.post("/api/v1/admin/notifications/test", headers=headers, json={"channel": "sms", "to": "09171234567"})
    assert bad.status_code == 400
    assert NotificationLog.query.filter_by(event="TEST").count() == 3


def test_admin_test_endpoint_is_admin_only(app, client):
    _user("office_only@test.local", UserRole.OFFICE_STAFF, "+639170000505")
    headers = _token(client, "office_only@test.local")
    resp = client.post("/api/v1/admin/notifications/test", headers=headers, json={"channel": "email", "to": "a@b.co"})
    assert resp.status_code == 403
