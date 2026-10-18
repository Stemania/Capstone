"""Client job-status message copy (plain text fragments used by email templates)."""

from app.models.notification import NotificationMilestone

SHOP_NAME = "Brothers Machine Shop"

MILESTONE_LABELS = {
    NotificationMilestone.JOB_RECEIVED: "received",
    NotificationMilestone.JOB_STARTED: "started",
    NotificationMilestone.JOB_COMPLETED: "completed",
    NotificationMilestone.JOB_DELIVERED: "ready for delivery",
}

# No portal links: clients have no account.
TEMPLATES = {
    NotificationMilestone.JOB_RECEIVED: "Your job {job_number} ({title}) has been received and scheduled.",
    NotificationMilestone.JOB_STARTED: "Work on your job {job_number} ({title}) has started.",
    NotificationMilestone.JOB_COMPLETED: (
        "Your job {job_number} ({title}) is complete. "
        "We will let you know when it is ready for delivery."
    ),
    NotificationMilestone.JOB_DELIVERED: "Your job {job_number} ({title}) is ready for delivery.",
}

SHOWS_TARGET_DATE = (NotificationMilestone.JOB_RECEIVED, NotificationMilestone.JOB_STARTED)


def format_date(value) -> str:
    return f"{value:%b} {value.day}, {value.year}"


def _short_title(title: str) -> str:
    text = (title or "").strip()
    return text[:37] + "..." if len(text) > 40 else text


def render_message(milestone, job_number: str, title: str, target_date=None) -> str:
    text = TEMPLATES[milestone].format(job_number=job_number, title=_short_title(title))
    if target_date and milestone in SHOWS_TARGET_DATE:
        text += f" Target date: {format_date(target_date)}."
    return text


def job_update_subject(milestone, job_number: str) -> str:
    return f"Job {job_number} {MILESTONE_LABELS[milestone]} - {SHOP_NAME}"


def job_update_email(milestone, job_number: str, title: str, target_date=None) -> str:
    return render_message(milestone, job_number, title, target_date) + f"\n\n{SHOP_NAME}"
