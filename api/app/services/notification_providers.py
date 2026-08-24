"""Notification provider abstraction and concrete implementations."""

from __future__ import annotations

import logging
import smtplib
from abc import ABC, abstractmethod
from email.message import EmailMessage
from typing import Optional
from urllib import error, parse, request

logger = logging.getLogger(__name__)


class NotificationProvider(ABC):
    """Interface: send(recipient, body)."""

    name: str = "base"

    @abstractmethod
    def send(self, recipient: str, body: str, subject: str | None = None) -> None:
        """Raise on failure; return None on success."""


class ConsoleProvider(NotificationProvider):
    """Default: log instead of sending. Works with no credentials."""

    name = "console"

    def send(self, recipient: str, body: str, subject: str | None = None) -> None:
        logger.info(
            "[CONSOLE notification] to=%s subject=%s body=%s",
            recipient,
            subject or "(none)",
            body,
        )
        print(f"[CONSOLE notification] to={recipient} subject={subject or ''} body={body}")


class SmtpEmailProvider(NotificationProvider):
    name = "smtp"

    def __init__(
        self,
        host: str,
        port: int,
        username: Optional[str],
        password: Optional[str],
        from_addr: str,
        use_tls: bool = True,
    ):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.from_addr = from_addr
        self.use_tls = use_tls

    def send(self, recipient: str, body: str, subject: str | None = None) -> None:
        msg = EmailMessage()
        msg["Subject"] = subject or "Brothers Machine Shop — job update"
        msg["From"] = self.from_addr
        msg["To"] = recipient
        msg.set_content(body)
        with smtplib.SMTP(self.host, self.port, timeout=20) as smtp:
            if self.use_tls:
                smtp.starttls()
            if self.username and self.password:
                smtp.login(self.username, self.password)
            smtp.send_message(msg)


class SemaphoreSmsProvider(NotificationProvider):
    """Philippine SMS gateway (Semaphore) — HTTP POST to api.semaphore.co."""

    name = "semaphore"

    def __init__(self, api_key: str, sender_name: Optional[str] = None):
        self.api_key = api_key
        self.sender_name = sender_name

    def send(self, recipient: str, body: str, subject: str | None = None) -> None:
        payload = {
            "apikey": self.api_key,
            "number": recipient,
            "message": body,
        }
        if self.sender_name:
            payload["sendername"] = self.sender_name
        data = parse.urlencode(payload).encode("utf-8")
        req = request.Request(
            "https://api.semaphore.co/api/v4/messages",
            data=data,
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        try:
            with request.urlopen(req, timeout=20) as resp:
                if resp.status >= 400:
                    raise RuntimeError(f"Semaphore HTTP {resp.status}")
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Semaphore HTTP {exc.code}: {detail}") from exc


class TwilioSmsProvider(NotificationProvider):
    """Twilio SMS stub shaped for PH numbers (E.164)."""

    name = "twilio"

    def __init__(self, account_sid: str, auth_token: str, from_number: str):
        self.account_sid = account_sid
        self.auth_token = auth_token
        self.from_number = from_number

    def send(self, recipient: str, body: str, subject: str | None = None) -> None:
        url = (
            f"https://api.twilio.com/2010-04-01/Accounts/"
            f"{self.account_sid}/Messages.json"
        )
        payload = parse.urlencode(
            {"To": recipient, "From": self.from_number, "Body": body}
        ).encode("utf-8")
        req = request.Request(url, data=payload, method="POST")
        import base64

        creds = base64.b64encode(
            f"{self.account_sid}:{self.auth_token}".encode("utf-8")
        ).decode("ascii")
        req.add_header("Authorization", f"Basic {creds}")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        try:
            with request.urlopen(req, timeout=20) as resp:
                if resp.status >= 400:
                    raise RuntimeError(f"Twilio HTTP {resp.status}")
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Twilio HTTP {exc.code}: {detail}") from exc


class StubSmsProvider(NotificationProvider):
    """
    SMS stub: logs like console but named for a PH gateway.
    Used when SMS provider is configured as stub or credentials missing.
    """

    name = "sms_stub"

    def send(self, recipient: str, body: str, subject: str | None = None) -> None:
        logger.info("[SMS STUB] to=%s body=%s", recipient, body)
        print(f"[SMS STUB] to={recipient} body={body}")


def build_email_provider(config: dict) -> tuple[NotificationProvider, bool]:
    """
    Returns (provider, used_console_fallback).
    Falls back to CONSOLE when SMTP credentials are absent.
    """
    preferred = (config.get("NOTIFICATION_EMAIL_PROVIDER") or "console").lower()
    if preferred == "smtp":
        host = config.get("SMTP_HOST") or ""
        from_addr = config.get("SMTP_FROM") or ""
        if host and from_addr:
            return (
                SmtpEmailProvider(
                    host=host,
                    port=int(config.get("SMTP_PORT") or 587),
                    username=config.get("SMTP_USER"),
                    password=config.get("SMTP_PASSWORD"),
                    from_addr=from_addr,
                    use_tls=str(config.get("SMTP_USE_TLS", "true")).lower()
                    in ("1", "true", "yes"),
                ),
                False,
            )
        logger.warning("SMTP selected but credentials missing; using CONSOLE")
        return ConsoleProvider(), True
    return ConsoleProvider(), preferred != "console"


def build_sms_provider(config: dict) -> tuple[NotificationProvider, bool]:
    """
    Returns (provider, used_console_fallback).
    Semaphore / Twilio when credentials present; else stub/console.
    """
    preferred = (config.get("NOTIFICATION_SMS_PROVIDER") or "console").lower()
    if preferred == "semaphore":
        key = config.get("SEMAPHORE_API_KEY") or ""
        if key:
            return (
                SemaphoreSmsProvider(key, config.get("SEMAPHORE_SENDER")),
                False,
            )
        logger.warning("Semaphore selected but API key missing; using SMS stub")
        return StubSmsProvider(), True
    if preferred == "twilio":
        sid = config.get("TWILIO_ACCOUNT_SID") or ""
        token = config.get("TWILIO_AUTH_TOKEN") or ""
        from_num = config.get("TWILIO_FROM") or ""
        if sid and token and from_num:
            return TwilioSmsProvider(sid, token, from_num), False
        logger.warning("Twilio selected but credentials missing; using SMS stub")
        return StubSmsProvider(), True
    if preferred == "stub":
        return StubSmsProvider(), False
    return ConsoleProvider(), preferred != "console"
