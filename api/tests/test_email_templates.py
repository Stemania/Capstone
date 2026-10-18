"""Branded multipart emails: HTML button links, headers, absolute https URLs."""

import email
import re

import pytest

from app.models.notification import NotificationMilestone
from app.services import email_backends as eb
from app.services.email_templates import (
    absolute_frontend_url,
    invitation_email,
    job_update_email_content,
    password_reset_email,
)
from app.services.email_templates import test_email as build_test_email


HTTPS_CFG = {
    "FRONTEND_URL": "https://app.example.com",
    "ENV": "production",
    "MAIL_FROM": "shop@example.com",
}


@pytest.fixture
def https_app(app, monkeypatch):
    app.config.update(HTTPS_CFG)
    return app


def _assert_multipart_message(msg, *, link_substr: str | None = None):
    assert msg.get_content_type() == "multipart/alternative"
    assert msg["From"].startswith("Brothers Machine Shop")
    assert "@" in msg["From"]
    assert msg.get("Date")
    assert msg.get("Message-ID")
    assert msg.get("MIME-Version") == "1.0"
    assert msg.get("Reply-To")
    parts = {
        p.get_content_type(): p.get_payload(decode=True).decode()
        for p in msg.walk()
        if not p.is_multipart()
    }
    assert "text/plain" in parts and "text/html" in parts
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
        parts = _assert_multipart_message(msg, link_substr=link)
        assert "Set your password" in parts["text/html"]
        assert "48 hours" in parts["text/plain"]
        assert "!!!" not in content.subject
        assert content.subject == content.subject  # no ALL CAPS subject


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
        _assert_multipart_message(msg, link_substr=link)
        assert "1 hour" in content.text


def test_admin_test_email_multipart(https_app):
    content = build_test_email()
    msg = eb.build_message(
        "shop@example.com",
        "admin@example.com",
        content.subject,
        content.text,
        content.html,
    )
    _assert_multipart_message(msg)
    assert "Production Scheduling System" in content.html


def test_job_update_emails_have_status_badge_no_amounts(https_app):
    for milestone in NotificationMilestone:
        content = job_update_email_content(milestone, "JO-2031-ABCD", "Conveyor roller")
        msg = eb.build_message(
            "shop@example.com",
            "client@example.com",
            content.subject,
            content.text,
            content.html,
        )
        parts = _assert_multipart_message(msg)
        assert "JO-2031-ABCD" in parts["text/html"]
        assert "₱" not in parts["text/html"]
        assert "amount" not in parts["text/html"].lower()
        assert "Brothers Machine Shop" in content.subject
        assert "!!!" not in content.subject
        assert not re.search(r"\bURGENT\b", content.subject, re.I)


def test_absolute_frontend_url_uses_config(https_app):
    with https_app.app_context():
        assert absolute_frontend_url("/x") == "https://app.example.com/x"
