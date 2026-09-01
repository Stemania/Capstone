"""Working-window and interval helpers for earliest-fit scheduling."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.constants.scheduling import SCHEDULE_HORIZON_DAYS, SHOP_TIMEZONE
from app.models.worker_skill import CalendarExceptionType, WorkCalendarException, WorkerSchedule

SHOP_TZ = ZoneInfo(SHOP_TIMEZONE)


def ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def shop_now() -> datetime:
    return datetime.now(SHOP_TZ)


def utc_to_shop(dt: datetime) -> datetime:
    return ensure_utc(dt).astimezone(SHOP_TZ)


def shop_local_to_utc(on_date: date, t: time) -> datetime:
    return datetime.combine(on_date, t, tzinfo=SHOP_TZ).astimezone(timezone.utc)


def horizon_end_utc(anchor_utc: datetime) -> datetime:
    anchor_shop = utc_to_shop(anchor_utc)
    end_shop = anchor_shop + timedelta(days=SCHEDULE_HORIZON_DAYS)
    return end_shop.astimezone(timezone.utc)


def merge_intervals(intervals: list[tuple[datetime, datetime]]) -> list[tuple[datetime, datetime]]:
    if not intervals:
        return []
    sorted_iv = sorted((ensure_utc(s), ensure_utc(e)) for s, e in intervals if e > s)
    if not sorted_iv:
        return []
    merged = [sorted_iv[0]]
    for start, end in sorted_iv[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def intersect_intervals(
    a: list[tuple[datetime, datetime]],
    b: list[tuple[datetime, datetime]],
) -> list[tuple[datetime, datetime]]:
    result = []
    for a_start, a_end in merge_intervals(a):
        for b_start, b_end in merge_intervals(b):
            start = max(a_start, b_start)
            end = min(a_end, b_end)
            if end > start:
                result.append((start, end))
    return merge_intervals(result)


def subtract_intervals(
    free: list[tuple[datetime, datetime]],
    busy: list[tuple[datetime, datetime]],
) -> list[tuple[datetime, datetime]]:
    segments = merge_intervals(free)
    for b_start, b_end in merge_intervals(busy):
        next_segments = []
        for s, e in segments:
            if b_end <= s or b_start >= e:
                next_segments.append((s, e))
            else:
                if s < b_start:
                    next_segments.append((s, b_start))
                if b_end < e:
                    next_segments.append((b_end, e))
        segments = next_segments
    return merge_intervals(segments)


def clip_intervals_to_horizon(
    intervals: list[tuple[datetime, datetime]],
    anchor_utc: datetime,
    end_utc: datetime,
) -> list[tuple[datetime, datetime]]:
    anchor_utc = ensure_utc(anchor_utc)
    end_utc = ensure_utc(end_utc)
    clipped = []
    for start, end in intervals:
        s = max(start, anchor_utc)
        e = min(end, end_utc)
        if e > s:
            clipped.append((s, e))
    return merge_intervals(clipped)


def total_placeable_hours(
    intervals: list[tuple[datetime, datetime]],
    not_before: datetime,
    end_utc: datetime,
) -> float:
    not_before = ensure_utc(not_before)
    end_utc = ensure_utc(end_utc)
    total_seconds = 0.0
    for start, end in intervals:
        s = max(start, not_before)
        e = min(end, end_utc)
        if e > s:
            total_seconds += (e - s).total_seconds()
    return total_seconds / 3600.0


def place_duration(
    intervals: list[tuple[datetime, datetime]],
    duration: timedelta,
    not_before: datetime,
    end_utc: datetime,
) -> tuple[datetime | None, datetime | None, float]:
    """
    Place contiguous working time summing to `duration` within merged free intervals.
    Returns (start_utc, end_utc, placeable_hours_within_horizon).
    """
    not_before = ensure_utc(not_before)
    end_utc = ensure_utc(end_utc)
    remaining = duration.total_seconds()
    if remaining <= 0:
        return not_before, not_before, 0.0

    placeable_hours = total_placeable_hours(intervals, not_before, end_utc)
    start_result = None
    end_result = None

    for seg_start, seg_end in merge_intervals(intervals):
        if seg_end <= not_before:
            continue
        seg_start_eff = max(seg_start, not_before)
        if seg_start_eff >= end_utc:
            break
        seg_end_eff = min(seg_end, end_utc)
        available = (seg_end_eff - seg_start_eff).total_seconds()
        if available <= 0:
            continue
        if start_result is None:
            start_result = seg_start_eff
        take = min(available, remaining)
        remaining -= take
        end_result = seg_start_eff + timedelta(seconds=take)
        if remaining <= 1e-9:
            return start_result, end_result, placeable_hours

    return None, None, placeable_hours


def derive_working_segments(
    start_utc: datetime,
    end_utc: datetime,
    schedule_by_dow,
    exceptions_by_date,
) -> list[tuple[datetime, datetime]]:
    """
    Read-time only: intersect [scheduled_start, scheduled_end] with the worker's
    working windows. Single source of truth for derived segments — do not
    reimplement this intersection elsewhere.
    """
    start_utc = ensure_utc(start_utc)
    end_utc = ensure_utc(end_utc)
    if end_utc <= start_utc:
        return []
    windows = build_worker_working_windows(
        schedule_by_dow, exceptions_by_date, start_utc, end_utc
    )
    return intersect_intervals([(start_utc, end_utc)], windows)


def serialize_segments(
    segments: list[tuple[datetime, datetime]],
) -> list[dict[str, str]]:
    return [
        {"start": ensure_utc(s).isoformat(), "end": ensure_utc(e).isoformat()}
        for s, e in segments
    ]


def combine_intervals(base_start, base_end, extra_start, extra_end):
    """Merge two time intervals on the same calendar day."""
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
            merged_start = min(merged_start, s)
            merged_end = max(merged_end, e)
    return merged_start, merged_end


def effective_hours_for_date(on_date, schedule_by_dow, exceptions_by_date):
    """
    Return (start_time, end_time, is_working) for a shop-local calendar date,
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
                start, end = combine_intervals(
                    base_start, base_end, exc.start_time, exc.end_time
                )
                return start, end, True
            return exc.start_time, exc.end_time, True
        if not base_working:
            return time(8, 0), time(17, 0), True

    if base_working:
        return base_start, base_end, True
    return None, None, False


