"""Outbound email backends, chosen by EMAIL_BACKEND: gmail_api | smtp | console.

Each backend's send() returns the provider's message id (or None) and raises on
failure. Callers go through notification_service, which applies the on/off
switch and allowlist and writes the notification log.
"""

from __future__ import annotations

import base64
import logging
import smtplib
import threading
import time
from abc import ABC, abstractmethod
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from pathlib import Path

import requests

from app.services.email_templates import (
    EMAIL_LOGO_CID,
    SHOP_DISPLAY_NAME,
    extract_email_address,
    format_from_header,
)

# Bundled shop mark for multipart/related (Gmail shows without remote load).
_EMAIL_LOGO_PATH = Path(__file__).resolve().parents[1] / "assets" / "email_logo.png"
_logo_bytes_cache: bytes | None = None


def _email_logo_bytes() -> bytes | None:
    global _logo_bytes_cache
    if _logo_bytes_cache is not None:
        return _logo_bytes_cache
    try:
        _logo_bytes_cache = _EMAIL_LOGO_PATH.read_bytes()
    except OSError:
        logger.warning("Email logo missing at %s; HTML will reference cid without attachment", _EMAIL_LOGO_PATH)
        return None
    return _logo_bytes_cache

logger = logging.getLogger(__name__)

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile"
HTTP_TIMEOUT = 10
TOKEN_EXPIRY_MARGIN = 60
EXPIRED_REFRESH_TOKEN = "Gmail refresh token expired or revoked - generate a new one"


def is_development_environment(config=None) -> bool:
    """True only when ENV/FLASK_ENV is explicitly development. DEBUG alone does
    not count: message bodies (sign-in links, codes) must never reach production logs."""
    if config is None:
        from flask import current_app, has_app_context

        config = current_app.config if has_app_context() else {}
    env = str(config.get("ENV") or config.get("FLASK_ENV") or "").lower()
    return env in ("development", "dev")


def sanitize_header_value(value: str | None) -> str:
    """Strip CR/LF (and other control chars) so user text cannot inject headers."""
    if value is None:
        return ""
    text = str(value)
    return "".join(ch for ch in text if ch not in "\r\n\x00").strip()


def build_message(
    from_addr: str,
    to: str,
    subject: str,
    text: str,
    html_body: str,
    *,
    reply_to: str | None = None,
):
    """multipart/alternative with Date, Message-ID, Reply-To, UTF-8 parts."""
    addr = extract_email_address(from_addr) or from_addr
    domain = addr.split("@", 1)[-1] if "@" in (addr or "") else "localhost"
    from_header = sanitize_header_value(format_from_header(from_addr, SHOP_DISPLAY_NAME))
    to_header = sanitize_header_value(to)
    subject_header = sanitize_header_value(subject)

    msg = EmailMessage()
    msg["From"] = from_header
    msg["To"] = to_header
    msg["Subject"] = subject_header
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=domain)
    msg["MIME-Version"] = "1.0"
    reply = sanitize_header_value(reply_to) or from_header
    msg["Reply-To"] = reply

    msg.set_content(text or "", charset="utf-8")
    msg.add_alternative(html_body or text or "", subtype="html", charset="utf-8")

    # Attach logo under the HTML part so MIME is multipart/related (cid: works in Gmail).
    logo = _email_logo_bytes()
    if logo:
        html_part = msg.get_payload()[-1]
        html_part.add_related(
            logo,
            maintype="image",
            subtype="png",
            cid=EMAIL_LOGO_CID,
            filename="bmsc-logo.png",
            disposition="inline",
        )
    return msg


class EmailBackend(ABC):
    name = "base"
    delivers = True

    @abstractmethod
    def send(self, to: str, subject: str, text: str, html_body: str | None = None) -> str | None:
        """Send one message. Return the provider message id; raise on failure."""


