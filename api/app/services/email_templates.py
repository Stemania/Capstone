"""Branded multipart email bodies (plain text + HTML) for every outbound email.

Table-based HTML, inline CSS only, max-width 600px. No remote images required.
"""

from __future__ import annotations

import html
import logging
import re
from dataclasses import dataclass
from email.utils import parseaddr

from flask import current_app, has_app_context

logger = logging.getLogger(__name__)

SHOP_DISPLAY_NAME = "Brothers Machine Shop"
# Full legal name in the HTML email header (From: stays SHOP_DISPLAY_NAME).
SHOP_HEADER_NAME = "Brothers Machine Shop and Services Corporation"
SHOP_SUBTITLE = "Production Scheduling System"
# Content-ID for the inline logo (multipart/related); HTML uses cid: without brackets.
EMAIL_LOGO_CID = "bmsc-logo@bmsc"

# Matches the login card header / app primary.
EMAIL_NAVY = "#0f1c2e"
EMAIL_BLUE = "#2563eb"
EMAIL_MUTED = "#64748b"
EMAIL_BORDER = "#e2e8f0"

_STATUS_BADGES = {
    "JOB_RECEIVED": ("Received", "#1d4ed8", "#eaf1ff"),
    "JOB_STARTED": ("Started", "#4338ca", "#eef2ff"),
    "JOB_COMPLETED": ("Completed", "#15803d", "#e3f4e8"),
    "JOB_DELIVERED": ("Ready for delivery", "#0f766e", "#dff2f2"),
}


@dataclass(frozen=True)
class EmailContent:
    subject: str
    text: str
    html: str


def extract_email_address(from_value: str | None) -> str | None:
    """Return the bare address from 'Name <addr@x>' or a bare email."""
    _, addr = parseaddr(from_value or "")
    addr = (addr or "").strip()
    if addr and "@" in addr:
        return addr
    raw = (from_value or "").strip()
    if re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", raw):
        return raw
    return None


def format_from_header(mail_from: str | None, display_name: str | None = None) -> str:
    """Brothers Machine Shop <addr> — always a display name + the sending address."""
    addr = extract_email_address(mail_from) or (mail_from or "").strip()
    name = (display_name or SHOP_DISPLAY_NAME).strip() or SHOP_DISPLAY_NAME
    if not addr:
        return name
    # Quote display name if it has special characters.
    if re.search(r'[,;:"<>]', name):
        safe = name.replace('"', '\\"')
        return f'"{safe}" <{addr}>'
    return f"{name} <{addr}>"


def frontend_base_url(config=None) -> str:
    """Absolute frontend origin for links. Warns when production URL is not https."""
    if config is None and has_app_context():
        config = current_app.config
    config = config or {}
    raw = (config.get("FRONTEND_URL") or "http://localhost:5173").strip().rstrip("/")
    env = str(config.get("ENV") or config.get("FLASK_ENV") or "").lower()
    if not raw:
        logger.warning("FRONTEND_URL is empty; invitation/reset links will use localhost")
        raw = "http://localhost:5173"
    if env == "production" and not raw.lower().startswith("https://"):
        logger.warning(
            "FRONTEND_URL is not https in production; invite/reset links may be blocked or land in spam"
        )
    return raw


def absolute_frontend_url(path: str, config=None) -> str:
    """Join FRONTEND_URL with a path starting with /."""
    base = frontend_base_url(config)
    path = path if path.startswith("/") else f"/{path}"
    return f"{base}{path}"


def _shop_footer_lines() -> list[str]:
    """Address/contact from Shop details when the DB is available."""
    lines = [SHOP_DISPLAY_NAME]
    try:
        if has_app_context():
            from app.services.shop_details_service import get_shop_details

            details = get_shop_details() or {}
            name = (details.get("shopName") or "").strip()
            if name:
                lines[0] = name
            for key in ("address", "telephone", "mobileNumbers", "email"):
                val = (details.get(key) or "").strip()
                if val:
                    lines.append(val)
    except Exception:  # noqa: BLE001 - footer must never break sending
        logger.debug("shop details unavailable for email footer", exc_info=True)
    lines.append("This is an automated message.")
    return lines


