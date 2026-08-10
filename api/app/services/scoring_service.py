"""Weighted scoring components for worker recommendation."""

from __future__ import annotations

import logging
from datetime import datetime, time, timedelta, timezone

from app.models.operation import JobOperation, OperationStatus
from app.models.scoring_weight import DEFAULT_SCORING_WEIGHTS, ScoringWeight
from app.models.worker_skill import CalendarExceptionType, WorkCalendarException, WorkerSchedule
from app.extensions import db
from app.services.worker_availability import _parse_dt, _windows_overlap, list_worker_operations

logger = logging.getLogger(__name__)

WEIGHT_KEYS = ("skill", "availability", "workload", "efficiency")
COLD_START_MIN_SAMPLES = 3
EFFICIENCY_RATIO_CAP = 1.5


def load_scoring_weights():
    """Load weights from DB; fall back to defaults if rows/table are missing."""
    from sqlalchemy.exc import OperationalError, ProgrammingError

    try:
        rows = {row.key: float(row.value) for row in ScoringWeight.query.all()}
    except (ProgrammingError, OperationalError):
        db.session.rollback()
        return {k: float(v) for k, v in DEFAULT_SCORING_WEIGHTS.items()}

    weights = {}
    for key in WEIGHT_KEYS:
        if key in rows:
            weights[key] = rows[key]
        else:
            weights[key] = float(DEFAULT_SCORING_WEIGHTS[key])
    return weights


def validate_weights_sum(weights, tolerance=1e-6):
    total = sum(float(weights.get(k, 0)) for k in WEIGHT_KEYS)
    return abs(total - 1.0) <= tolerance, total


def score_skill(proficiency=None, is_primary=False):
    """
    Returns (score 0..1, reason fragment, used_default).
    No skill row → 0.0 (not a default — measured absence).
    """
    if proficiency is None:
        return 0.0, "no skill for this machine", False
    raw = float(proficiency) / 5.0
    if is_primary:
        raw = min(1.0, raw + 0.1)
    else:
        raw = min(1.0, max(0.0, raw))
    primary_note = ", primary skill" if is_primary else ""
    return raw, f"proficiency {int(proficiency)}{primary_note}", False


def _combine_intervals(base_start, base_end, extra_start, extra_end):
    """Merge two time intervals on the same day; None means empty."""
    intervals = []
    if base_start is not None and base_end is not None and base_start < base_end:
        intervals.append((base_start, base_end))
    if extra_start is not None and extra_end is not None and extra_start < extra_end:
        intervals.append((extra_start, extra_end))
    if not intervals:
        return None, None
    intervals.sort()
    merged_start, merged_end = intervals[0]
    for s, e in intervals[1:]:
        if s <= merged_end:
            merged_end = max(merged_end, e)
        else:
            # Disjoint: keep span covering both for containment checks
            merged_start = min(merged_start, s)
            merged_end = max(merged_end, e)
    return merged_start, merged_end


def _effective_hours_for_date(worker_id, on_date, schedule_by_dow, exceptions_by_date):
    """
    Return (start_time, end_time, is_working) for a calendar date,
    applying WorkerSchedule + WorkCalendarException.
    """
    dow = on_date.weekday()  # 0=Mon … 6=Sun
    sched = schedule_by_dow.get(dow)
    exc = exceptions_by_date.get(on_date)

    if exc and exc.type == CalendarExceptionType.HOLIDAY_NO_WORK:
        return None, None, False

    base_working = bool(sched and sched.is_working and sched.start_time and sched.end_time)
    base_start = sched.start_time if base_working else None
    base_end = sched.end_time if base_working else None

    if exc and exc.type in (
        CalendarExceptionType.OVERTIME,
        CalendarExceptionType.SPECIAL_WORKING_DAY,
    ):
        if exc.start_time and exc.end_time:
            if base_working:
                start, end = _combine_intervals(
                    base_start, base_end, exc.start_time, exc.end_time
                )
                return start, end, True
            return exc.start_time, exc.end_time, True
        if not base_working:
            # Special day without hours: treat as full shop day
            return time(8, 0), time(17, 0), True

    if base_working:
        return base_start, base_end, True
    return None, None, False