class ConsoleEmailBackend(EmailBackend):
    """Logs the message instead of sending it. The body is only shown in
    development because invitation and reset emails carry sign-in links."""

    name = "console"
    delivers = False

    def send(self, to, subject, text, html_body=None):
        from app.utils.log_mask import mask_email, mask_sensitive

        safe_to = mask_email(to)
        safe_subject = mask_sensitive(subject)
        if is_development_environment():
            shown = text or ""
            logger.info("[CONSOLE email] to=%s subject=%s body=%s", safe_to, safe_subject, shown)
            print(f"[CONSOLE email] to={safe_to} subject={safe_subject} body={shown}")
        else:
            # Production: never print bodies (links/tokens).
            logger.info("[CONSOLE email] to=%s subject=%s body=[hidden outside development]", safe_to, safe_subject)
        return None


class SmtpEmailBackend(EmailBackend):
    """STARTTLS SMTP for local development only."""

    name = "smtp"

    def __init__(self, host, port, username, password, from_addr, use_tls=True, reply_to=None):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.from_addr = from_addr
        self.use_tls = use_tls
        self.reply_to = reply_to

    def send(self, to, subject, text, html_body=None):
        if not html_body:
            raise ValueError("html_body is required for multipart email")
        msg = build_message(
            self.from_addr, to, subject, text, html_body, reply_to=self.reply_to
        )
        with smtplib.SMTP(self.host, self.port, timeout=HTTP_TIMEOUT) as smtp:
            if self.use_tls:
                smtp.starttls()
            if self.username and self.password:
                smtp.login(self.username, self.password)
            smtp.send_message(msg)
        return None


class GmailAuthError(RuntimeError):
    pass


_token_lock = threading.Lock()
_token_cache: dict[str, tuple[str, float]] = {}


def clear_token_cache() -> None:
    with _token_lock:
        _token_cache.clear()


def _error_code(resp) -> str:
    try:
        data = resp.json()
    except ValueError:
        return ""
    err = data.get("error")
    if isinstance(err, dict):
        return str(err.get("message") or err.get("status") or "")
    return str(err or "")


class GmailApiBackend(EmailBackend):
    """Gmail API over HTTPS with an OAuth refresh token (no SMTP)."""

    name = "gmail_api"

    def __init__(self, client_id, client_secret, refresh_token, from_addr, reply_to=None):
        self.client_id = client_id
        self.client_secret = client_secret
        self.refresh_token = refresh_token
        self.from_addr = from_addr
        self.reply_to = reply_to

    def _fetch_token(self) -> str:
        resp = requests.post(
            GOOGLE_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "refresh_token": self.refresh_token,
            },
            timeout=HTTP_TIMEOUT,
        )
        if resp.status_code != 200:
            code = _error_code(resp)
            if code == "invalid_grant":
                logger.error(EXPIRED_REFRESH_TOKEN)
                raise GmailAuthError(EXPIRED_REFRESH_TOKEN)
            raise GmailAuthError(f"Gmail token request failed: HTTP {resp.status_code} {code}".strip())
        data = resp.json()
        token = data["access_token"]
        lifetime = int(data.get("expires_in") or 3600)
        with _token_lock:
            _token_cache[self.client_id] = (token, time.monotonic() + max(lifetime - TOKEN_EXPIRY_MARGIN, 0))
        return token

    def _access_token(self, *, force_refresh=False) -> str:
        if not force_refresh:
            with _token_lock:
                cached = _token_cache.get(self.client_id)
            if cached and cached[1] > time.monotonic():
                return cached[0]
        return self._fetch_token()

    def send(self, to, subject, text, html_body=None):
        if not html_body:
            raise ValueError("html_body is required for multipart email")
        msg = build_message(
            self.from_addr, to, subject, text, html_body, reply_to=self.reply_to
        )
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")
        for attempt in (1, 2):
            token = self._access_token(force_refresh=attempt == 2)
            resp = requests.post(
                GMAIL_SEND_URL,
                json={"raw": raw},
                headers={"Authorization": f"Bearer {token}"},
                timeout=HTTP_TIMEOUT,
            )
            if resp.status_code == 401 and attempt == 1:
                continue
            if resp.status_code >= 400:
                raise RuntimeError(f"Gmail send failed: HTTP {resp.status_code} {_error_code(resp)}".strip())
            return resp.json().get("id")
        return None