def _esc(value: str) -> str:
    return html.escape(value or "", quote=True)


def _button_html(label: str, url: str) -> str:
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'style="margin:24px 0 8px">'
        f"<tr><td style=\"border-radius:6px;background:{EMAIL_BLUE}\">"
        f'<a href="{_esc(url)}" style="display:inline-block;padding:12px 22px;'
        f"font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;"
        f'color:#ffffff;text-decoration:none;border-radius:6px">{_esc(label)}</a>'
        f"</td></tr></table>"
    )


def _fallback_link_html(url: str) -> str:
    return (
        f'<p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;'
        f'font-size:13px;line-height:1.5;color:{EMAIL_MUTED}">'
        f'If the button doesn&rsquo;t work, open this link:<br>'
        f'<a href="{_esc(url)}" style="color:{EMAIL_BLUE};word-break:break-all">'
        f"{_esc(url)}</a></p>"
    )


def _status_badge_html(milestone: str) -> str:
    label, fg, bg = _STATUS_BADGES.get(milestone, ("Update", EMAIL_MUTED, "#f1f5f9"))
    return (
        f'<span style="display:inline-block;padding:4px 10px;border-radius:999px;'
        f"font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;"
        f'color:{fg};background:{bg}">{_esc(label)}</span>'
    )


