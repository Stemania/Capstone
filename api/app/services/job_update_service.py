"""What a client job-update email reports, and when one is skipped.

Detailed clients get up to five emails per job, plus Delayed when needed:
Received (schedule released), Started (first operation), Halfway (about half
the target hours done), Final stage (last operation started) and Ready for
delivery. Key-updates clients get Received, Ready for delivery and Delayed.

Progress emails (Started, Halfway, Final stage) are skipped for short jobs and
when the client already got an email about the job that shop day, so a client
never gets more than one progress email a day for a job.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from app.models.notification import NotificationMilestone as M
from app.services.schedule_calendar import SHOP_TZ, utc_to_shop

PROGRESS_MILESTONES = (M.JOB_STARTED, M.JOB_HALFWAY, M.JOB_FINAL_STAGE)
# A job this short (working days, Mon-Sat) gets no progress emails.
SHORT_JOB_WORKING_DAYS = 3
HALFWAY_PERCENT = 50

KEY_UPDATES_ONLY = "The client gets key updates only"
SHORT_JOB = "Short job: no progress updates"
ALREADY_TODAY = "The client already got an update about this job today"

PART_STAGE_LABEL = {
    "RAW_MATERIAL": "Raw material",
    "CLIENT_SUPPLIED_ITEM": "Client supplied item",
    "WORK_IN_PROCESS": "Work in process",
    "CUT": "Cut",
    "BLANK": "Blank",
    "FORMED": "Formed",
    "MACHINED": "Machined",
    "ASSEMBLED": "Assembled",
    "HEAT_TREATED": "Heat treated",
    "FINISHED": "Finished",
}

# Why the schedule moved (latest schedule move), in words for the client.
DELAY_REASON = {
    "BREAKDOWN": "Machine breakdown",
    "MATERIAL": "Material delivery delay",
    "OVERRUN": "An operation took longer than planned",
    "RESCHEDULED": "Schedule change at the shop",
}


def _value(v):
    return getattr(v, "value", v)


def _shop_date(dt) -> date | None:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        return utc_to_shop(dt).date()
    return dt


def job_progress(job) -> dict:
    """Progress of a job for the client: done operations, percent of target
    hours, the operation in progress, the part stage and the scheduled finish."""
    ops = sorted(getattr(job, "operations", None) or [], key=lambda o: o.sequence_no or 0)
    done = [o for o in ops if _value(o.status) == "COMPLETED"]
    hours_total = sum(float(o.estimated_hours or 0) for o in ops)
    hours_done = sum(float(o.estimated_hours or 0) for o in done)
    if hours_total > 0:
        percent = round(100 * hours_done / hours_total)
    else:
        percent = round(100 * len(done) / len(ops)) if ops else 0
    items = []
    for o in ops:
        status = _value(o.status)
        state = "done" if status == "COMPLETED" else ("now" if status == "IN_PROGRESS" else "next")
        items.append({"name": o.operation_name or "Operation", "state": state})
    current = next((o for o in ops if _value(o.status) == "IN_PROGRESS"), None) or next(
        (o for o in ops if _value(o.status) != "COMPLETED"), None
    )
    starts = [o.scheduled_start for o in ops if o.scheduled_start]
    ends = [o.scheduled_end for o in ops if o.scheduled_end]
    finish = _shop_date(max(ends)) if ends else None
    due = getattr(job, "due_date", None)
    return {
        "operations": items,
        "done": len(done),
        "total": len(ops),
        "percent": max(0, min(100, percent)),
        "current": current.operation_name if current is not None else None,
        "stage": PART_STAGE_LABEL.get(_value(getattr(job, "part_condition", None)) or ""),
        "start": _shop_date(min(starts)) if starts else None,
        "finish": finish,
        "due": due,
        "onTrack": bool(finish and due and finish <= due) if finish and due else None,
    }


def working_days(start: date | None, end: date | None) -> int | None:
    """Mon-Sat days from start to end, both included."""
    if not start or not end or end < start:
        return None
    days, d = 0, start
    while d <= end:
        if d.weekday() != 6:
            days += 1
        d += timedelta(days=1)
    return days


def is_short_job(progress: dict) -> bool:
    span = working_days(progress.get("start"), progress.get("finish"))
    return span is not None and span <= SHORT_JOB_WORKING_DAYS


def halfway_reached(job) -> bool:
    p = job_progress(job)
    return p["total"] > 1 and p["done"] < p["total"] and p["percent"] >= HALFWAY_PERCENT


def is_final_stage_start(job, operation) -> bool:
    """The operation just started is the last one left on a job of two or more."""
    ops = list(getattr(job, "operations", None) or [])
    if len(ops) < 2:
        return False
    return all(_value(o.status) == "COMPLETED" for o in ops if o.id != operation.id)


def shop_day_start_utc(now: datetime | None = None) -> datetime:
    """Midnight today in shop time, as UTC."""
    from datetime import timezone

    now = now or datetime.now(timezone.utc)
    today = utc_to_shop(now).date()
    return datetime.combine(today, time(0, 0), tzinfo=SHOP_TZ).astimezone(timezone.utc)


def delay_reason(job) -> str | None:
    """The client-facing reason of the latest schedule move, when there is one."""
    try:
        from app.models.schedule_move import ScheduleMove

        move = (
            ScheduleMove.query.filter_by(job_order_id=job.id)
            .order_by(ScheduleMove.moved_at.desc())
            .first()
        )
    except Exception:  # noqa: BLE001 - the reason is optional
        return None
    return DELAY_REASON.get(move.kind) if move is not None else None