def warn_if_mail_from_mismatch(config) -> None:
    """Log if MAIL_FROM address != Gmail OAuth account (no secrets in the log)."""
    if str(config.get("EMAIL_BACKEND") or "").strip().lower() != "gmail_api":
        return
    mail_from = config.get("MAIL_FROM")
    addr = extract_email_address(mail_from)
    if not addr:
        logger.warning(
            "MAIL_FROM is missing or not a valid email; Gmail may reject or rewrite From"
        )
        return
    needed = ("GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN")
    if any(not config.get(k) for k in needed):
        return
    try:
        backend = GmailApiBackend(
            config["GMAIL_CLIENT_ID"],
            config["GMAIL_CLIENT_SECRET"],
            config["GMAIL_REFRESH_TOKEN"],
            mail_from,
        )
        token = backend._access_token()
        resp = requests.get(
            GMAIL_PROFILE_URL,
            headers={"Authorization": f"Bearer {token}"},
            timeout=HTTP_TIMEOUT,
        )
        if resp.status_code == 403:
            logger.warning(
                "Could not verify MAIL_FROM against the Gmail OAuth account "
                "(token lacks gmail.readonly / profile scope). "
                "Ensure MAIL_FROM is the same Gmail address used for the refresh token."
            )
            return
        if resp.status_code >= 400:
            logger.warning(
                "Could not verify MAIL_FROM against Gmail (HTTP %s). "
                "Ensure MAIL_FROM matches the OAuth Gmail account.",
                resp.status_code,
            )
            return
        gmail_addr = (resp.json().get("emailAddress") or "").strip().lower()
        if gmail_addr and gmail_addr != addr.lower():
            logger.warning(
                "MAIL_FROM does not match the authenticated Gmail account. "
                "Set MAIL_FROM to that Gmail address (display name is added automatically). "
                "Mismatch often causes spam or delivery failure."
            )
        elif gmail_addr:
            logger.info("MAIL_FROM matches the authenticated Gmail account")
    except Exception:  # noqa: BLE001
        logger.warning(
            "Could not verify MAIL_FROM against Gmail at startup",
            exc_info=is_development_environment(config),
        )


def get_email_backend(config) -> EmailBackend:
    choice = str(config.get("EMAIL_BACKEND") or "console").strip().lower()
    reply_to = config.get("MAIL_REPLY_TO") or None
    if choice == "gmail_api":
        needed = ("GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "MAIL_FROM")
        missing = [name for name in needed if not config.get(name)]
        if missing:
            raise RuntimeError("EMAIL_BACKEND is gmail_api but these are not set: " + ", ".join(missing))
        return GmailApiBackend(
            config["GMAIL_CLIENT_ID"],
            config["GMAIL_CLIENT_SECRET"],
            config["GMAIL_REFRESH_TOKEN"],
            config["MAIL_FROM"],
            reply_to=reply_to,
        )
    if choice == "smtp":
        missing = [name for name in ("SMTP_HOST", "MAIL_FROM") if not config.get(name)]
        if missing:
            raise RuntimeError("EMAIL_BACKEND is smtp but these are not set: " + ", ".join(missing))
        return SmtpEmailBackend(
            host=config["SMTP_HOST"],
            port=int(config.get("SMTP_PORT") or 587),
            username=config.get("SMTP_USER"),
            password=config.get("SMTP_PASSWORD"),
            from_addr=config["MAIL_FROM"],
            use_tls=str(config.get("SMTP_USE_TLS", "true")).lower() in ("1", "true", "yes"),
            reply_to=reply_to,
        )
    if choice != "console":
        logger.warning("Unknown EMAIL_BACKEND %r; using console", choice)
    return ConsoleEmailBackend()
