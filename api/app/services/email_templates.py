"""Branded multipart email bodies (plain text + HTML) for every outbound email.

Table-based HTML, inline CSS only, max-width 600px. Header logo loads from PUBLIC_APP_URL.
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
# Public logo on the live frontend (web/public/email-logo.png); not a MIME attachment.
EMAIL_LOGO_PATH = "/email-logo.png"
DEFAULT_PUBLIC_APP_URL = "https://capstone-five-beta.vercel.app"

# Matches the login card header / app primary.
EMAIL_NAVY = "#0f1c2e"
EMAIL_BLUE = "#2563eb"
EMAIL_MUTED = "#64748b"
EMAIL_BORDER = "#e2e8f0"

_STATUS_BADGES = {
    "JOB_RECEIVED": ("Received", "#1d4ed8", "#eaf1ff"),
    "JOB_STARTED": ("Started", "#4338ca", "#eef2ff"),
    "JOB_HALFWAY": ("Halfway done", "#4338ca", "#eef2ff"),
    "JOB_FINAL_STAGE": ("Final stage", "#4338ca", "#eef2ff"),
    "JOB_COMPLETED": ("Completed", "#15803d", "#e3f4e8"),
    "JOB_DELIVERED": ("Ready for delivery", "#0f766e", "#dff2f2"),
    "JOB_DELAYED": ("Delayed", "#b91c1c", "#fee2e2"),
}

_FONT = "font-family:Arial,Helvetica,sans-serif;"
_TRACKER_STEPS = ("Received", "In production", "Completed", "Ready for delivery")
# (steps done, step in progress or None) for each update.
_TRACKER = {
    "JOB_RECEIVED": (1, None),
    "JOB_STARTED": (1, 1),
    "JOB_HALFWAY": (1, 1),
    "JOB_FINAL_STAGE": (1, 1),
    "JOB_DELAYED": (1, 1),
    "JOB_COMPLETED": (3, None),
    "JOB_DELIVERED": (4, None),
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


def public_app_url(config=None) -> str:
    """Origin that serves static assets (logo) for email HTML. Defaults to production."""
    if config is None and has_app_context():
        config = current_app.config
    config = config or {}
    raw = (config.get("PUBLIC_APP_URL") or DEFAULT_PUBLIC_APP_URL).strip().rstrip("/")
    return raw or DEFAULT_PUBLIC_APP_URL


def email_logo_url(config=None) -> str:
    """Absolute URL for the email header logo (remote <img>, not a MIME part)."""
    base = public_app_url(config)
    path = EMAIL_LOGO_PATH if EMAIL_LOGO_PATH.startswith("/") else f"/{EMAIL_LOGO_PATH}"
    return f"{base}{path}"


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
    tracker_html: str | None = None,
    badge_extra_html: str | None = None,
    box_extra_html: str | None = None,
    box_extra_text: list[str] | None = None,
    closing: str | None = None,
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
        text_parts.extend(box_extra_text or [])
        text_parts.append("")
    if closing:
        text_parts.append(closing)
        text_parts.append("")
    if button_url and button_label:
        text_parts.append(f"{button_label}:")
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
    if tracker_html:
        body_bits.append(tracker_html)
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
                f'<div style="margin-top:10px">{_status_badge_html(milestone)}{badge_extra_html or ""}</div>'
                if milestone
                else ""
            )
            + (box_extra_html or "")
            + "</td></tr></table>"
        )
    if closing:
        body_bits.append(
            f'<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;'
            f'font-size:15px;line-height:1.55;color:#0f172a">{_esc(closing)}</p>'
        )
    if button_url and button_label:
        # Button only: a long raw link printed in the body looks like phishing
        # to spam filters. The plain-text part still carries the link.
        body_bits.append(_button_html(button_label, button_url))
    if note:
        body_bits.append(
            f'<p style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;'
            f'font-size:13px;line-height:1.5;color:{EMAIL_MUTED}">{_esc(note)}</p>'
        )

    footer_html = "<br>".join(_esc(line) for line in footer)
    # Text-only header. A remote image on a free hosting domain (vercel.app)
    # counts against new senders in spam filters, so the logo is left out.
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


def _fmt_day(value) -> str:
    return f"{value:%b} {value.day}, {value.year}" if value else "—"


def _tracker_html(milestone: str) -> str:
    """Received → In production → Completed → Ready for delivery."""
    done, current = _TRACKER.get(milestone, (0, None))
    late = milestone == "JOB_DELAYED"
    bars, cells = [], []
    for i, name in enumerate(_TRACKER_STEPS):
        is_done, is_cur = i < done, i == current
        if is_done:
            tone = "#16a34a"
        elif is_cur:
            tone = "#dc2626" if late else EMAIL_BLUE
        else:
            tone = EMAIL_BORDER
        bars.append(
            f'<td style="width:25%;padding:0 2px"><div style="height:4px;border-radius:2px;'
            f'background:{tone};font-size:0;line-height:0">&nbsp;</div></td>'
        )
        mark = "&#10003;" if is_done else "&nbsp;"
        color = "#0f172a" if (is_done or is_cur) else "#94a3b8"
        weight = "700" if is_cur else "400"
        cells.append(
            '<td align="center" style="width:25%;padding:0 2px;vertical-align:top">'
            f'<div style="width:22px;height:22px;line-height:22px;margin:0 auto 6px;border-radius:11px;'
            f'background:{tone};color:#ffffff;{_FONT}font-size:13px;font-weight:700;text-align:center">{mark}</div>'
            f'<div style="{_FONT}font-size:12px;font-weight:{weight};color:{color}">{_esc(name)}</div></td>'
        )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="margin:4px 0 18px">'
        f'<tr>{"".join(bars)}</tr>'
        '<tr><td colspan="4" style="height:10px;font-size:0;line-height:0">&nbsp;</td></tr>'
        f'<tr>{"".join(cells)}</tr></table>'
    )


def _pill_html(label: str, fg: str, bg: str) -> str:
    return (
        f'<span style="display:inline-block;margin-left:6px;padding:4px 10px;border-radius:999px;'
        f'{_FONT}font-size:12px;font-weight:700;color:{fg};background:{bg}">{_esc(label)}</span>'
    )


def _rows_html(rows) -> str:
    out = []
    for label, value, color in rows:
        out.append(
            f'<tr><td style="padding:5px 0;{_FONT}font-size:13px;color:{EMAIL_MUTED}">{_esc(label)}</td>'
            f'<td align="right" style="padding:5px 0;{_FONT}font-size:14px;font-weight:700;'
            f'color:{color or "#0f172a"}">{_esc(value)}</td></tr>'
        )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="margin-top:12px">{"".join(out)}</table>'
    )


def _bar_html(progress: dict) -> str:
    pct = int(progress.get("percent") or 0)
    return (
        f'<div style="margin:12px 0 4px;height:10px;border-radius:5px;background:{EMAIL_BORDER}">'
        f'<div style="width:{pct}%;height:10px;border-radius:5px;background:{EMAIL_BLUE};'
        'font-size:0;line-height:0">&nbsp;</div></div>'
        f'<div style="{_FONT}font-size:12px;color:{EMAIL_MUTED}">{pct}% of the work done &middot; '
        f'{progress.get("done", 0)} of {progress.get("total", 0)} operations</div>'
    )


def _ops_html(progress: dict) -> str:
    rows = []
    for op in progress.get("operations") or []:
        state = op.get("state")
        if state == "done":
            mark = '<span style="color:#16a34a">&#10003;</span>'
        elif state == "now":
            mark = f'<span style="color:{EMAIL_BLUE}">&#9679;</span>'
        else:
            mark = '<span style="color:#cbd5e1">&#9675;</span>'
        color = "#94a3b8" if state == "next" else "#0f172a"
        tag = (
            f' <span style="{_FONT}font-size:12px;color:{EMAIL_BLUE}">(in progress)</span>'
            if state == "now"
            else ""
        )
        rows.append(
            f'<tr><td style="padding:3px 8px 3px 0;width:18px;{_FONT}font-size:14px">{mark}</td>'
            f'<td style="padding:3px 0;{_FONT}font-size:14px;color:{color}">{_esc(op.get("name") or "")}{tag}</td></tr>'
        )
    if not rows:
        return ""
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px">'
        + "".join(rows)
        + "</table>"
    )


def _ops_text(progress: dict) -> list[str]:
    marks = {"done": "[x]", "now": "[>]"}
    lines = []
    for op in progress.get("operations") or []:
        suffix = " (in progress)" if op.get("state") == "now" else ""
        lines.append(f"  {marks.get(op.get('state'), '[ ]')} {op.get('name')}{suffix}")
    return ["Operations:", *lines] if lines else []


def _track_pill(progress: dict) -> tuple[str, str]:
    on_track = progress.get("onTrack")
    if on_track is True:
        return _pill_html("On track", "#15803d", "#dcfce7"), "On track for your target date"
    if on_track is False:
        return _pill_html("Behind schedule", "#b91c1c", "#fee2e2"), "Behind your target date"
    return "", ""


def job_update_email_content(
    milestone,
    job_number: str,
    title: str,
    target_date=None,
    *,
    progress: dict | None = None,
    delay: dict | None = None,
) -> EmailContent:
    """One client job-update email. ``progress`` comes from
    job_update_service.job_progress; ``delay`` is {"reason", "days"} for Delayed."""
    from app.models.notification import NotificationMilestone as M
    from app.services.notification_templates import (
        MILESTONE_LABELS,
        SHOWS_TARGET_DATE,
        format_date,
        render_message,
    )

    ms = milestone if isinstance(milestone, M) else M(str(getattr(milestone, "value", milestone)))
    key = ms.value
    label = MILESTONE_LABELS.get(ms, "updated")
    p = dict(progress or {})
    due = p.get("due") or target_date
    finish = p.get("finish")
    paragraphs = [render_message(ms, job_number, title, None)]
    box_html, box_text, pill_html = "", [], ""
    progress_ms = (M.JOB_STARTED, M.JOB_HALFWAY, M.JOB_FINAL_STAGE)

    if not p:
        # No progress given (older callers): the message with the target date.
        if target_date and ms in SHOWS_TARGET_DATE:
            paragraphs.append(f"Target date: {format_date(target_date)}.")
    elif ms == M.JOB_RECEIVED:
        late = bool(finish and due and finish > due)
        rows = [("Your target date", _fmt_day(due), None)]
        if finish:
            rows.append(("Planned finish", _fmt_day(finish), "#b91c1c" if late else None))
        if late:
            paragraphs.append(
                f"The current schedule finishes on {_fmt_day(finish)}, after your target date. "
                "We will keep you posted."
            )
        box_html = _rows_html(rows)
        box_text = [f"{r[0]}: {r[1]}" for r in rows]
    elif ms in progress_ms:
        if ms == M.JOB_HALFWAY and p.get("onTrack") is True:
            paragraphs[0] = paragraphs[0][:-1] + " and on track for your target date."
        if ms == M.JOB_FINAL_STAGE and p.get("current"):
            paragraphs.append(f"The last operation, {p['current']}, is under way.")
        pill_html, pill_text = _track_pill(p)
        rows = []
        if ms != M.JOB_STARTED and p.get("stage"):
            rows.append(("Stage of the part", p["stage"], None))
        rows += [("Expected finish", _fmt_day(finish), None), ("Your target date", _fmt_day(due), None)]
        show_bar = ms != M.JOB_STARTED
        box_html = (_bar_html(p) if show_bar else "") + _rows_html(rows) + _ops_html(p)
        box_text = (
            [f"Progress: {p.get('percent', 0)}% of the work done "
             f"({p.get('done', 0)} of {p.get('total', 0)} operations)"] if show_bar else []
        )
        box_text += [f"{r[0]}: {r[1]}" for r in rows] + ([pill_text] if pill_text else []) + _ops_text(p)
    elif ms == M.JOB_DELAYED:
        d = delay or {}
        days = int(d.get("days") or 0)
        rows = [
            ("Your target date", _fmt_day(due), None),
            ("New expected finish", _fmt_day(finish), "#b91c1c"),
        ]
        if d.get("reason"):
            rows.append(("Reason", d["reason"], None))
        if days > 0:
            pill_html = _pill_html(f"{days} day{'s' if days != 1 else ''} late", "#b91c1c", "#fee2e2")
        box_html = _rows_html(rows)
        box_text = [f"{r[0]}: {r[1]}" for r in rows] + ([f"{days} day{'s' if days != 1 else ''} late"] if days > 0 else [])

    closing = (
        "We will email you again if the date changes. If you have questions, reply to this email or call the shop."
        if ms == M.JOB_DELAYED
        else "If you have questions, reply to this email or call the shop."
    )
    text, html_body = render_branded_email(
        greeting="Hello,",
        paragraphs=paragraphs,
        job_number=job_number,
        job_title=title,
        milestone=key,
        tracker_html=_tracker_html(key) if p else None,
        badge_extra_html=pill_html or None,
        box_extra_html=box_html,
        box_extra_text=box_text,
        closing=closing,
        note="You received this because you asked to be notified about this job.",
    )
    return EmailContent(
        subject=f"Job {job_number} {label} - {SHOP_DISPLAY_NAME}",
        text=text,
        html=html_body,
    )
