"""Attendance recorded by the Administrator: clock-in / clock-out per worker per shop day."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models.attendance import AttendanceRecord
from app.models.user import User, UserRole
from app.services.schedule_calendar import (
    SHOP_TZ,
    effective_hours_for_date,
    ensure_utc,
    load_calendar_exceptions,
    load_worker_schedule_maps_many,
    shop_local_to_utc,
    shop_now,
    utc_to_shop,
)
from app.utils.errors import AppError

LATE_GRACE_MINUTES = 5
MAX_SHIFT_HOURS = 24
_FUTURE_SKEW = timedelta(minutes=1)


def _parse_date(raw, field):
    if not raw:
        return None
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError as exc:
        raise AppError(f"{field} must be a date (YYYY-MM-DD)", "VALIDATION_ERROR", 400) from exc


def _parse_time(raw, field):
    """ISO timestamp; one without an offset is read as shop-local time."""
    if raw is None or raw == "":
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError as exc:
        raise AppError(f"{field} must be a date and time", "VALIDATION_ERROR", 400) from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=SHOP_TZ)
    return ensure_utc(dt)


def _assert_not_future(dt, field):
    if dt > ensure_utc(shop_now()) + _FUTURE_SKEW:
        raise AppError(f"{field} cannot be in the future", "VALIDATION_ERROR", 400)


def _assert_clock_out(clock_in, clock_out):
    if clock_out is None:
        return
    if clock_out <= clock_in:
        raise AppError("Clock-out must be after clock-in", "VALIDATION_ERROR", 400)
    if clock_out - clock_in > timedelta(hours=MAX_SHIFT_HOURS):
        raise AppError(
            f"A shift cannot be longer than {MAX_SHIFT_HOURS} hours", "VALIDATION_ERROR", 400
        )
    _assert_not_future(clock_out, "Clock-out")


def _get_worker(worker_id):
    worker = User.query.get(worker_id) if worker_id else None
    if not worker or worker.role != UserRole.PRODUCTION_WORKER:
        raise AppError("Production worker not found", "NOT_FOUND", 404)
    return worker


def _assert_day_free(worker, work_date, exclude_id=None):
    q = AttendanceRecord.query.filter_by(worker_id=worker.id, work_date=work_date)
    if exclude_id:
        q = q.filter(AttendanceRecord.id != exclude_id)
    if q.first():
        raise AppError(
            f"{worker.full_name} already has attendance for {work_date.isoformat()}",
            "CONFLICT",
            409,
        )


def get_record(record_id):
    record = AttendanceRecord.query.get(record_id)
    if not record:
        raise AppError("Attendance record not found", "NOT_FOUND", 404)
    return record


def clock_in(data, actor_id):
    worker = _get_worker(data.get("workerId"))
    if not worker.active:
        raise AppError("This worker's account is disabled", "VALIDATION_ERROR", 400)
    ts = _parse_time(data.get("clockIn"), "Clock-in") or ensure_utc(shop_now())
    _assert_not_future(ts, "Clock-in")
    work_date = utc_to_shop(ts).date()
    _assert_day_free(worker, work_date)
    record = AttendanceRecord(
        worker_id=worker.id,
        work_date=work_date,
        clock_in=ts,
        note=(str(data.get("note") or "").strip() or None),
        recorded_by_id=actor_id,
    )
    db.session.add(record)
    db.session.commit()
    return record


def clock_out(record_id, data, actor_id):
    record = get_record(record_id)
    if record.clock_out:
        raise AppError("Clock-out is already recorded; edit the record instead", "CONFLICT", 409)
    ts = _parse_time(data.get("clockOut"), "Clock-out") or ensure_utc(shop_now())
    _assert_clock_out(ensure_utc(record.clock_in), ts)
    record.clock_out = ts
    record.updated_by_id = actor_id
    db.session.commit()
    return record


def update_record(record_id, data, actor_id):
    record = get_record(record_id)
    clock_in_ts = ensure_utc(record.clock_in)
    if "clockIn" in data:
        clock_in_ts = _parse_time(data.get("clockIn"), "Clock-in")
        if clock_in_ts is None:
            raise AppError("Clock-in is required", "VALIDATION_ERROR", 400)
        _assert_not_future(clock_in_ts, "Clock-in")
    clock_out_ts = ensure_utc(record.clock_out) if record.clock_out else None
    if "clockOut" in data:
        clock_out_ts = _parse_time(data.get("clockOut"), "Clock-out")
    _assert_clock_out(clock_in_ts, clock_out_ts)

    work_date = utc_to_shop(clock_in_ts).date()
    if work_date != record.work_date:
        _assert_day_free(record.worker, work_date, exclude_id=record.id)

    record.clock_in = clock_in_ts
    record.clock_out = clock_out_ts
    record.work_date = work_date
    if "note" in data:
        record.note = str(data.get("note") or "").strip() or None
    record.updated_by_id = actor_id
    db.session.commit()
    return record


def delete_record(record_id):
    record = get_record(record_id)
    db.session.delete(record)
    db.session.commit()


def _late_minutes(record, on_date, start_t):
    if not start_t:
        return 0
    scheduled = shop_local_to_utc(on_date, start_t)
    late = (ensure_utc(record.clock_in) - scheduled).total_seconds() / 60
    return int(late) if late > LATE_GRACE_MINUTES else 0


def _status(record, is_working, on_date, start_t):
    if record:
        if record.clock_out:
            return "PRESENT"
        return "INCOMPLETE" if on_date < shop_now().date() else "CLOCKED_IN"
    if not is_working:
        return "OFF"
    now = shop_now()
    if on_date < now.date():
        return "ABSENT"
    if on_date == now.date() and start_t and now.time() > start_t:
        return "NOT_IN"
    return "NOT_YET"


def _row(worker, record, on_date, sched_map, exceptions):
    start_t, end_t, is_working = effective_hours_for_date(on_date, sched_map, exceptions)
    return {
        "workerId": worker.id,
        "workerName": worker.full_name,
        "date": on_date.isoformat(),
        "scheduledStart": start_t.strftime("%H:%M") if start_t else None,
        "scheduledEnd": end_t.strftime("%H:%M") if end_t else None,
        "isWorkingDay": is_working,
        "status": _status(record, is_working, on_date, start_t),
        "lateMinutes": _late_minutes(record, on_date, start_t) if record else 0,
        "record": record.to_dict() if record else None,
    }


def day_sheet(on_date=None):
    """Every active production worker for one day, plus anyone with a record that day."""
    on_date = _parse_date(on_date, "date") or shop_now().date()
    records = (
        AttendanceRecord.query.options(joinedload(AttendanceRecord.worker))
        .filter_by(work_date=on_date)
        .all()
    )
    by_worker = {r.worker_id: r for r in records}
    workers = (
        User.query.filter(User.role == UserRole.PRODUCTION_WORKER, User.active.is_(True))
        .order_by(User.full_name)
        .all()
    )
    seen = {w.id for w in workers}
    workers += sorted(
        (r.worker for r in records if r.worker_id not in seen), key=lambda u: u.full_name
    )
    sched_maps = load_worker_schedule_maps_many([w.id for w in workers])
    exceptions = load_calendar_exceptions(on_date, on_date)
    rows = [
        _row(w, by_worker.get(w.id), on_date, sched_maps.get(w.id, {}), exceptions)
        for w in workers
    ]
    counts = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return {
        "date": on_date.isoformat(),
        "rows": rows,
        "counts": counts,
        "lateCount": sum(1 for r in rows if r["lateMinutes"]),
    }


def worker_history(worker_id, date_from=None, date_to=None):
    """One worker's days in a range: recorded days plus scheduled days with no record."""
    worker = _get_worker(worker_id)
    today = shop_now().date()
    date_to = _parse_date(date_to, "to") or today
    date_from = _parse_date(date_from, "from") or date_to.replace(day=1)
    if date_from > date_to:
        raise AppError("from must be on or before to", "VALIDATION_ERROR", 400)
    if (date_to - date_from).days > 366:
        raise AppError("Choose a range of one year or less", "VALIDATION_ERROR", 400)

    records = AttendanceRecord.query.filter(
        AttendanceRecord.worker_id == worker.id,
        AttendanceRecord.work_date >= date_from,
        AttendanceRecord.work_date <= date_to,
    ).all()
    by_date = {r.work_date: r for r in records}
    sched_map = load_worker_schedule_maps_many([worker.id]).get(worker.id, {})
    exceptions = load_calendar_exceptions(date_from, date_to)

    rows = []
    cur = date_to
    while cur >= date_from:
        row = _row(worker, by_date.get(cur), cur, sched_map, exceptions)
        if row["record"] or row["status"] in ("ABSENT", "NOT_IN"):
            rows.append(row)
        cur -= timedelta(days=1)

    present = [r for r in rows if r["record"]]
    return {
        "workerId": worker.id,
        "workerName": worker.full_name,
        "from": date_from.isoformat(),
        "to": date_to.isoformat(),
        "rows": rows,
        "summary": {
            "daysPresent": len(present),
            "daysAbsent": sum(1 for r in rows if r["status"] == "ABSENT"),
            "daysLate": sum(1 for r in present if r["lateMinutes"]),
            "hoursPresent": round(
                sum(r["record"]["hoursWorked"] or 0 for r in present), 2
            ),
        },
    }


