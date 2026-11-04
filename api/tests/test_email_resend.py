"""Resend backend (mocked HTTP): payload, reply-to, errors, and selection by EMAIL_BACKEND."""

import pytest

from app.services import email_backends as eb


class FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


def test_send_posts_branded_from_and_both_parts(monkeypatch):
    calls = []

    def fake_post(url, **kwargs):
        calls.append((url, kwargs))
        return FakeResponse(200, {"id": "msg-1"})

    monkeypatch.setattr(eb.requests, "post", fake_post)
    backend = eb.ResendBackend("re_test_key", "noreply@shop.example", reply_to="office@shop.example")
    assert backend.send("client@example.com", "Hello\r\nBcc: x@y.z", "plain", "<p>html</p>") == "msg-1"

    url, kwargs = calls[0]
    assert url == eb.RESEND_SEND_URL
    assert kwargs["headers"]["Authorization"] == "Bearer re_test_key"
    body = kwargs["json"]
    assert body["from"].endswith("<noreply@shop.example>")
    assert body["to"] == ["client@example.com"]
    assert "\n" not in body["subject"] and "\r" not in body["subject"]
    assert body["html"] == "<p>html</p>" and body["text"] == "plain"
    assert body["reply_to"] == "office@shop.example"


def test_send_raises_with_provider_message(monkeypatch):
    monkeypatch.setattr(
        eb.requests, "post", lambda url, **kw: FakeResponse(403, {"message": "The domain is not verified"})
    )
    with pytest.raises(RuntimeError, match="not verified"):
        eb.ResendBackend("re_x", "noreply@shop.example").send("a@b.c", "s", "t", "<p>h</p>")


def test_backend_selected_and_requires_key():
    backend = eb.get_email_backend(
        {"EMAIL_BACKEND": "resend", "RESEND_API_KEY": "re_x", "MAIL_FROM": "noreply@shop.example"}
    )
    assert isinstance(backend, eb.ResendBackend)
    with pytest.raises(RuntimeError, match="RESEND_API_KEY"):
        eb.get_email_backend({"EMAIL_BACKEND": "resend", "MAIL_FROM": "noreply@shop.example"})