def _window_vs_hours(window_start, window_end, day_start_t, day_end_t, on_date):
    """
    Classify how much of the window on `on_date` falls inside working hours.
    Returns 'inside' | 'partial' | 'outside' | 'none' (no overlap with that day).
    """
    day_start = datetime.combine(on_date, time.min, tzinfo=window_start.tzinfo)
    day_end = day_start + timedelta(days=1)
    seg_start = max(window_start, day_start)
    seg_end = min(window_end, day_end)
    if seg_start >= seg_end:
        return "none"

    if day_start_t is None or day_end_t is None:
        return "outside"

    work_start = datetime.combine(on_date, day_start_t, tzinfo=window_start.tzinfo)
    work_end = datetime.combine(on_date, day_end_t, tzinfo=window_start.tzinfo)
    if seg_start >= work_start and seg_end <= work_end:
        return "inside"
    if seg_end <= work_start or seg_start >= work_end:
        return "outside"
    return "partial"


def score_availability(
    worker_id,
    scheduled_start=None,
    scheduled_end=None,
    exclude_operation_id=None,
    *,
    schedules=None,
    exceptions=None,
    operations=None,
):
    """
    Returns (score, reason fragment, used_default).
    No proposed window → neutral 0.5 (default, disclosed).
    """
    start = _parse_dt(scheduled_start)
    end = _parse_dt(scheduled_end)

    if not start or not end or end <= start:
        return (
            0.5,
            "no proposed window yet (neutral default)",
            True,
        )

    if operations is None:
        operations = list_worker_operations(
            worker_id, exclude_operation_id=exclude_operation_id
        )
    for op in operations:
        if _windows_overlap(start, end, op.scheduled_start, op.scheduled_end):
            label = op.operation_name or "another operation"
            return 0.0, f"conflicts with '{label}'", False

    if schedules is None:
        schedules = WorkerSchedule.query.filter_by(worker_id=worker_id).all()
    schedule_by_dow = {s.day_of_week: s for s in schedules}

    d0 = start.date()
    d1 = (end - timedelta(microseconds=1)).date() if end.time() == time.min else end.date()
    if exceptions is None:
        exceptions = WorkCalendarException.query.filter(
            WorkCalendarException.date >= d0,
            WorkCalendarException.date <= d1,
        ).all()
    exceptions_by_date = {e.date: e for e in exceptions}

    day_statuses = []
    cur = d0
    while cur <= d1:
        day_start_t, day_end_t, is_working = _effective_hours_for_date(
            worker_id, cur, schedule_by_dow, exceptions_by_date
        )
        if not is_working:
            day_start_t, day_end_t = None, None
        status = _window_vs_hours(start, end, day_start_t, day_end_t, cur)
        if status != "none":
            day_statuses.append(status)
        cur += timedelta(days=1)

    if not day_statuses:
        return 0.0, "outside working hours", False
    if all(s == "inside" for s in day_statuses):
        return 1.0, "free that window", False
    if all(s == "outside" for s in day_statuses):
        return 0.0, "outside working hours", False
    return 0.5, "window partly outside working hours", False