STATUS_LABELS = {
    "PRESENT": "Present",
    "CLOCKED_IN": "Still clocked in",
    "INCOMPLETE": "Incomplete",
    "ABSENT": "Absent",
    "NOT_IN": "Not in yet",
    "NOT_YET": "Not yet",
    "OFF": "Day off",
}

CSV_HEADERS = [
    "Date",
    "Worker",
    "Scheduled start",
    "Scheduled end",
    "Clock in",
    "Clock out",
    "Hours present",
    "Status",
    "Late (minutes)",
    "Note",
]


def _local_hm(iso):
    if not iso:
        return ""
    return utc_to_shop(datetime.fromisoformat(iso)).strftime("%H:%M")


def rows_to_csv(rows) -> str:
    """The same rows the attendance screen shows, as CSV."""
    import csv
    import io

    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(CSV_HEADERS)
    for r in rows:
        rec = r["record"] or {}
        hours = rec.get("hoursWorked")
        writer.writerow(
            [
                r["date"],
                r["workerName"],
                r["scheduledStart"] or "",
                r["scheduledEnd"] or "",
                _local_hm(rec.get("clockIn")),
                _local_hm(rec.get("clockOut")),
                "" if hours is None else f"{hours:.2f}",
                STATUS_LABELS.get(r["status"], r["status"]),
                r["lateMinutes"] or "",
                rec.get("note") or "",
            ]
        )
    return buf.getvalue()


def not_clocked_in_today(worker_ids) -> set:
    """Workers due at work today whose start time has passed with no clock-in."""
    worker_ids = list(worker_ids)
    if not worker_ids:
        return set()
    now = shop_now()
    today = now.date()
    clocked = {
        wid
        for (wid,) in db.session.query(AttendanceRecord.worker_id).filter(
            AttendanceRecord.work_date == today,
            AttendanceRecord.worker_id.in_(worker_ids),
        )
    }
    sched_maps = load_worker_schedule_maps_many(worker_ids)
    exceptions = load_calendar_exceptions(today, today)
    missing = set()
    for wid in worker_ids:
        if wid in clocked:
            continue
        start_t, _end_t, is_working = effective_hours_for_date(
            today, sched_maps.get(wid, {}), exceptions
        )
        if is_working and start_t and now.time() > start_t:
            missing.add(wid)
    return missing
