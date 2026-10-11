"""Completion estimates from past performance (objective 4.3).

Each operation type has a ratio of hours worked to target hours, taken from
completed original operations (redo operations are left out). With fewer than
MIN_SAMPLES of them the ratio is 1.0 and the estimate says so. When the
operation's lead worker has MIN_SAMPLES of that type, their own ratio is used;
otherwise the machine unit's when it has MIN_SAMPLES; otherwise the type's.

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
from collections import defaultdict
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
    hours_excluding_break,
    intersect_intervals,
    load_calendar_exceptions,
    load_crew_schedule_map,
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


_HISTORY_FILTERS = (
    JobOperation.status == OperationStatus.COMPLETED,
    JobOperation.rework_of_operation_id.is_(None),
    JobOperation.operation_type_id.isnot(None),
    JobOperation.actual_worked_hours.isnot(None),
    JobOperation.estimated_hours > 0,
    OperationType.is_outsourced.is_(False),
)


def _ratio_info(n, worked, target, **extra) -> dict:
    enough = n >= MIN_SAMPLES and target
    return {
        **extra,
        "samples": int(n),
        "enoughHistory": bool(enough),
        "ratio": round(float(worked) / float(target), 3) if enough else 1.0,
    }


def _compute_ratios() -> tuple[dict, dict]:
    """(type ratios, detail ratios) from one grouped query.

    Type ratios: {operation type id: info}. Detail ratios:
    {("WORKER", type id, worker id) | ("MACHINE", type id, unit id): info} for
    pairs with at least MIN_SAMPLES completed operations.
    """
    rows = (
        db.session.query(
            JobOperation.operation_type_id,
            OperationType.name,
            JobOperation.assigned_worker_id,
            JobOperation.machine_unit_id,
            func.count(JobOperation.id),
            func.sum(JobOperation.actual_worked_hours),
            func.sum(JobOperation.estimated_hours),
        )
        .join(OperationType, OperationType.id == JobOperation.operation_type_id)
        .filter(*_HISTORY_FILTERS)
        .group_by(
            JobOperation.operation_type_id,
            OperationType.name,
            JobOperation.assigned_worker_id,
            JobOperation.machine_unit_id,
        )
        .all()
    )
    names = {}
    sums = defaultdict(lambda: [0, 0.0, 0.0])
    for type_id, type_name, worker_id, unit_id, n, worked, target in rows:
        names[type_id] = type_name
        keys = [("TYPE", type_id, None)]
        if worker_id:
            keys.append(("WORKER", type_id, worker_id))
        if unit_id:
            keys.append(("MACHINE", type_id, unit_id))
        for key in keys:
            acc = sums[key]
            acc[0] += int(n)
            acc[1] += float(worked or 0)
            acc[2] += float(target or 0)
    types, details = {}, {}
    for (basis, type_id, key), (n, worked, target) in sums.items():
        info = _ratio_info(
            n, worked, target, operationTypeId=type_id, operationTypeName=names[type_id]
        )
        if basis == "TYPE":
            types[type_id] = info
        elif n >= MIN_SAMPLES:
            details[(basis, type_id, key)] = info
    return types, details


def _clear_ratio_cache(_session=None):
    if has_app_context():
        g.pop(_RATIO_CACHE_KEY, None)


event.listen(Session, "after_commit", _clear_ratio_cache)


def _ratios() -> tuple[dict, dict]:
    if not has_app_context():
        return _compute_ratios()
    cached = g.get(_RATIO_CACHE_KEY)
    if cached is None:
        cached = _compute_ratios()
        setattr(g, _RATIO_CACHE_KEY, cached)
    return cached


def type_ratios() -> dict:
    """{operation type id: {ratio, samples, enoughHistory, ...}}, cached per request."""
    return _ratios()[0]


def detail_ratios() -> dict:
    """Worker and machine ratios (see ``_compute_ratios``), cached per request."""
    return _ratios()[1]


def ratio_for(op, ratios: dict, details: dict | None = None) -> dict:
    """The lead worker's ratio for this type, else the machine unit's, else the type's."""
    details = {} if details is None else details
    for basis, key in (("WORKER", op.assigned_worker_id), ("MACHINE", op.machine_unit_id)):
        info = details.get((basis, op.operation_type_id, key)) if key else None
        if info and info["enoughHistory"]:
            return {**info, "basis": basis}
    info = ratios.get(op.operation_type_id)
    if info:
        return {**info, "basis": "TYPE" if info["enoughHistory"] else "DEFAULT"}
    return {
        "operationTypeId": op.operation_type_id,
        "operationTypeName": op.operation_type.name if op.operation_type else None,
        "samples": 0,
        "enoughHistory": False,
        "ratio": 1.0,
        "basis": "DEFAULT",
    }


