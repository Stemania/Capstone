"""Branded multipart emails: HTML button links, headers, absolute https URLs."""

import re

import pytest

from app.models.notification import NotificationMilestone
from app.services import email_backends as eb
from app.services.email_templates import (
    SHOP_HEADER_NAME,
    absolute_frontend_url,
    email_logo_url,
    invitation_email,
    job_update_email_content,
    password_reset_email,
)
from app.services.email_templates import test_email as build_test_email


HTTPS_CFG = {
    "FRONTEND_URL": "https://app.example.com",
    "PUBLIC_APP_URL": "https://capstone-five-beta.vercel.app",
    "ENV": "production",
    "MAIL_FROM": "shop@example.com",
}


@pytest.fixture
def https_app(app, monkeypatch):
    app.config.update(HTTPS_CFG)
    return app


def _assert_multipart_message(msg, *, link_substr: str | None = None, logo_url: str | None = None):
    assert msg.get_content_type() == "multipart/alternative"
    assert msg["From"].startswith("Brothers Machine Shop")
    assert "@" in msg["From"]
    assert msg.get("Date")
    assert msg.get("Message-ID")
    assert msg.get("MIME-Version") == "1.0"
    assert msg.get("Reply-To")
    assert not any(p.get_content_type() == "multipart/related" for p in msg.walk())
    parts = {}
    for p in msg.walk():
        if p.is_multipart():
            continue
        ctype = p.get_content_type()
        assert not ctype.startswith("image/"), "logo must not be a MIME attachment"
        payload = p.get_payload(decode=True)
        parts[ctype] = payload.decode() if isinstance(payload, (bytes, bytearray)) else payload
    assert "text/plain" in parts and "text/html" in parts
    assert SHOP_HEADER_NAME in parts["text/html"]
    assert "BMSC logo" in parts["text/html"]
    assert "cid:" not in parts["text/html"]
    assert "cid:" not in parts["text/plain"]
    assert SHOP_HEADER_NAME not in parts["text/plain"]
    if logo_url:
        assert f'src="{logo_url}"' in parts["text/html"]
        assert 'alt="BMSC logo"' in parts["text/html"]
        assert 'width="48"' in parts["text/html"]
        assert 'height="48"' in parts["text/html"]
    if link_substr:
        assert link_substr in parts["text/plain"]
        assert f'href="{link_substr}"' in parts["text/html"] or f"href='{link_substr}'" in parts["text/html"]
        assert "<a href=" in parts["text/html"]
    return parts


def test_invitation_email_multipart_https_button(https_app):
    with https_app.app_context():
        link = absolute_frontend_url("/set-password?token=abc123")
        assert link.startswith("https://")
        content = invitation_email("Ada Lovelace", link)
        msg = eb.build_message(
            https_app.config["MAIL_FROM"],
            "ada@example.com",
            content.subject,
            content.text,
            content.html,
        )
        parts = _assert_multipart_message(msg, link_substr=link, logo_url=email_logo_url())
        assert "Set your password" in parts["text/html"]
        assert "48 hours" in parts["text/plain"]
        assert "!!!" not in content.subject


def test_password_reset_email_multipart_https_button(https_app):
    with https_app.app_context():
        link = absolute_frontend_url("/reset-password?token=xyz")
        content = password_reset_email("Ada", link)
        msg = eb.build_message(
            "Brothers Machine Shop <shop@example.com>",
            "ada@example.com",
            content.subject,
            content.text,
            content.html,
        )
        _assert_multipart_message(msg, link_substr=link, logo_url=email_logo_url())
        assert "1 hour" in content.text


def test_admin_test_email_multipart(https_app):
    with https_app.app_context():
        content = build_test_email()
        msg = eb.build_message(
            "shop@example.com",
            "admin@example.com",
            content.subject,
            content.text,
            content.html,
        )
        parts = _assert_multipart_message(msg, logo_url=email_logo_url())
        assert "Production Scheduling System" in parts["text/html"]
        assert SHOP_HEADER_NAME in parts["text/html"]
        assert "Brothers Machine Shop" in content.text
        assert SHOP_HEADER_NAME not in content.text
        assert "https://capstone-five-beta.vercel.app/email-logo.png" in parts["text/html"]


def test_job_update_emails_have_status_badge_no_amounts(https_app):
    with https_app.app_context():
        for milestone in NotificationMilestone:
            content = job_update_email_content(milestone, "JO-2031-ABCD", "Conveyor roller")
            msg = eb.build_message(
                "shop@example.com",
                "client@example.com",
                content.subject,
                content.text,
                content.html,
            )
            parts = _assert_multipart_message(msg, logo_url=email_logo_url())
            assert "JO-2031-ABCD" in parts["text/html"]
            assert "₱" not in parts["text/html"]
            assert "amount" not in parts["text/html"].lower()
            assert "Brothers Machine Shop" in content.subject
            assert "!!!" not in content.subject
            assert not re.search(r"\bURGENT\b", content.subject, re.I)


def test_absolute_frontend_url_uses_config(https_app):
    with https_app.app_context():
        assert absolute_frontend_url("/x") == "https://app.example.com/x"


def test_email_logo_url_uses_public_app_url(https_app):
    with https_app.app_context():
        assert email_logo_url() == "https://capstone-five-beta.vercel.app/email-logo.png"
        https_app.config["PUBLIC_APP_URL"] = "https://cdn.example.com/"
        assert email_logo_url() == "https://cdn.example.com/email-logo.png"
