"""Gmail API backend with mocked HTTP: token refresh, caching, send, 401 retry, invalid_grant."""

import base64
import email
import logging

import pytest

from app.services import email_backends as eb

CREDS = dict(
    client_id="client-id-123",
    client_secret="client-secret-value",
    refresh_token="refresh-token-value",
    from_addr="Brothers Machine Shop <shop@example.com>",
)


class FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


class FakeHttp:
    """Replays queued responses per URL and records every call."""

    def __init__(self, token=(), send=()):
        self.queues = {eb.GOOGLE_TOKEN_URL: list(token), eb.GMAIL_SEND_URL: list(send)}
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.queues[url].pop(0)

    def count(self, url):
        return sum(1 for called, _ in self.calls if called == url)


def _token(value="access-1", expires_in=3600):
    return FakeResponse(200, {"access_token": value, "expires_in": expires_in, "token_type": "Bearer"})


@pytest.fixture(autouse=True)
def _fresh_cache():
    eb.clear_token_cache()
    yield
    eb.clear_token_cache()


@pytest.fixture
def http(monkeypatch):
    def install(**queues):
        fake = FakeHttp(**queues)
        monkeypatch.setattr(eb.requests, "post", fake.post)
        return fake

    return install


def test_token_refresh_request_and_send_call(http):
    fake = http(token=[_token()], send=[FakeResponse(200, {"id": "gmail-msg-1"})])

    ref = eb.GmailApiBackend(**CREDS).send("client@example.com", "Job received", "Hello\n\nLine two")

    assert ref == "gmail-msg-1"
    (token_url, token_kw), (send_url, send_kw) = fake.calls
    assert token_url == eb.GOOGLE_TOKEN_URL
    assert token_kw["data"] == {
        "grant_type": "refresh_token",
        "client_id": "client-id-123",
        "client_secret": "client-secret-value",
        "refresh_token": "refresh-token-value",
    }
    assert token_kw["timeout"] == 10
    assert send_url == eb.GMAIL_SEND_URL
    assert send_kw["headers"] == {"Authorization": "Bearer access-1"}
    assert send_kw["timeout"] == 10

    msg = email.message_from_bytes(base64.urlsafe_b64decode(send_kw["json"]["raw"]))
    assert msg["From"] == CREDS["from_addr"]
    assert msg["To"] == "client@example.com"
    assert msg["Subject"] == "Job received"
    assert msg.get_content_type() == "multipart/alternative"
    parts = {p.get_content_type(): p.get_payload(decode=True).decode() for p in msg.walk() if not p.is_multipart()}
    assert "Line two" in parts["text/plain"]
    assert "<p>Hello</p>" in parts["text/html"]


def test_token_is_cached_until_shortly_before_expiry(http, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(eb.time, "monotonic", lambda: now[0])
    fake = http(
        token=[_token("access-1", 3600), _token("access-2", 3600)],
        send=[FakeResponse(200, {"id": str(i)}) for i in range(3)],
    )
    backend = eb.GmailApiBackend(**CREDS)

    backend.send("a@example.com", "s", "b")
    now[0] += 3600 - 61
    backend.send("a@example.com", "s", "b")
    assert fake.count(eb.GOOGLE_TOKEN_URL) == 1

    now[0] += 2  # inside the last 60 seconds: refresh
    backend.send("a@example.com", "s", "b")
    assert fake.count(eb.GOOGLE_TOKEN_URL) == 2
    assert fake.calls[-1][1]["headers"]["Authorization"] == "Bearer access-2"


def test_401_refreshes_the_token_once_and_retries(http):
    fake = http(
        token=[_token("stale"), _token("fresh")],
        send=[FakeResponse(401, {"error": {"message": "Invalid Credentials"}}), FakeResponse(200, {"id": "ok"})],
    )

    assert eb.GmailApiBackend(**CREDS).send("a@example.com", "s", "b") == "ok"
    assert fake.count(eb.GOOGLE_TOKEN_URL) == 2
    assert fake.count(eb.GMAIL_SEND_URL) == 2
    assert fake.calls[-1][1]["headers"]["Authorization"] == "Bearer fresh"


def test_second_401_fails_without_looping(http):
    fake = http(
        token=[_token("a"), _token("b")],
        send=[FakeResponse(401, {"error": {"message": "Invalid Credentials"}})] * 2,
    )

    with pytest.raises(RuntimeError, match="HTTP 401"):
        eb.GmailApiBackend(**CREDS).send("a@example.com", "s", "b")
    assert fake.count(eb.GMAIL_SEND_URL) == 2


def test_invalid_grant_logs_clear_message(http, caplog):
    http(token=[FakeResponse(400, {"error": "invalid_grant", "error_description": "Token has been expired or revoked."})])

    with caplog.at_level(logging.ERROR, logger="app.services.email_backends"):
        with pytest.raises(eb.GmailAuthError) as exc:
            eb.GmailApiBackend(**CREDS).send("a@example.com", "s", "b")

    assert str(exc.value) == "Gmail refresh token expired or revoked - generate a new one"
    assert "Gmail refresh token expired or revoked - generate a new one" in caplog.text


def test_errors_never_contain_secret_values(http, caplog):
    http(token=[FakeResponse(401, {"error": "invalid_client"})])

    with caplog.at_level(logging.DEBUG):
        with pytest.raises(eb.GmailAuthError) as exc:
            eb.GmailApiBackend(**CREDS).send("a@example.com", "s", "b")

    text = str(exc.value) + caplog.text
    for secret in ("client-secret-value", "refresh-token-value"):
        assert secret not in text
    assert "invalid_client" in str(exc.value)


def test_gmail_backend_lists_missing_variable_names_only():
    with pytest.raises(RuntimeError) as exc:
        eb.get_email_backend({"EMAIL_BACKEND": "gmail_api", "GMAIL_CLIENT_ID": "x", "GMAIL_REFRESH_TOKEN": "r"})
    assert "GMAIL_CLIENT_SECRET" in str(exc.value)
    assert "MAIL_FROM" in str(exc.value)
    assert "GMAIL_CLIENT_ID" not in str(exc.value)


def test_backend_selection_defaults_to_console():
    assert isinstance(eb.get_email_backend({}), eb.ConsoleEmailBackend)
    assert isinstance(eb.get_email_backend({"EMAIL_BACKEND": "nonsense"}), eb.ConsoleEmailBackend)
    gmail = eb.get_email_backend(
        {
            "EMAIL_BACKEND": "gmail_api",
            "GMAIL_CLIENT_ID": "id",
            "GMAIL_CLIENT_SECRET": "secret",
            "GMAIL_REFRESH_TOKEN": "refresh",
            "MAIL_FROM": "shop@example.com",
        }
    )
    assert isinstance(gmail, eb.GmailApiBackend)


def test_html_alternative_escapes_and_links():
    out = eb.text_to_html("Hi <b>&\n\nOpen https://example.com/set-password?token=abc now")
    assert "&lt;b&gt;&amp;" in out
    assert '<a href="https://example.com/set-password?token=abc">' in out