def _worker_windows(crew_ids, start, end):
    """Working windows shared by the whole crew."""
    schedule = load_crew_schedule_map(crew_ids) if crew_ids else {}
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
                total += hours_excluding_break(open_at, at) * 3600.0
            open_at = None
    if open_at and now > open_at:
        windows = _worker_windows(op.crew_ids, open_at, now)
        total += sum((e - s).total_seconds() for s, e in intersect_intervals([(open_at, now)], windows))
    return total / 3600.0


def predict_job(
    job, now: datetime | None = None, ratios: dict | None = None, details: dict | None = None
) -> dict | None:
    """Predicted finish of a released job's remaining operations, or None."""
    if job.status not in RELEASED:
        return None
    now = ensure_utc(now or _now())
    ratios = type_ratios() if ratios is None else ratios
    details = detail_ratios() if details is None else details
    remaining = sorted(
        (o for o in job.operations or [] if o.status != OperationStatus.COMPLETED),
        key=lambda o: o.sequence_no or 0,
    )
    if not remaining:
        return None

    cursor = now
    rows = []
    for op in remaining:
        if op.is_outsourced:
            # Back after its turnaround in calendar days, or now when it's late.
            days = timedelta(days=int(op.turnaround_days or 0))
            sent = ensure_utc(op.actual_start) if op.actual_start else None
            start = sent or cursor
            end = max(cursor, start + days)
            rows.append(
                {
                    "operationId": op.id,
                    "sequenceNo": op.sequence_no,
                    "operationName": op.operation_name,
                    "operationTypeName": op.operation_type.name if op.operation_type else None,
                    "ratio": 1.0,
                    "samples": 0,
                    "enoughHistory": True,
                    "basis": "OUTSOURCED",
                    "targetHours": 0.0,
                    "hoursWorked": 0.0,
                    "predictedHoursLeft": 0.0,
                    "predictedStart": start.isoformat(),
                    "predictedEnd": end.isoformat(),
                    "isOutsourced": True,
                    "turnaroundDays": op.turnaround_days,
                }
            )
            cursor = end
            continue
        info = ratio_for(op, ratios, details)
        predicted_total = float(op.estimated_hours or 0) * info["ratio"]
        worked = hours_worked_so_far(op, now) if op.status == OperationStatus.IN_PROGRESS else 0.0
        hours_left = max(predicted_total - worked, 0.0)
        start = end = cursor
        if hours_left > 0:
            horizon = cursor + timedelta(days=SCHEDULE_HORIZON_DAYS)
            windows = _worker_windows(op.crew_ids, cursor, horizon)
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
                "basis": info["basis"],
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
    from app.services.job_order_service import job_list_load_options

    jobs = (
        JobOrder.query.options(*job_list_load_options())
        .filter(JobOrder.status.in_(RELEASED))
        .all()
    )
    alerted = JobOrder.query.filter(
        JobOrder.status.notin_(RELEASED), JobOrder.at_risk_alerted.is_(True)
    ).all()
    for job in alerted:
        job.at_risk_alerted = False
    return sync_jobs(jobs)


def after_operation_change(operation):
    sync_jobs([operation.job_order])
    return operation
