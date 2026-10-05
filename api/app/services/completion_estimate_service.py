"""Completion estimates from past performance (objective 4.3).

Each operation type has a ratio of hours worked to target hours, taken from
completed original operations (redo operations are left out). With fewer than
MIN_SAMPLES of them the ratio is 1.0 and the estimate says so.

A released job's remaining operations are placed one after another from now,
in operation order, across each worker's working hours, overtime and
holidays: a pending operation takes target hours x ratio; an in-progress one
takes whatever is left of (target hours x ratio) after the hours worked so far.
Other jobs' bookings are not considered: the estimate answers "when would this
finish at our usual pace", next to the confirmed schedule.

``sync_at_risk_alert`` raises one bell alert (Admin and Office Staff) each time
a job turns at risk of missing its required date, and re-arms once it is back
on time. It runs after operation events, schedule confirms and job edits, and
over every released job with the page-open and daily overdue checks.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from flask import g, has_app_context
from sqlalchemy import event, func
from sqlalchemy.orm import Session

from app.constants.scheduling import SCHEDULE_HORIZON_DAYS
from app.extensions import db
from app.models.job_order import JobOrder, JobOrderStatus
from app.models.operation import JobOperation, OperationStatus
from app.models.operation_time import OperationTimeEvent
from app.models.staff_alert import StaffAlertKind
from app.models.user import UserRole
from app.models.worker_skill import OperationType
from app.services.schedule_calendar import (
    build_worker_working_windows,
    default_shop_schedule_by_dow,
    ensure_utc,
    intersect_intervals,
    load_calendar_exceptions,
    load_worker_schedule_maps,
    place_duration,
    utc_to_shop,
)

log = logging.getLogger(__name__)

MIN_SAMPLES = 5
RELEASED = (JobOrderStatus.SCHEDULED, JobOrderStatus.IN_PROGRESS)
AT_RISK_FLAGS = ("AMBER", "RED")
LABEL = "Estimate based on past performance"
_RATIO_CACHE_KEY = "_completion_ratio_cache"


def _now():
    return datetime.now(timezone.utc)


def _compute_type_ratios() -> dict:
    rows = (
        db.session.query(
            JobOperation.operation_type_id,
            OperationType.name,
            func.count(JobOperation.id),
            func.sum(JobOperation.actual_worked_hours),
            func.sum(JobOperation.estimated_hours),
        )
        .join(OperationType, OperationType.id == JobOperation.operation_type_id)
        .filter(
            JobOperation.status == OperationStatus.COMPLETED,
            JobOperation.rework_of_operation_id.is_(None),
            JobOperation.operation_type_id.isnot(None),
            JobOperation.actual_worked_hours.isnot(None),
            JobOperation.estimated_hours > 0,
        )
        .group_by(JobOperation.operation_type_id, OperationType.name)
        .all()
    )
    out = {}
    for type_id, type_name, n, worked, target in rows:
        enough = n >= MIN_SAMPLES and target
        out[type_id] = {
            "operationTypeId": type_id,
            "operationTypeName": type_name,
            "samples": int(n),
            "enoughHistory": bool(enough),
            "ratio": round(float(worked) / float(target), 3) if enough else 1.0,
        }
    return out


def _clear_ratio_cache(_session=None):
    if has_app_context():
        g.pop(_RATIO_CACHE_KEY, None)


event.listen(Session, "after_commit", _clear_ratio_cache)


def type_ratios() -> dict:
    """{operation type id: {ratio, samples, enoughHistory, ...}}, cached per request."""
    if not has_app_context():
        return _compute_type_ratios()
    cached = g.get(_RATIO_CACHE_KEY)
    if cached is None:
        cached = _compute_type_ratios()
        setattr(g, _RATIO_CACHE_KEY, cached)
    return cached


def ratio_for(op, ratios: dict) -> dict:
    info = ratios.get(op.operation_type_id)
    if info:
        return info
    return {
        "operationTypeId": op.operation_type_id,
        "operationTypeName": op.operation_type.name if op.operation_type else None,
        "samples": 0,
        "enoughHistory": False,
        "ratio": 1.0,
    }


def _worker_windows(worker_id, start, end):
    schedule = load_worker_schedule_maps(worker_id) if worker_id else {}
    if not schedule:
        schedule = default_shop_schedule_by_dow()
    exceptions = load_calendar_exceptions(utc_to_shop(start).date(), utc_to_shop(end).date())
    return build_worker_working_windows(schedule, exceptions, start, end)


def hours_worked_so_far(op, now: datetime) -> float:
    """Closed START/RESUME -> PAUSE/COMPLETE spans, plus a running span up to now
    counted only within the worker's working hours."""
    logs = sorted(op.time_logs or [], key=lambda L: ensure_utc(L.event_at))
    total = 0.0
    open_at = None
    for log in logs:
        at = ensure_utc(log.event_at)
        if log.event in (OperationTimeEvent.START, OperationTimeEvent.RESUME):
            open_at = open_at or at
        elif log.event in (OperationTimeEvent.PAUSE, OperationTimeEvent.COMPLETE):
            if open_at and at > open_at:
                total += (at - open_at).total_seconds()
            open_at = None
    if open_at and now > open_at:
        windows = _worker_windows(op.assigned_worker_id, open_at, now)
        total += sum((e - s).total_seconds() for s, e in intersect_intervals([(open_at, now)], windows))
    return total / 3600.0