def render_branded_email(
    *,
    greeting: str,
    paragraphs: list[str],
    button_label: str | None = None,
    button_url: str | None = None,
    note: str | None = None,
    job_number: str | None = None,
    job_title: str | None = None,
    milestone: str | None = None,
) -> tuple[str, str]:
    """Return (plain_text, html) for a branded Brothers Machine Shop email."""
    footer = _shop_footer_lines()

    text_parts: list[str] = []
    if greeting:
        text_parts.append(greeting)
        text_parts.append("")
    for p in paragraphs:
        if p:
            text_parts.append(p)
            text_parts.append("")
    if job_number:
        text_parts.append(f"Job: {job_number}" + (f" — {job_title}" if job_title else ""))
        if milestone and milestone in _STATUS_BADGES:
            text_parts.append(f"Status: {_STATUS_BADGES[milestone][0]}")
        text_parts.append("")
    if button_url and button_label:
        text_parts.append(f"{button_label}:")
        text_parts.append(button_url)
        text_parts.append("")
        text_parts.append("If the button doesn't work, open this link:")
        text_parts.append(button_url)
        text_parts.append("")
    if note:
        text_parts.append(note)
        text_parts.append("")
    text_parts.append("---")
    text_parts.extend(footer)
    text = "\n".join(text_parts).strip() + "\n"

    body_bits: list[str] = []
    if greeting:
        body_bits.append(
            f'<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;'
            f'font-size:16px;line-height:1.5;color:#0f172a"><strong>{_esc(greeting)}</strong></p>'
        )
    for p in paragraphs:
        if not p:
            continue
        body_bits.append(
            f'<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;'
            f'font-size:15px;line-height:1.55;color:#0f172a">{_esc(p)}</p>'
        )
    if job_number:
        body_bits.append(
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'border="0" style="margin:0 0 16px;border:1px solid {EMAIL_BORDER};'
            'border-radius:8px">'
            f'<tr><td style="padding:14px 16px">'
            f'<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;'
            f'color:{EMAIL_MUTED};margin-bottom:4px">Job order</div>'
            f'<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;'
            f'font-weight:700;color:#0f172a">{_esc(job_number)}'
            + (f' &middot; {_esc(job_title)}' if job_title else "")
            + "</div>"
            + (
                f'<div style="margin-top:10px">{_status_badge_html(milestone)}</div>'
                if milestone
                else ""
            )
            + "</td></tr></table>"
        )
    if button_url and button_label:
        body_bits.append(_button_html(button_label, button_url))
        body_bits.append(_fallback_link_html(button_url))
    if note:
        body_bits.append(
            f'<p style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;'
            f'font-size:13px;line-height:1.5;color:{EMAIL_MUTED}">{_esc(note)}</p>'
        )

    footer_html = "<br>".join(_esc(line) for line in footer)
    # Table header: title left, logo right (CID). Stacks on narrow clients that honor max-width.
    header_html = (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
        f"<tr>"
        f'<td valign="middle" style="padding:0;font-family:Arial,Helvetica,sans-serif;'
        f'vertical-align:middle">'
        f'<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;'
        f'line-height:1.3;color:#ffffff">{_esc(SHOP_HEADER_NAME)}</div>'
        f'<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#cbd5e1;'
        f'margin-top:4px">{_esc(SHOP_SUBTITLE)}</div>'
        f"</td>"
        f'<td valign="middle" align="right" width="64" style="padding:0 0 0 12px;'
        f'vertical-align:middle;width:64px">'
        f'<img src="cid:{EMAIL_LOGO_CID}" height="48" width="48" alt="BMSC logo" '
        f'style="display:block;border:0;outline:none;height:48px;width:auto;max-height:48px">'
        f"</td>"
        f"</tr></table>"
    )
    html_doc = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{_esc(SHOP_DISPLAY_NAME)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid {EMAIL_BORDER}">
<tr><td style="background:{EMAIL_NAVY};padding:20px 24px">{header_html}</td></tr>
<tr><td style="padding:28px 24px">{"".join(body_bits)}</td></tr>
<tr><td style="padding:16px 24px 22px;border-top:1px solid {EMAIL_BORDER};background:#f8fafc">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.55;color:{EMAIL_MUTED}">{footer_html}</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""
    return text, html_doc


def invitation_email(full_name: str, link: str) -> EmailContent:
    text, html_body = render_branded_email(
        greeting=f"Hello {full_name}," if full_name else "Hello,",
        paragraphs=[
            "You have been invited to Brothers Machine Shop.",
            "Use the button below to set your password and sign in.",
        ],
        button_label="Set your password",
        button_url=link,
        note="This link expires in 48 hours. If you did not expect this invitation, you can ignore this email.",
    )
    return EmailContent(
        subject="Set your Brothers Machine Shop password",
        text=text,
        html=html_body,
    )


def password_reset_email(full_name: str, link: str) -> EmailContent:
    text, html_body = render_branded_email(
        greeting=f"Hello {full_name}," if full_name else "Hello,",
        paragraphs=[
            "We received a request to reset your Brothers Machine Shop password.",
            "Use the button below to choose a new password.",
        ],
        button_label="Reset your password",
        button_url=link,
        note="This link expires in 1 hour. If you did not request this, you can ignore this email. Your password will not change.",
    )
    return EmailContent(
        subject="Reset your Brothers Machine Shop password",
        text=text,
        html=html_body,
    )


def test_email() -> EmailContent:
    text, html_body = render_branded_email(
        greeting="Hello,",
        paragraphs=[
            "This is a test message from the Brothers Machine Shop Production Scheduling System.",
            "If you can read this, email notifications are working.",
        ],
        note="No action is required.",
    )
    return EmailContent(
        subject=f"Test email - {SHOP_DISPLAY_NAME}",
        text=text,
        html=html_body,
    )


def job_update_email_content(
    milestone,
    job_number: str,
    title: str,
    target_date=None,
) -> EmailContent:
    from app.models.notification import NotificationMilestone
    from app.services.notification_templates import (
        MILESTONE_LABELS,
        SHOWS_TARGET_DATE,
        format_date,
        render_message,
    )

    ms = (
        milestone
        if isinstance(milestone, NotificationMilestone)
        else NotificationMilestone(str(getattr(milestone, "value", milestone)))
    )
    key = ms.value
    label = MILESTONE_LABELS.get(ms, "updated")
    paragraphs = [render_message(ms, job_number, title, None)]
    if target_date and ms in SHOWS_TARGET_DATE:
        paragraphs.append(f"Target date: {format_date(target_date)}.")
    paragraphs.append("If you have questions, reply to this email or call the shop.")

    text, html_body = render_branded_email(
        greeting="Hello,",
        paragraphs=paragraphs,
        job_number=job_number,
        job_title=title,
        milestone=key,
        note="You received this because you asked to be notified about this job.",
    )
    return EmailContent(
        subject=f"Job {job_number} {label} - {SHOP_DISPLAY_NAME}",
        text=text,
        html=html_body,
    )
