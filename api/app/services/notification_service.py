"""Client milestone notifications (same-request, never rolls back the trigger)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from flask import current_app

from app.extensions import db
from app.models.job_order import JobOrder
from app.models.notification import (
    NotificationChannel,
    NotificationLog,
    NotificationMilestone,
    NotificationStatus,
)
from app.services.notification_providers import build_email_provider, build_sms_provider
from app.services.notification_templates import render_message

logger = logging.getLogger(__name__)


def _utcnow():
    return datetime.now(timezone.utc)


def _job_number(job: JobOrder) -> str:
    year = job.created_at.year if job.created_at else _utcnow().year
    short = (job.id or "")[:4].upper()
    return f"JO-{year}-{short}"


def _already_logged(job_id: str, milestone: NotificationMilestone, channel: NotificationChannel) -> bool:
    return (
        NotificationLog.query.filter_by(
            job_order_id=job_id,
            milestone=milestone,
            channel=channel,
        ).first()
        is not None
    )


def _cfg():
    return current_app.config


def notify_job_milestone(job_id: str, milestone: NotificationMilestone) -> list[NotificationLog]:
    """
    Send (or skip) notifications for a milestone. Commits its own log rows.
    Never raises to the caller for provider failures.
    """
    logs: list[NotificationLog] = []
    try:
        job = JobOrder.query.get(job_id)
        if not job or not job.client:
            logger.warning("notify_job_milestone: job/client missing id=%s", job_id)
            return logs

        client = job.client
        body = render_message(milestone, _job_number(job), job.title or "")
        channels = (
            (NotificationChannel.EMAIL, client.notify_by_email, (client.email or "").strip()),
            (NotificationChannel.SMS, client.notify_by_sms, (client.mobile_number or "").strip()),
        )

        for channel, opted_in, recipient in channels:
            if _already_logged(job.id, milestone, channel):
                continue

            log = NotificationLog(
                job_order_id=job.id,
                client_id=client.id,
                milestone=milestone,
                channel=channel,
                recipient=recipient or "(none)",
                message_body=body,
                status=NotificationStatus.PENDING,
            )
            db.session.add(log)
            db.session.flush()

            if not opted_in:
                log.status = NotificationStatus.SKIPPED
                log.error_message = "Client opted out of this channel"
            elif not recipient:
                log.status = NotificationStatus.SKIPPED
                log.error_message = "No contact detail for this channel"
            else:
                try:
                    if channel == NotificationChannel.EMAIL:
                        provider, console_fallback = build_email_provider(_cfg())
                    else:
                        provider, console_fallback = build_sms_provider(_cfg())
                    provider.send(recipient, body)
                    log.status = NotificationStatus.SENT
                    log.sent_at = _utcnow()
                    if console_fallback or provider.name in ("console", "sms_stub"):
                        note = f"Sent via {provider.name}"
                        if console_fallback:
                            note += " (credentials missing; console fallback)"
                        log.error_message = note
                except Exception as exc:  # noqa: BLE001 — must not break job flow
                    logger.exception(
                        "Notification send failed job=%s milestone=%s channel=%s",
                        job.id,
                        milestone.value,
                        channel.value,
                    )
                    log.status = NotificationStatus.FAILED
                    log.error_message = str(exc)[:2000]

            try:
                db.session.commit()
            except Exception:
                db.session.rollback()
                logger.exception("Failed to commit NotificationLog")
                continue
            logs.append(log)
        return logs
    except Exception:
        logger.exception("notify_job_milestone unexpected error job=%s", job_id)
        try:
            db.session.rollback()
        except Exception:
            pass
        return logs


def safe_notify_job_milestone(job_id: str, milestone: NotificationMilestone) -> None:
    """Fire-and-forget wrapper: never raises."""
    try:
        notify_job_milestone(job_id, milestone)
    except Exception:
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
    """Manual resend for FAILED entries. Creates a new attempt row."""
    from app.utils.errors import AppError

    original = NotificationLog.query.get(log_id)
    if not original:
        raise AppError("Notification not found", "NOT_FOUND", 404)
    if original.status != NotificationStatus.FAILED:
        raise AppError("Only FAILED notifications can be resent", "VALIDATION_ERROR", 400)

    job = original.job_order
    client = original.client
    if not job or not client:
        raise AppError("Job or client missing", "NOT_FOUND", 404)

    if original.channel == NotificationChannel.EMAIL:
        recipient = (client.email or "").strip()
        opted = bool(client.notify_by_email)
        provider, console_fallback = build_email_provider(_cfg())
    else:
        recipient = (client.mobile_number or "").strip()
        opted = bool(client.notify_by_sms)
        provider, console_fallback = build_sms_provider(_cfg())

    body = render_message(original.milestone, _job_number(job), job.title or "")
    log = NotificationLog(
        job_order_id=job.id,
        client_id=client.id,
        milestone=original.milestone,
        channel=original.channel,
        recipient=recipient or "(none)",
        message_body=body,
        status=NotificationStatus.PENDING,
    )
    db.session.add(log)
    db.session.flush()

    if not opted:
        log.status = NotificationStatus.SKIPPED
        log.error_message = "Client opted out of this channel"
    elif not recipient:
        log.status = NotificationStatus.SKIPPED
        log.error_message = "No contact detail for this channel"
    else:
        try:
            provider.send(recipient, body)
            log.status = NotificationStatus.SENT
            log.sent_at = _utcnow()
            if console_fallback or provider.name in ("console", "sms_stub"):
                note = f"Sent via {provider.name}"
                if console_fallback:
                    note += " (credentials missing; console fallback)"
                log.error_message = note
        except Exception as exc:  # noqa: BLE001
            log.status = NotificationStatus.FAILED
            log.error_message = str(exc)[:2000]

    db.session.commit()
    return log
