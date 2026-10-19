"""Mask emails, phones, and tokens before they reach logs."""

from __future__ import annotations

import re

_EMAIL_RE = re.compile(r"(?i)\b([A-Z0-9._%+-])([A-Z0-9._%+-]*)@([A-Z0-9.-]+\.[A-Z]{2,})\b")
_PHONE_RE = re.compile(r"(?:\+?\d[\d\s\-()]{7,}\d)")
_TOKEN_RE = re.compile(
    r"(?i)\b(Bearer\s+)([A-Za-z0-9\-._~+/]+=*)|\b(eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)\b"
)


def mask_email(value: str | None) -> str:
    if not value:
        return ""
    text = str(value).strip()
    if "@" not in text:
        return text[:1] + "***" if text else ""
    local, _, domain = text.partition("@")
    if not local:
        return "***@" + domain
    return f"{local[0]}***@{domain}"


def mask_phone(value: str | None) -> str:
    if not value:
        return ""
    digits = re.sub(r"\D", "", str(value))
    if len(digits) < 4:
        return "***"
    return "*" * max(0, len(digits) - 4) + digits[-4:]


def mask_sensitive(text: str | None) -> str:
    """Redact emails, phones, and JWT-like tokens in a free-form string."""
    if text is None:
        return ""
    out = str(text)

    def _email(m: re.Match) -> str:
        return mask_email(m.group(0))

    out = _EMAIL_RE.sub(_email, out)

    def _phone(m: re.Match) -> str:
        return mask_phone(m.group(0))

    out = _PHONE_RE.sub(_phone, out)

    def _token(m: re.Match) -> str:
        if m.group(1):
            return f"{m.group(1)}***"
        return "eyJ***"

    out = _TOKEN_RE.sub(_token, out)
    return out