def current_week_bounds(now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    monday = (now - timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    next_monday = monday + timedelta(days=7)
    return monday, next_monday


def worker_week_load_hours(worker_id, now=None, exclude_operation_id=None, operations=None):
    """Sum estimated_hours for SCHEDULED/IN_PROGRESS ops in the current week."""
    week_start, week_end = current_week_bounds(now)
    if operations is None:
        operations = JobOperation.query.filter(
            JobOperation.assigned_worker_id == worker_id,
            JobOperation.status.in_(
                (OperationStatus.SCHEDULED, OperationStatus.IN_PROGRESS)
            ),
        ).all()

    total = 0.0
    for op in operations:
        if exclude_operation_id and op.id == exclude_operation_id:
            continue
        if op.status not in (OperationStatus.SCHEDULED, OperationStatus.IN_PROGRESS):
            continue
        # Include if scheduled into this week, or unscheduled active load
        if op.scheduled_start is not None:
            ss = op.scheduled_start
            if ss.tzinfo is None:
                ss = ss.replace(tzinfo=timezone.utc)
            if ss < week_start or ss >= week_end:
                # still count if window overlaps week
                se = op.scheduled_end
                if se is None:
                    continue
                if se.tzinfo is None:
                    se = se.replace(tzinfo=timezone.utc)
                if se <= week_start or ss >= week_end:
                    continue
        hours = float(op.estimated_hours or 0)
        total += hours
    return total


def score_workload(worker_hours, peer_hours_list):
    """
    Min-max among peers: lightest → 1.0, heaviest → 0.0.
    All equal → 1.0.
    Returns (score, reason fragment, used_default).
    """
    peers = list(peer_hours_list)
    if not peers:
        return 1.0, "no peer workload to compare (neutral)", True

    lo = min(peers)
    hi = max(peers)
    if abs(hi - lo) < 1e-9:
        return 1.0, "equal load with peers this week", False

    # lightest (lo) → 1.0, heaviest (hi) → 0.0
    score = (hi - float(worker_hours)) / (hi - lo)
    score = max(0.0, min(1.0, score))
    if score >= 0.75:
        label = "light load this week"
    elif score <= 0.25:
        label = "heavy load this week"
    else:
        label = "moderate load this week"
    return score, f"{label} ({worker_hours:.1f}h)", False


def score_efficiency(completed_pairs):
    """
    completed_pairs: iterable of (estimated_hours, actual_hours) for same op type.
    Cold start (<3) → 0.5 default.
    Returns (score, reason fragment, used_default).
    """
    pairs = [
        (float(e), float(a))
        for e, a in completed_pairs
        if e is not None and a is not None and float(a) > 0
    ]
    if len(pairs) < COLD_START_MIN_SAMPLES:
        return (
            0.5,
            "no completion history yet (neutral default)",
            True,
        )

    ratios = []
    for est, act in pairs:
        ratio = est / act
        ratio = max(0.0, min(EFFICIENCY_RATIO_CAP, ratio))
        ratios.append(ratio / EFFICIENCY_RATIO_CAP)

    avg = sum(ratios) / len(ratios)
    return avg, f"efficiency from {len(pairs)} completed ops", False


def combine_score(weights, components, qualified=True):
    if not qualified:
        return 0.0
    total = 0.0
    for key in WEIGHT_KEYS:
        total += float(weights[key]) * float(components[key])
    return round(max(0.0, min(1.0, total)), 4)


def build_reason(parts, machine_label=None, unqualified=False):
    if unqualified:
        label = machine_label or "this machine"
        return f"No {label} skill — cannot operate this machine"
    # parts: list of (fragment, used_default)
    chunks = [p for p, _ in parts if p]
    return ", ".join(chunks) if chunks else "No scoring signals"


def fetch_efficiency_pairs(worker_id, operation_type_id):
    if not operation_type_id:
        return []
    ops = JobOperation.query.filter(
        JobOperation.assigned_worker_id == worker_id,
        JobOperation.operation_type_id == operation_type_id,
        JobOperation.status == OperationStatus.COMPLETED,
        JobOperation.actual_start.isnot(None),
        JobOperation.actual_end.isnot(None),
        JobOperation.estimated_hours.isnot(None),
    ).all()
    pairs = []
    for op in ops:
        delta = op.actual_end - op.actual_start
        actual_hours = delta.total_seconds() / 3600.0
        if actual_hours <= 0:
            continue
        pairs.append((float(op.estimated_hours), actual_hours))
    return pairs


def log_weights_used(weights, context="suggest"):
    logger.info(
        "scoring weights used (%s): skill=%.4f availability=%.4f workload=%.4f efficiency=%.4f",
        context,
        weights["skill"],
        weights["availability"],
        weights["workload"],
        weights["efficiency"],
    )
