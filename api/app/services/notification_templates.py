"""Notification message templates (SMS-length, no links)."""

from app.models.notification import NotificationMilestone

MILESTONE_LABELS = {
    NotificationMilestone.JOB_RECEIVED: "received",
    NotificationMilestone.JOB_STARTED: "started",
    NotificationMilestone.JOB_COMPLETED: "completed",
    NotificationMilestone.JOB_DELIVERED: "ready for pickup / delivered",
}

# Keep under ~160 chars for SMS. No portal links.
TEMPLATES = {
    NotificationMilestone.JOB_RECEIVED: (
        "BMSC: Job {job_number} ({title}) received. "
        "We'll notify you when work starts."
    ),
    NotificationMilestone.JOB_STARTED: (
        "BMSC: Job {job_number} ({title}) has started in the shop."
    ),
    NotificationMilestone.JOB_COMPLETED: (
        "BMSC: Job {job_number} ({title}) is complete. "
        "We'll notify you when it's delivered."
    ),
    NotificationMilestone.JOB_DELIVERED: (
        "BMSC: Job {job_number} ({title}) has been delivered / is ready for pickup."
    ),
}


def render_message(milestone: NotificationMilestone, job_number: str, title: str) -> str:
    template = TEMPLATES[milestone]
    short_title = (title or "").strip()
    if len(short_title) > 40:
        short_title = short_title[:37] + "..."
    return template.format(job_number=job_number, title=short_title)