def predict_job(job, now: datetime | None = None, ratios: dict | None = None) -> dict | None:
    """Predicted finish of a released job's remaining operations, or None."""
    if job.status not in RELEASED:
        return None
    now = ensure_utc(now or _now())
    ratios = type_ratios() if ratios is None else ratios
    remaining = sorted(
        (o for o in job.operations or [] if o.status != OperationStatus.COMPLETED),
        key=lambda o: o.sequence_no or 0,
    )
    if not remaining:
        return None

    cursor = now
    rows = []
    for op in remaining:
        info = ratio_for(op, ratios)
        predicted_total = float(op.estimated_hours or 0) * info["ratio"]
        worked = hours_worked_so_far(op, now) if op.status == OperationStatus.IN_PROGRESS else 0.0
        hours_left = max(predicted_total - worked, 0.0)
        start = end = cursor
        if hours_left > 0:
            horizon = cursor + timedelta(days=SCHEDULE_HORIZON_DAYS)
            windows = _worker_windows(op.assigned_worker_id, cursor, horizon)
            start, end, _ = place_duration(windows, timedelta(hours=hours_left), cursor, horizon)
            if start is None:
                return None
        rows.append(
            {
                "operationId": op.id,
                "sequenceNo": op.sequence_no,
                "operationName": op.operation_name,
                "operationTypeName": info["operationTypeName"],
                "ratio": info["ratio"],
                "samples": info["samples"],
                "enoughHistory": info["enoughHistory"],
                "targetHours": float(op.estimated_hours or 0),
                "hoursWorked": round(worked, 2),
                "predictedHoursLeft": round(hours_left, 2),
                "predictedStart": start.isoformat(),
                "predictedEnd": end.isoformat(),
            }
        )
        cursor = end

    thin = sorted({r["operationTypeName"] or r["operationName"] for r in rows if not r["enoughHistory"]})
    return {
        "label": LABEL,
        "predictedFinish": cursor.isoformat(),
        "minSamples": MIN_SAMPLES,
        "operations": rows,
        "notEnoughHistoryNote": (
            f"Fewer than {MIN_SAMPLES} completed operations for {', '.join(thin)}: "
            "target hours used as they are (ratio 1.0)."
            if thin
            else None
        ),
    }


def risk_state(job, now: datetime | None = None) -> dict:
    """Scheduled finish, predicted finish, and the flag from whichever is later."""
    from app.services.schedule_service import compute_schedule_flag

    ends = [ensure_utc(o.scheduled_end) for o in job.operations or [] if o.scheduled_end]
    scheduled = max(ends) if ends else None
    estimate = predict_job(job, now)
    predicted = datetime.fromisoformat(estimate["predictedFinish"]) if estimate else None
    later = max((d for d in (scheduled, predicted) if d), default=None)
    return {
        "scheduled": scheduled,
        "estimate": estimate,
        "predicted": predicted,
        "flag": compute_schedule_flag(later, job.due_date) if later and job.due_date else None,
        "basis": "ESTIMATE" if predicted and (not scheduled or predicted > scheduled) else "SCHEDULE",
    }


def sync_at_risk_alert(job, now: datetime | None = None) -> bool:
    """Alert Admin and Office Staff when the job turns at risk; re-arm when it is
    back on time. Returns True when an alert was raised. Does not commit."""
    from app.services.staff_alert_service import raise_alert

    state = risk_state(job, now) if job.status in RELEASED else None
    at_risk = bool(state and state["flag"] in AT_RISK_FLAGS)
    if not at_risk:
        if job.at_risk_alerted:
            job.at_risk_alerted = False
        return False
    if job.at_risk_alerted:
        return False
    finish = state["predicted"] if state["basis"] == "ESTIMATE" else state["scheduled"]
    which = "Estimated finish (based on past performance)" if state["basis"] == "ESTIMATE" else "Scheduled finish"
    raise_alert(
        roles=[UserRole.ADMIN, UserRole.OFFICE_STAFF],
        kind=StaffAlertKind.JOB_AT_RISK,
        title=f"{job.job_number} may miss its required date",
        message=(
            f"{job.title}: {which} {utc_to_shop(finish):%b %d, %Y %H:%M}; "
            f"required {job.due_date:%b %d, %Y}."
        ),
        job_order_id=job.id,
    )
    job.at_risk_alerted = True
    return True


def sync_jobs(jobs) -> int:
    """Run ``sync_at_risk_alert`` for several jobs and commit. Returns alerts
    raised. Never raises: the action that triggered the check has already been
    saved."""
    raised = 0
    try:
        for job in jobs:
            if job is not None and sync_at_risk_alert(job):
                raised += 1
        db.session.commit()
    except Exception:
        db.session.rollback()
        log.exception("At-risk check failed")
        return 0
    return raised


def check_released_jobs() -> int:
    """Sweep every released job (page opens and the daily check)."""
    jobs = JobOrder.query.filter(JobOrder.status.in_(RELEASED)).all()
    alerted = JobOrder.query.filter(
        JobOrder.status.notin_(RELEASED), JobOrder.at_risk_alerted.is_(True)
    ).all()
    for job in alerted:
        job.at_risk_alerted = False
    return sync_jobs(jobs)


def after_operation_change(operation):
    sync_jobs([operation.job_order])
    return operation
