"""Every outbound email/SMS goes through send_notification.

Call it only after the business transaction has committed. It applies the
NOTIFICATIONS_ENABLED switch and NOTIFY_ALLOWLIST, sends through the configured
backend, writes exactly one notification_logs row, and never raises: a failed
notification must not fail or roll back the user's action.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from flask import current_app

from app.extensions import db
from app.models.job_order import JobOrder
from app.models.notification import (
    NotificationChannel,
    NotificationEvent,
    NotificationLog,
    NotificationMilestone,
    NotificationStatus,
)
from app.services.email_backends import ConsoleEmailBackend, get_email_backend
from app.services.notification_templates import SHOP_NAME, job_update_email, job_update_sms, job_update_subject
from app.services.sms_backends import ConsoleSmsBackend, get_sms_backend, normalize_ph_number, sanitize_sms
from app.utils.errors import AppError

logger = logging.getLogger(__name__)

TURNED_OFF = "Notifications are turned off (NOTIFICATIONS_ENABLED is false)"
NOT_ALLOWLISTED = "Recipient is not on NOTIFY_ALLOWLIST"
OPTED_OUT = "Client opted out of this channel"
BODY_NOT_STORED = "[not stored: contains a sign-in link or code]"


def _utcnow():
    return datetime.now(timezone.utc)


def _normalize_recipient(channel: NotificationChannel, recipient: str | None) -> str | None:
    raw = (recipient or "").strip()
    if channel == NotificationChannel.SMS:
        return normalize_ph_number(raw)
    return raw.lower() if "@" in raw else None


def parse_allowlist(raw: str | None) -> set[str]:
    entries = set()
    for item in (raw or "").split(","):
        item = item.strip()
        if not item:
            continue
        entries.add(item.lower() if "@" in item else (normalize_ph_number(item) or item))
    return entries


def _attempt(cfg, channel, to, subject, body, html_body):
    """Return (status, error, provider_reference, stored_body)."""
    if channel == NotificationChannel.SMS:
        body = sanitize_sms(body)
    if not to:
        what = "mobile number" if channel == NotificationChannel.SMS else "email address"
        return NotificationStatus.SKIPPED, f"No valid {what} for this channel", None, body

    if not cfg.get("NOTIFICATIONS_ENABLED"):
        # Still printed (body only in development) so local invite links keep working.
        if channel == NotificationChannel.EMAIL:
            ConsoleEmailBackend().send(to, subject, body)
        else:
            ConsoleSmsBackend().send(to, body)
        return NotificationStatus.SKIPPED, TURNED_OFF, None, body

    allowlist = parse_allowlist(cfg.get("NOTIFY_ALLOWLIST"))
    if allowlist and to not in allowlist:
        return NotificationStatus.SKIPPED, NOT_ALLOWLISTED, None, body

    if channel == NotificationChannel.EMAIL:
        backend = get_email_backend(cfg)
        reference = backend.send(to, subject, body, html_body)
    else:
        backend = get_sms_backend(cfg)
        reference = backend.send(to, body)
    if not backend.delivers:
        variable = "EMAIL_BACKEND" if channel == NotificationChannel.EMAIL else "SMS_BACKEND"
        return NotificationStatus.SKIPPED, f"{variable} is console: logged, not sent", None, body
    return NotificationStatus.SENT, None, reference, body


def send_notification(
    *,
    channel: NotificationChannel,
    recipient: str | None,
    event: str,
    subject: str,
    body: str,
    html_body: str | None = None,
    job_order_id: str | None = None,
    client_id: str | None = None,
    milestone: NotificationMilestone | None = None,
    store_body: bool = True,
    skip_reason: str | None = None,
) -> NotificationLog | None:
    """Send one message and log it. Returns the log row (None if even that failed)."""
    to = None
    stored_body = body
    try:
        to = _normalize_recipient(channel, recipient)
        if skip_reason:
            status, error, reference = NotificationStatus.SKIPPED, skip_reason, None
        else:
            status, error, reference, stored_body = _attempt(
                current_app.config, channel, to, subject, body, html_body
            )
    except Exception as exc:  # noqa: BLE001 - a notification must never break the action
        logger.exception("Notification send failed event=%s channel=%s", event, channel.value)
        status, error, reference = NotificationStatus.FAILED, str(exc)[:2000] or type(exc).__name__, None

    logger.info(
        "Notification event=%s channel=%s to=%s status=%s",
        event,
        channel.value,
        to or recipient or "(none)",
        status.value,
    )
    log = NotificationLog(
        job_order_id=job_order_id,
        client_id=client_id,
        milestone=milestone,
        event=event,
        channel=channel,
        recipient=(to or (recipient or "").strip() or "(none)")[:255],
        message_body=stored_body if store_body else BODY_NOT_STORED,
        status=status,
        provider_reference=(str(reference)[:255] if reference else None),
        error_message=error,
        sent_at=_utcnow() if status == NotificationStatus.SENT else None,
    )
    try:
        db.session.add(log)
        db.session.commit()
    except Exception:  # noqa: BLE001
        logger.exception("Failed to write notification log event=%s", event)
        try:
            db.session.rollback()
        except Exception:  # noqa: BLE001
            pass
        return None
    return log


def delivery_summary(log: NotificationLog | None) -> dict:
    """What the admin is shown after an invitation: never the link or code."""
    if log is None:
        return {"status": "FAILED", "channel": None, "recipient": None,
                "errorMessage": "The delivery could not be recorded; check the server log"}
    return {
        "status": log.status.value,
        "channel": log.channel.value,
        "recipient": log.recipient,
        "errorMessage": log.error_message,
    }


def _already_logged(job_id: str, milestone: NotificationMilestone, channel: NotificationChannel) -> bool:
    return (
        NotificationLog.query.filter_by(
            job_order_id=job_id,
            milestone=milestone,
            channel=channel,
        ).first()
        is not None
    )


def _send_job_update(job, client, milestone, channel, *, opted_in, recipient):
    number = job.job_number
    if channel == NotificationChannel.EMAIL:
        subject = job_update_subject(milestone, number)
        body = job_update_email(milestone, number, job.title or "", job.due_date)
    else:
        subject = ""
        body = job_update_sms(milestone, number, job.title or "", job.due_date)
    return send_notification(
        channel=channel,
        recipient=recipient,
        event=milestone.value,
        subject=subject,
        body=body,
        job_order_id=job.id,
        client_id=client.id,
        milestone=milestone,
        skip_reason=None if opted_in else OPTED_OUT,
    )


def notify_job_milestone(job_id: str, milestone: NotificationMilestone) -> list[NotificationLog]:
    """Client job-status update on each channel the client chose, once per job,
    milestone and channel. Never raises."""
    logs: list[NotificationLog] = []
    try:
        job = JobOrder.query.get(job_id)
        if not job or not job.client:
            logger.warning("notify_job_milestone: job/client missing id=%s", job_id)
            return logs
        client = job.client
        channels = (
            (NotificationChannel.EMAIL, client.notify_by_email, client.email),
            (NotificationChannel.SMS, client.notify_by_sms, client.mobile_number),
        )
        for channel, opted_in, recipient in channels:
            if _already_logged(job.id, milestone, channel):
                continue
            log = _send_job_update(
                job, client, milestone, channel, opted_in=bool(opted_in), recipient=recipient
            )
            if log is not None:
                logs.append(log)
    except Exception:  # noqa: BLE001
        logger.exception("notify_job_milestone unexpected error job=%s", job_id)
        try:
            db.session.rollback()
        except Exception:  # noqa: BLE001
            pass
    return logs


def safe_notify_job_milestone(job_id: str, milestone: NotificationMilestone) -> None:
    """Fire-and-forget wrapper: never raises."""
    try:
        notify_job_milestone(job_id, milestone)
    except Exception:  # noqa: BLE001
        logger.exception("safe_notify_job_milestone failed job=%s", job_id)


def list_notification_logs(job_order_id=None, client_id=None, status=None, limit=200):
    q = NotificationLog.query
    if job_order_id:
        q = q.filter_by(job_order_id=job_order_id)
    if client_id:
        q = q.filter_by(client_id=client_id)
    if status:
        q = q.filter_by(status=NotificationStatus(status))
    return (
        q.order_by(NotificationLog.created_at.desc())
        .limit(min(int(limit or 200), 500))
        .all()
    )


def resend_notification(log_id: str) -> NotificationLog:
    """Manual resend of a FAILED or NOT_SENT job update. Creates a new attempt row."""
    original = NotificationLog.query.get(log_id)
    if not original:
        raise AppError("Notification not found", "NOT_FOUND", 404)
    if original.status not in (NotificationStatus.FAILED, NotificationStatus.NOT_SENT):
        raise AppError(
            "Only failed or not-sent notifications can be resent", "VALIDATION_ERROR", 400
        )
    job = original.job_order
    client = original.client
    if not job or not client or not original.milestone:
        raise AppError("Only client job updates can be resent", "VALIDATION_ERROR", 400)

    if original.channel == NotificationChannel.EMAIL:
        opted_in, recipient = client.notify_by_email, client.email
    else:
        opted_in, recipient = client.notify_by_sms, client.mobile_number
    log = _send_job_update(
        job, client, original.milestone, original.channel, opted_in=bool(opted_in), recipient=recipient
    )
    if log is None:
        raise AppError("Could not record the notification", "NOTIFICATION_LOG_FAILED", 500)
    return log


def send_test_message(channel: str | None, to: str | None) -> NotificationLog:
    """Admin test: one message through the real path (switch, allowlist, backend)."""
    choice = (channel or "").strip().lower()
    if choice not in ("email", "sms"):
        raise AppError("channel must be email or sms", "VALIDATION_ERROR", 400)
    ch = NotificationChannel.EMAIL if choice == "email" else NotificationChannel.SMS
    if not _normalize_recipient(ch, to):
        what = "a Philippine mobile number" if ch == NotificationChannel.SMS else "an email address"
        raise AppError(f"Enter {what}", "VALIDATION_ERROR", 400)

    if ch == NotificationChannel.EMAIL:
        subject = f"Test email - {SHOP_NAME}"
        body = (
            f"This is a test message from the {SHOP_NAME} Production Scheduling System.\n\n"
            "If you can read this, email notifications are working."
        )
    else:
        subject = ""
        body = "BMSC: Test message from the production scheduling system. SMS notifications are working."
    log = send_notification(
        channel=ch, recipient=to, event=NotificationEvent.TEST, subject=subject, body=body
    )
    if log is None:
        raise AppError("Could not record the test message", "NOTIFICATION_LOG_FAILED", 500)
    return log
