"""Email header CR/LF stripping (M-03)."""

from app.services.email_backends import build_message, sanitize_header_value


def test_sanitize_header_strips_crlf():
    assert sanitize_header_value("Hello\r\nBcc: evil@x.com") == "HelloBcc: evil@x.com"
    assert "\n" not in sanitize_header_value("a\nb")
    assert "\r" not in sanitize_header_value("a\rb")


def test_build_message_strips_injected_headers():
    msg = build_message(
        "Shop <shop@example.com>",
        "client@example.com\nCc: attacker@evil.com",
        "Job JO-1\r\nBcc: attacker@evil.com",
        "body",
        "<p>body</p>",
    )
    # Newlines are stripped before headers are set — no injected header lines.
    assert "\n" not in (msg["To"] or "")
    assert "\r" not in (msg["To"] or "")
    assert "\n" not in (msg["Subject"] or "")
    assert "\r" not in (msg["Subject"] or "")
    assert "attacker@evil.com" in (msg["Subject"] or "")
    assert list(msg.keys()).count("Bcc") == 0
    assert list(msg.keys()).count("Cc") == 0
    raw = msg.as_string()
    assert "\nCc:" not in raw and "\nBcc:" not in raw