def build_worker_working_windows(
    schedule_by_dow,
    exceptions_by_date,
    anchor_utc: datetime,
    end_utc: datetime,
) -> list[tuple[datetime, datetime]]:
    """Expand worker schedule + calendar exceptions into UTC working intervals."""
    anchor_shop = utc_to_shop(anchor_utc)
    end_shop = utc_to_shop(end_utc)
    windows = []
    cur = anchor_shop.date()
    last = end_shop.date()
    while cur <= last:
        day_start_t, day_end_t, is_working = effective_hours_for_date(
            cur, schedule_by_dow, exceptions_by_date
        )
        if is_working and day_start_t and day_end_t:
            w_start = shop_local_to_utc(cur, day_start_t)
            w_end = shop_local_to_utc(cur, day_end_t)
            if w_end > anchor_utc and w_start < end_utc:
                windows.append((max(w_start, anchor_utc), min(w_end, end_utc)))
        cur += timedelta(days=1)
    return merge_intervals(windows)


def load_worker_schedule_maps(worker_id):
    schedules = WorkerSchedule.query.filter_by(worker_id=worker_id).all()
    schedule_by_dow = {s.day_of_week: s for s in schedules}
    return schedule_by_dow


def shop_day_windows_union(period_from: date, period_to: date) -> list[dict]:
    """
    Per calendar date, union of all active workers' effective working hours
    (WorkerSchedule + WorkCalendarException). Used for compressed week-view columns.
    """
    from app.models.user import User, UserRole

    workers = User.query.filter_by(role=UserRole.PRODUCTION_WORKER, active=True).all()
    exceptions = load_calendar_exceptions(period_from, period_to)
    schedules_by_worker = {w.id: load_worker_schedule_maps(w.id) for w in workers}

    out = []
    cur = period_from
    while cur <= period_to:
        starts: list[time] = []
        ends: list[time] = []
        working = False
        for worker in workers:
            sched = schedules_by_worker.get(worker.id, {})
            day_start, day_end, is_working = effective_hours_for_date(
                cur, sched, exceptions
            )
            if is_working and day_start and day_end:
                working = True
                starts.append(day_start)
                ends.append(day_end)
        if working:
            out.append(
                {
                    "date": cur.isoformat(),
                    "startTime": min(starts).strftime("%H:%M"),
                    "endTime": max(ends).strftime("%H:%M"),
                    "isWorking": True,
                }
            )
        else:
            out.append(
                {
                    "date": cur.isoformat(),
                    "startTime": None,
                    "endTime": None,
                    "isWorking": False,
                }
            )
        cur += timedelta(days=1)
    return out


def load_calendar_exceptions(start_date: date, end_date: date):
    rows = WorkCalendarException.query.filter(
        WorkCalendarException.date >= start_date,
        WorkCalendarException.date <= end_date,
    ).all()
    return {e.date: e for e in rows}


def full_horizon_interval(anchor_utc: datetime, end_utc: datetime) -> list[tuple[datetime, datetime]]:
    return [(ensure_utc(anchor_utc), ensure_utc(end_utc))]
