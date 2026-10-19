"""Every outbound email goes through send_notification.

Call it only after the business transaction has committed. It applies the
NOTIFICATIONS_ENABLED switch and NOTIFY_ALLOWLIST, sends through the configured
backend, writes exactly one notification_logs row, and never raises: a failed
notification must not fail or roll back the user's action.

SMS is no longer a delivery channel. Historical notification_logs rows with
channel=SMS remain readable; new sends are email only.
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
from app.services.email_templates import job_update_email_content, test_email
from app.utils.errors import AppError
from app.utils.phone import normalize_ph_mobile

logger = logging.getLogger(__name__)

TURNED_OFF = "Notifications are turned off (NOTIFICATIONS_ENABLED is false)"
NOT_ALLOWLISTED = "Recipient is not on NOTIFY_ALLOWLIST"
OPTED_OUT = "Client opted out of email updates"
EMAIL_UPDATES_OFF = "Email updates are off for this client"
BODY_NOT_STORED = "[not stored: contains a sign-in link or code]"
SMS_RETIRED = "SMS notifications are no longer available; use email"


def _utcnow():
    return datetime.now(timezone.utc)


def _normalize_phone_for_allowlist(raw: str | None) -> str | None:
    try:
        return normalize_ph_mobile(raw)
    except AppError:
        return None


def _normalize_recipient(channel: NotificationChannel, recipient: str | None) -> str | None:
    raw = (recipient or "").strip()
    if channel == NotificationChannel.EMAIL:
        return raw.lower() if "@" in raw else None
    # SMS channel kept only for history / reject-on-send.
    return _normalize_phone_for_allowlist(raw)


def parse_allowlist(raw: str | None) -> set[str]:
    entries = set()
    for item in (raw or "").split(","):
        item = item.strip()
        if not item:
            continue
        if "@" in item:
            entries.add(item.lower())
        else:
            entries.add(_normalize_phone_for_allowlist(item) or item)
    return entries


def _attempt(cfg, channel, to, subject, body, html_body):
    """Return (status, error, provider_reference, stored_body)."""
    if channel != NotificationChannel.EMAIL:
        return NotificationStatus.SKIPPED, SMS_RETIRED, None, body
    if not to:
        return NotificationStatus.SKIPPED, "No valid email address for this channel", None, body

    if not cfg.get("NOTIFICATIONS_ENABLED"):
        # Still printed (body only in development) so local invite links keep working.
        ConsoleEmailBackend().send(to, subject, body)
        return NotificationStatus.SKIPPED, TURNED_OFF, None, body

    allowlist = parse_allowlist(cfg.get("NOTIFY_ALLOWLIST"))
    if allowlist and to not in allowlist:
        return NotificationStatus.SKIPPED, NOT_ALLOWLISTED, None, body

    backend = get_email_backend(cfg)
    reference = backend.send(to, subject, body, html_body)
    if not backend.delivers:
        return NotificationStatus.SKIPPED, "EMAIL_BACKEND is console: logged, not sent", None, body
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

    from app.utils.log_mask import mask_email

    logger.info(
        "Notification event=%s channel=%s to=%s status=%s",
        event,
        channel.value,
        mask_email(to or recipient) or "(none)",
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
        return {
            "status": "FAILED",
            "channel": None,
            "recipient": None,
            "errorMessage": "The delivery could not be recorded; check the server log",
        }
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


def _send_job_update(job, client, milestone, *, opted_in, recipient):
    content = job_update_email_content(
        milestone, job.job_number, job.title or "", job.due_date
    )
    return send_notification(
        channel=NotificationChannel.EMAIL,
        recipient=recipient,
        event=milestone.value,
        subject=content.subject,
        body=content.text,
        html_body=content.html,
        job_order_id=job.id,
        client_id=client.id,
        milestone=milestone,
        skip_reason=None if opted_in else OPTED_OUT,
    )


def notify_job_milestone(job_id: str, milestone: NotificationMilestone) -> list[NotificationLog]:
    """Email the client once per job and milestone when they opted in and have an email.

    Never raises.
    """
    logs: list[NotificationLog] = []
    try:
        job = JobOrder.query.get(job_id)
        if not job or not job.client:
            logger.warning("notify_job_milestone: job/client missing id=%s", job_id)
            return logs
        client = job.client
        if _already_logged(job.id, milestone, NotificationChannel.EMAIL):
            return logs
        log = _send_job_update(
            job,
            client,
            milestone,
            opted_in=bool(client.notify_by_email),
            recipient=client.email,
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
    """Manual resend of a FAILED or NOT_SENT job update. Creates a new attempt row.

    Always uses the client's *current* email and consent. Logs the attempt even
    when email updates are off, then returns a clear error for the UI.
    """
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
    if original.channel != NotificationChannel.EMAIL:
        raise AppError(
            "SMS notifications are no longer available; enable email updates for this client",
            "VALIDATION_ERROR",
            400,
        )

    opted_in = bool(client.notify_by_email)
    # Always use the client's current email. When consent is off, still log a
    # skipped attempt with the FR-047 message, then surface it to the UI.
    if opted_in:
        log = _send_job_update(
            job,
            client,
            original.milestone,
            opted_in=True,
            recipient=client.email,
        )
    else:
        log = send_notification(
            channel=NotificationChannel.EMAIL,
            recipient=client.email,
            event=original.milestone.value,
            subject="",
            body="",
            job_order_id=job.id,
            client_id=client.id,
            milestone=original.milestone,
            skip_reason=EMAIL_UPDATES_OFF,
            store_body=False,
        )
    if log is None:
        raise AppError("Could not record the notification", "NOTIFICATION_LOG_FAILED", 500)
    if not opted_in:
        raise AppError(EMAIL_UPDATES_OFF, "EMAIL_UPDATES_OFF", 400)
    return log


def send_test_message(channel: str | None, to: str | None) -> NotificationLog:
    """Admin test: one email through the real path (switch, allowlist, backend)."""
    choice = (channel or "").strip().lower()
    if choice and choice != "email":
        raise AppError("Only email test messages are supported", "VALIDATION_ERROR", 400)
    if not _normalize_recipient(NotificationChannel.EMAIL, to):
        raise AppError("Enter an email address", "VALIDATION_ERROR", 400)

    content = test_email()
    log = send_notification(
        channel=NotificationChannel.EMAIL,
        recipient=to,
        event=NotificationEvent.TEST,
        subject=content.subject,
        body=content.text,
        html_body=content.html,
    )
    if log is None:
        raise AppError("Could not record the test message", "NOTIFICATION_LOG_FAILED", 500)
    return log
