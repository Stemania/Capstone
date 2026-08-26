"""Read-only production efficiency analytics aggregations."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import case, func

from app.extensions import db
from app.models.job_order import JobOrder, JobOrderStatus
from app.models.machine import MachineType, MachineUnit
from app.models.operation import JobOperation, OperationStatus
from app.models.operation_time import (
    MachineDowntime,
    OperationTimeEvent,
    OperationTimeLog,
)
from app.models.user import User
from app.models.worker_skill import OperationType
from app.services.schedule_calendar import (
    SHOP_TZ,
    derive_working_segments,
    load_calendar_exceptions,
    load_worker_schedule_maps,
    shop_local_to_utc,
    shop_now,
)
from app.utils.errors import AppError


DEFAULT_MIN_OPS = 5
ON_ESTIMATE_BAND = Decimal("10")


def _num(v, places=4):
    if v is None:
        return None
    return round(float(v), places)


def _parse_period(from_s, to_s):
    today = shop_now().date()
    if to_s:
        try:
            period_to = date.fromisoformat(to_s)
        except ValueError:
            raise AppError("Invalid 'to' date (YYYY-MM-DD)", "VALIDATION_ERROR", 400)
    else:
        period_to = today
    if from_s:
        try:
            period_from = date.fromisoformat(from_s)
        except ValueError:
            raise AppError("Invalid 'from' date (YYYY-MM-DD)", "VALIDATION_ERROR", 400)
    else:
        period_from = period_to - timedelta(weeks=8)
    if period_from > period_to:
        raise AppError("'from' must be on or before 'to'", "VALIDATION_ERROR", 400)
    start_utc = shop_local_to_utc(period_from, time(0, 0))
    end_utc = shop_local_to_utc(period_to + timedelta(days=1), time(0, 0))
    return period_from, period_to, start_utc, end_utc


def _period_meta(period_from, period_to, excluded):
    return {
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "excludedOperationCount": int(excluded),
    }


def _completed_in_period_filters(start_utc, end_utc):
    return [
        JobOperation.status == OperationStatus.COMPLETED,
        JobOperation.actual_end.isnot(None),
        JobOperation.actual_end >= start_utc,
        JobOperation.actual_end < end_utc,
    ]


def count_excluded_null_estimate(start_utc, end_utc):
    """Completed ops in period with null estimated_hours (excluded from variance)."""
    return (
        db.session.query(func.count(JobOperation.id))
        .filter(
            *_completed_in_period_filters(start_utc, end_utc),
            JobOperation.estimated_hours.is_(None),
        )
        .scalar()
        or 0
    )


def overview(from_s=None, to_s=None):
    period_from, period_to, start_utc, end_utc = _parse_period(from_s, to_s)
    filters = _completed_in_period_filters(start_utc, end_utc)
    excluded = count_excluded_null_estimate(start_utc, end_utc)

    avg_var = (
        db.session.query(func.avg(JobOperation.variance_pct))
        .filter(
            *filters,
            JobOperation.estimated_hours.isnot(None),
            JobOperation.variance_pct.isnot(None),
        )
        .scalar()
    )
    with_variance = (
        db.session.query(func.count(JobOperation.id))
        .filter(
            *filters,
            JobOperation.estimated_hours.isnot(None),
            JobOperation.variance_pct.isnot(None),
        )
        .scalar()
        or 0
    )

    job_complete_subq = (
        db.session.query(
            JobOperation.job_order_id.label("jid"),
            func.max(JobOperation.actual_end).label("completed_at"),
        )
        .filter(JobOperation.status == OperationStatus.COMPLETED)
        .group_by(JobOperation.job_order_id)
        .subquery()
    )
    completed_jobs = (
        db.session.query(JobOrder, job_complete_subq.c.completed_at)
        .join(job_complete_subq, JobOrder.id == job_complete_subq.c.jid)
        .filter(
            JobOrder.status == JobOrderStatus.COMPLETED,
            job_complete_subq.c.completed_at >= start_utc,
            job_complete_subq.c.completed_at < end_utc,
        )
        .all()
    )
    on_time = late = 0
    for job, completed_at in completed_jobs:
        done = completed_at.astimezone(SHOP_TZ).date()
        if done <= job.due_date:
            on_time += 1
        else:
            late += 1

    # Rework: follow-on rows (rework_of set). Count all follow-ons whose parent
    # completed in period; hours only from completed follow-ons in period.
    parent_ids_sq = (
        db.session.query(JobOperation.id)
        .filter(*filters)
        .scalar_subquery()
    )
    follow_on_count = (
        db.session.query(func.count(JobOperation.id))
        .filter(JobOperation.rework_of_operation_id.in_(parent_ids_sq))
        .scalar()
        or 0
    )
    rework_worked = float(
        db.session.query(func.coalesce(func.sum(JobOperation.actual_worked_hours), 0))
        .filter(*filters, JobOperation.rework_of_operation_id.isnot(None))
        .scalar()
        or 0
    )
    original_worked = float(
        db.session.query(func.coalesce(func.sum(JobOperation.actual_worked_hours), 0))
        .filter(*filters, JobOperation.rework_of_operation_id.is_(None))
        .scalar()
        or 0
    )
    total_worked = original_worked + rework_worked

    open_dt = (
        MachineDowntime.query.filter(MachineDowntime.ended_at.is_(None)).count()
    )

    payload = _period_meta(period_from, period_to, excluded)
    payload.update(
        {
            "jobs": {
                "completed": len(completed_jobs),
                "onTime": on_time,
                "late": late,
            },
            "efficiency": {
                "averageVariancePct": _num(avg_var),
                "completedOperationsWithVariance": int(with_variance),
            },
            "rework": {
                "count": int(follow_on_count),
                "workedHours": _num(rework_worked),
                "shareOfTotalWorkedHoursPct": _num(
                    (rework_worked / total_worked * 100) if total_worked else 0
                ),
            },
            "downtime": {"openCount": int(open_dt)},
            "totals": {
                "originalWorkedHours": _num(original_worked),
                "reworkWorkedHours": _num(rework_worked),
                "totalWorkedHours": _num(total_worked),
            },
        }
    )
    return payload


def _rework_hours_by(column, start_utc, end_utc):
    filters = _completed_in_period_filters(start_utc, end_utc) + [
        JobOperation.rework_of_operation_id.isnot(None),
        column.isnot(None),
    ]
    return dict(
        db.session.query(
            column,
            func.coalesce(func.sum(JobOperation.actual_worked_hours), 0),
        )
        .filter(*filters)
        .group_by(column)
        .all()
    )


def efficiency_by_worker(from_s=None, to_s=None, min_ops=None):
    period_from, period_to, start_utc, end_utc = _parse_period(from_s, to_s)
    min_ops = DEFAULT_MIN_OPS if min_ops is None else int(min_ops)
    if min_ops < 1:
        raise AppError("minOps must be >= 1", "VALIDATION_ERROR", 400)
    excluded = count_excluded_null_estimate(start_utc, end_utc)

    rows = (
        db.session.query(
            User.id,
            User.full_name,
            func.count(JobOperation.id).label("op_count"),
            func.sum(JobOperation.estimated_hours).label("est"),
            func.sum(JobOperation.actual_worked_hours).label("act"),
            func.avg(JobOperation.variance_pct).label("avg_var"),
            func.sum(
                case(
                    (
                        (JobOperation.variance_pct >= -ON_ESTIMATE_BAND)
                        & (JobOperation.variance_pct <= ON_ESTIMATE_BAND),
                        1,
                    ),
                    else_=0,
                )
            ).label("on_est"),
        )
        .join(JobOperation, JobOperation.assigned_worker_id == User.id)
        .filter(
            *_completed_in_period_filters(start_utc, end_utc),
            JobOperation.estimated_hours.isnot(None),
            JobOperation.variance_pct.isnot(None),
            JobOperation.rework_of_operation_id.is_(None),
        )
        .group_by(User.id, User.full_name)
        .having(func.count(JobOperation.id) >= min_ops)
        .order_by(func.avg(JobOperation.variance_pct).asc())
        .all()
    )
    rework = _rework_hours_by(JobOperation.assigned_worker_id, start_utc, end_utc)

    payload = _period_meta(period_from, period_to, excluded)
    payload["minimumOperationCount"] = min_ops
    payload["workers"] = [
        {
            "workerId": wid,
            "workerName": name,
            "operationCount": int(op_count),
            "totalEstimatedHours": _num(est),
            "totalActualWorkedHours": _num(act),
            "averageVariancePct": _num(avg_v),
            "onEstimateRatePct": _num(
                (float(on_est) / float(op_count) * 100) if op_count else None
            ),
            "reworkWorkedHours": _num(float(rework.get(wid, 0) or 0)),
        }
        for wid, name, op_count, est, act, avg_v, on_est in rows
    ]
    return payload


def efficiency_by_operation_type(from_s=None, to_s=None, min_ops=None):
    period_from, period_to, start_utc, end_utc = _parse_period(from_s, to_s)
    min_ops = DEFAULT_MIN_OPS if min_ops is None else int(min_ops)
    if min_ops < 1:
        raise AppError("minOps must be >= 1", "VALIDATION_ERROR", 400)
    excluded = count_excluded_null_estimate(start_utc, end_utc)

    rows = (
        db.session.query(
            OperationType.id,
            OperationType.code,
            OperationType.name,
            func.count(JobOperation.id).label("op_count"),
            func.sum(JobOperation.estimated_hours).label("est"),
            func.sum(JobOperation.actual_worked_hours).label("act"),
            func.avg(JobOperation.variance_pct).label("avg_var"),
            func.sum(
                case(
                    (
                        (JobOperation.variance_pct >= -ON_ESTIMATE_BAND)
                        & (JobOperation.variance_pct <= ON_ESTIMATE_BAND),
                        1,
                    ),
                    else_=0,
                )
            ).label("on_est"),
        )
        .join(JobOperation, JobOperation.operation_type_id == OperationType.id)
        .filter(
            *_completed_in_period_filters(start_utc, end_utc),
            JobOperation.estimated_hours.isnot(None),
            JobOperation.variance_pct.isnot(None),
            JobOperation.rework_of_operation_id.is_(None),
        )
        .group_by(OperationType.id, OperationType.code, OperationType.name)
        .having(func.count(JobOperation.id) >= min_ops)
        .order_by(func.avg(JobOperation.variance_pct).asc())
        .all()
    )
    rework = _rework_hours_by(JobOperation.operation_type_id, start_utc, end_utc)

    payload = _period_meta(period_from, period_to, excluded)
    payload["minimumOperationCount"] = min_ops
    payload["operationTypes"] = [
        {
            "operationTypeId": oid,
            "operationTypeCode": code,
            "operationTypeName": name,
            "operationCount": int(op_count),
            "totalEstimatedHours": _num(est),
            "totalActualWorkedHours": _num(act),
            "averageVariancePct": _num(avg_v),
            "onEstimateRatePct": _num(
                (float(on_est) / float(op_count) * 100) if op_count else None
            ),
            "reworkWorkedHours": _num(float(rework.get(oid, 0) or 0)),
        }
        for oid, code, name, op_count, est, act, avg_v, on_est in rows
    ]
    return payload


def _segment_hours(start, end, worker_id, exceptions_by_date):
    """Busy hours via derive_working_segments — never wall-clock span."""
    if not start or not end or not worker_id:
        return 0.0
    schedule = load_worker_schedule_maps(worker_id)
    segments = derive_working_segments(start, end, schedule, exceptions_by_date)
    return sum((e - s).total_seconds() for s, e in segments) / 3600.0


def _shop_available_hours(period_from: date, period_to: date) -> float:
    """Default shop capacity Mon–Sat 08:00–17:00 (9h) per calendar day."""
    hours = 0.0
    d = period_from
    while d <= period_to:
        if d.weekday() < 6:
            hours += 9.0
        d += timedelta(days=1)
    return hours


def type_utilization_pct(busy_hours_by_unit, available_hours_per_unit):
    """
    Type-level util = total busy / (available * unit_count)
    which equals the mean of per-unit utilization percentages.
    """
    if not busy_hours_by_unit or not available_hours_per_unit:
        return None
    n = len(busy_hours_by_unit)
    total_busy = sum(busy_hours_by_unit)
    denom = available_hours_per_unit * n
    if denom <= 0:
        return None
    return (total_busy / denom) * 100.0


def efficiency_by_machine(from_s=None, to_s=None, min_ops=None):
    period_from, period_to, start_utc, end_utc = _parse_period(from_s, to_s)
    min_ops = DEFAULT_MIN_OPS if min_ops is None else int(min_ops)
    if min_ops < 1:
        raise AppError("minOps must be >= 1", "VALIDATION_ERROR", 400)
    excluded = count_excluded_null_estimate(start_utc, end_utc)
    available = _shop_available_hours(period_from, period_to)
    exceptions = load_calendar_exceptions(period_from, period_to)

    active_types = (
        MachineType.query.order_by(MachineType.code).all()
    )
    active_units = (
        MachineUnit.query.filter_by(active=True)
        .order_by(MachineUnit.label)
        .all()
    )
    units_by_type = defaultdict(list)
    for u in active_units:
        units_by_type[u.machine_type_id].append(u)

    # Totals / variance sample per unit (original completed ops in period)
    unit_stats = defaultdict(
        lambda: {
            "op_count": 0,
            "est": 0.0,
            "act": 0.0,
            "var_sum": 0.0,
            "var_n": 0,
            "on_est": 0,
        }
    )
    type_stats = defaultdict(
        lambda: {
            "op_count": 0,
            "est": 0.0,
            "act": 0.0,
            "var_sum": 0.0,
            "var_n": 0,
            "on_est": 0,
        }
    )

    period_ops = JobOperation.query.filter(
        *_completed_in_period_filters(start_utc, end_utc),
        JobOperation.rework_of_operation_id.is_(None),
    ).all()

    for op in period_ops:
        if op.machine_unit_id:
            st = unit_stats[op.machine_unit_id]
            st["op_count"] += 1
            if op.estimated_hours is not None:
                st["est"] += float(op.estimated_hours)
            if op.actual_worked_hours is not None:
                st["act"] += float(op.actual_worked_hours)
            if op.estimated_hours is not None and op.variance_pct is not None:
                st["var_n"] += 1
                st["var_sum"] += float(op.variance_pct)
                if -float(ON_ESTIMATE_BAND) <= float(op.variance_pct) <= float(
                    ON_ESTIMATE_BAND
                ):
                    st["on_est"] += 1
        if op.machine_type_id:
            st = type_stats[op.machine_type_id]
            st["op_count"] += 1
            if op.estimated_hours is not None:
                st["est"] += float(op.estimated_hours)
            if op.actual_worked_hours is not None:
                st["act"] += float(op.actual_worked_hours)
            if op.estimated_hours is not None and op.variance_pct is not None:
                st["var_n"] += 1
                st["var_sum"] += float(op.variance_pct)
                if -float(ON_ESTIMATE_BAND) <= float(op.variance_pct) <= float(
                    ON_ESTIMATE_BAND
                ):
                    st["on_est"] += 1

    rework_type = _rework_hours_by(JobOperation.machine_type_id, start_utc, end_utc)
    rework_unit = _rework_hours_by(JobOperation.machine_unit_id, start_utc, end_utc)

    # Utilization: segment hours from actual envelope / shop available hours
    util_ops = (
        JobOperation.query.filter(
            *_completed_in_period_filters(start_utc, end_utc),
            JobOperation.actual_start.isnot(None),
            JobOperation.machine_unit_id.isnot(None),
            JobOperation.assigned_worker_id.isnot(None),
        ).all()
    )
    busy_by_unit = defaultdict(float)
    for op in util_ops:
        hrs = _segment_hours(
            op.actual_start, op.actual_end, op.assigned_worker_id, exceptions
        )
        busy_by_unit[op.machine_unit_id] += hrs

    def _variance_fields(st):
        """Null variance metrics when sample below minOps; totals always returned."""
        below = st["var_n"] < min_ops
        if below or st["var_n"] == 0:
            return None, None, True
        avg = st["var_sum"] / st["var_n"]
        on_rate = st["on_est"] / st["var_n"] * 100.0
        return avg, on_rate, False

    machine_units = []
    unit_util_by_type = defaultdict(list)
    for u in active_units:
        st = unit_stats[u.id]
        busy = busy_by_unit.get(u.id, 0.0)
        util = (busy / available * 100.0) if available else None
        avg_v, on_rate, below_flag = _variance_fields(st)
        # Also flag thin overall activity (no variance sample yet)
        if st["op_count"] < min_ops:
            below_flag = True
            avg_v, on_rate = None, None
        row = {
            "machineUnitId": u.id,
            "machineUnitLabel": u.label,
            "machineTypeId": u.machine_type_id,
            "machineTypeCode": u.machine_type.code if u.machine_type else None,
            "operationCount": int(st["op_count"]),
            "totalEstimatedHours": _num(st["est"]),
            "totalActualWorkedHours": _num(st["act"]),
            "averageVariancePct": _num(avg_v),
            "onEstimateRatePct": _num(on_rate),
            "belowMinimumSample": below_flag,
            "reworkWorkedHours": _num(float(rework_unit.get(u.id, 0) or 0)),
            "busySegmentHours": _num(busy),
            "availableHours": _num(available),
            "utilizationPct": _num(util),
        }
        machine_units.append(row)
        unit_util_by_type[u.machine_type_id].append(util if util is not None else 0.0)

    machine_types = []
    for mt in active_types:
        units = units_by_type.get(mt.id, [])
        n_units = len(units)
        st = type_stats[mt.id]
        busy_list = [busy_by_unit.get(u.id, 0.0) for u in units]
        total_busy = sum(busy_list)
        type_available = available * n_units if n_units else None
        util = type_utilization_pct(busy_list, available) if n_units else None
        avg_v, on_rate, below_flag = _variance_fields(st)
        if st["op_count"] < min_ops:
            below_flag = True
            avg_v, on_rate = None, None
        machine_types.append(
            {
                "machineTypeId": mt.id,
                "machineTypeCode": mt.code,
                "machineTypeName": mt.name,
                "activeUnitCount": n_units,
                "operationCount": int(st["op_count"]),
                "totalEstimatedHours": _num(st["est"]),
                "totalActualWorkedHours": _num(st["act"]),
                "averageVariancePct": _num(avg_v),
                "onEstimateRatePct": _num(on_rate),
                "belowMinimumSample": below_flag,
                "reworkWorkedHours": _num(float(rework_type.get(mt.id, 0) or 0)),
                "busySegmentHours": _num(total_busy),
                "availableHours": _num(type_available),
                "utilizationPct": _num(util),
            }
        )

    # Stable order: types by code; units by type then label
    machine_types.sort(key=lambda r: r["machineTypeCode"] or "")
    machine_units.sort(
        key=lambda r: (r["machineTypeCode"] or "", r["machineUnitLabel"] or "")
    )

    payload = _period_meta(period_from, period_to, excluded)
    payload["minimumOperationCount"] = min_ops
    payload["availableHoursPerUnit"] = _num(available)
    payload["machineTypes"] = machine_types
    payload["machineUnits"] = machine_units
    return payload


def efficiency_trend(from_s=None, to_s=None):
    period_from, period_to, start_utc, end_utc = _parse_period(from_s, to_s)
    excluded = count_excluded_null_estimate(start_utc, end_utc)

    # Postgres: date_trunc week on actual_end (UTC); report shop-local week start
    week_bucket = func.date_trunc("week", JobOperation.actual_end)
    rows = (
        db.session.query(
            week_bucket.label("week_start"),
            func.count(JobOperation.id).label("op_count"),
            func.avg(JobOperation.variance_pct).label("avg_var"),
        )
        .filter(
            *_completed_in_period_filters(start_utc, end_utc),
            JobOperation.estimated_hours.isnot(None),
            JobOperation.variance_pct.isnot(None),
        )
        .group_by(week_bucket)
        .order_by(week_bucket.asc())
        .all()
    )

    weeks = []
    for week_start, op_count, avg_var in rows:
        # date_trunc returns timestamp; normalize to date in shop TZ
        if week_start.tzinfo is None:
            ws = week_start.replace(tzinfo=SHOP_TZ).date()
        else:
            ws = week_start.astimezone(SHOP_TZ).date()
        weeks.append(
            {
                "weekStart": ws.isoformat(),
                "operationCount": int(op_count),
                "averageVariancePct": _num(avg_var),
            }
        )

    payload = _period_meta(period_from, period_to, excluded)
    payload["weeks"] = weeks
    return payload


def delays(from_s=None, to_s=None):
    period_from, period_to, start_utc, end_utc = _parse_period(from_s, to_s)
    excluded = count_excluded_null_estimate(start_utc, end_utc)

    # Pause intervals: PAUSE -> next RESUME/COMPLETE for ops active in period
    logs = (
        db.session.query(OperationTimeLog)
        .join(JobOperation, JobOperation.id == OperationTimeLog.operation_id)
        .filter(
            JobOperation.actual_end.isnot(None),
            JobOperation.actual_end >= start_utc,
            JobOperation.actual_end < end_utc,
        )
        .order_by(OperationTimeLog.operation_id, OperationTimeLog.event_at)
        .all()
    )
    by_op = defaultdict(list)
    for log in logs:
        by_op[log.operation_id].append(log)

    pause_hours = defaultdict(float)
    pause_counts = defaultdict(int)
    for op_logs in by_op.values():
        i = 0
        while i < len(op_logs):
            log = op_logs[i]
            if log.event == OperationTimeEvent.PAUSE and log.reason:
                end_at = None
                for j in range(i + 1, len(op_logs)):
                    if op_logs[j].event in (
                        OperationTimeEvent.RESUME,
                        OperationTimeEvent.COMPLETE,
                    ):
                        end_at = op_logs[j].event_at
                        break
                if end_at and end_at > log.event_at:
                    hrs = (end_at - log.event_at).total_seconds() / 3600.0
                    key = log.reason.value
                    pause_hours[key] += hrs
                    pause_counts[key] += 1
            i += 1

    pause_breakdown = [
        {
            "reason": reason,
            "occurrenceCount": pause_counts[reason],
            "totalPausedHours": _num(pause_hours[reason]),
        }
        for reason in sorted(pause_hours.keys(), key=lambda r: -pause_hours[r])
    ]
    # Include enum reasons with zero if none? Spec: breakdown of pause reasons — only those seen is fine.

    # Downtime by unit overlapping the period
    dts = MachineDowntime.query.filter(
        MachineDowntime.started_at < end_utc,
        db.or_(
            MachineDowntime.ended_at.is_(None),
            MachineDowntime.ended_at > start_utc,
        ),
    ).all()
    dt_hours = defaultdict(float)
    dt_counts = defaultdict(int)
    dt_open = defaultdict(int)
    unit_meta = {}
    for row in dts:
        clip_start = max(row.started_at, start_utc)
        clip_end = row.ended_at if row.ended_at else end_utc
        clip_end = min(clip_end, end_utc)
        if clip_end > clip_start:
            dt_hours[row.machine_unit_id] += (
                clip_end - clip_start
            ).total_seconds() / 3600.0
        dt_counts[row.machine_unit_id] += 1
        if row.ended_at is None:
            dt_open[row.machine_unit_id] += 1
        unit_meta[row.machine_unit_id] = row

    units = {}
    if dt_hours:
        units = {
            u.id: u
            for u in MachineUnit.query.filter(MachineUnit.id.in_(list(dt_hours.keys()))).all()
        }

    downtime_breakdown = []
    for uid, hrs in sorted(dt_hours.items(), key=lambda x: -x[1]):
        u = units.get(uid)
        downtime_breakdown.append(
            {
                "machineUnitId": uid,
                "machineUnitLabel": u.label if u else None,
                "machineTypeCode": (
                    u.machine_type.code if u and u.machine_type else None
                ),
                "occurrenceCount": dt_counts[uid],
                "totalDowntimeHours": _num(hrs),
                "openCount": dt_open[uid],
            }
        )

    payload = _period_meta(period_from, period_to, excluded)
    payload["pauseReasons"] = pause_breakdown
    payload["machineDowntime"] = downtime_breakdown
    return payload


# --- Sales / demand forecasting (read-only) ---

FORECAST_HORIZON_WEEKS = 4
THIN_SAMPLE_WEEKS = 8
CAPACITY_LOAD_FLAG_PCT = 80.0


def _working_days_inclusive(d_from: date, d_to: date) -> int:
    if d_to < d_from:
        return 0
    n = 0
    d = d_from
    while d <= d_to:
        if d.weekday() < 6:
            n += 1
        d += timedelta(days=1)
    return n


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    import calendar

    last = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last)


def month_partial_flags(period_from: date, period_to: date, year: int, month: int):
    """
    Flag a calendar month as partial when the analytics period does not cover
    the full month. Returns (partialPeriod, workingDaysCovered).
    """
    month_start, month_end = _month_bounds(year, month)
    cover_start = max(period_from, month_start)
    cover_end = min(period_to, month_end)
    if cover_end < cover_start:
        return True, 0
    partial = cover_start > month_start or cover_end < month_end
    return partial, _working_days_inclusive(cover_start, cover_end)


def _job_completion_shop_date(job: JobOrder) -> date | None:
    ends = [
        o.actual_end
        for o in (job.operations or [])
        if o.actual_end and o.status == OperationStatus.COMPLETED
    ]
    if not ends:
        return None
    return max(ends).astimezone(SHOP_TZ).date()


def _expected_completion_shop_date(job: JobOrder) -> date:
    ends = [o.scheduled_end for o in (job.operations or []) if o.scheduled_end]
    if ends:
        return max(ends).astimezone(SHOP_TZ).date()
    return job.due_date


def _completed_jobs_in_period(period_from: date, period_to: date):
    jobs = (
        JobOrder.query.filter(JobOrder.status == JobOrderStatus.COMPLETED)
        .all()
    )
    out = []
    for job in jobs:
        done = _job_completion_shop_date(job)
        if done is None:
            continue
        if period_from <= done <= period_to:
            out.append((job, done))
    return out


def sales_summary(from_s=None, to_s=None):
    period_from, period_to, _start_utc, _end_utc = _parse_period(from_s, to_s)
    completed = _completed_jobs_in_period(period_from, period_to)

    by_month = defaultdict(lambda: {"amount": 0.0, "jobCount": 0})
    by_client = defaultdict(lambda: {"amount": 0.0, "jobCount": 0, "name": None})
    by_job_type = defaultdict(lambda: {"amount": 0.0, "jobCount": 0})

    for job, done in completed:
        amt = float(job.amount or 0)
        key = f"{done.year:04d}-{done.month:02d}"
        by_month[key]["amount"] += amt
        by_month[key]["jobCount"] += 1
        cid = job.client_id
        by_client[cid]["amount"] += amt
        by_client[cid]["jobCount"] += 1
        by_client[cid]["name"] = job.client.name if job.client else None
        jt = job.job_type.value if job.job_type else "UNKNOWN"
        by_job_type[jt]["amount"] += amt
        by_job_type[jt]["jobCount"] += 1

    months = []
    for key in sorted(by_month.keys()):
        year, month = int(key[:4]), int(key[5:7])
        partial, wd = month_partial_flags(period_from, period_to, year, month)
        row = by_month[key]
        months.append(
            {
                "month": key,
                "jobCount": row["jobCount"],
                "amount": _num(row["amount"], 2),
                "partialPeriod": partial,
                "workingDaysCovered": wd,
            }
        )

    clients = []
    for cid, row in by_client.items():
        n = row["jobCount"]
        clients.append(
            {
                "clientId": cid,
                "clientName": row["name"],
                "jobCount": n,
                "amount": _num(row["amount"], 2),
                "averageJobValue": _num(row["amount"] / n, 2) if n else None,
            }
        )
    clients.sort(key=lambda r: -(r["amount"] or 0))

    job_types = []
    for jt, row in sorted(by_job_type.items()):
        job_types.append(
            {
                "jobType": jt,
                "jobCount": row["jobCount"],
                "amount": _num(row["amount"], 2),
            }
        )

    total_amount = sum(float(j.amount or 0) for j, _ in completed)
    payload = {
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "workingDaysInPeriod": _working_days_inclusive(period_from, period_to),
        "completedJobCount": len(completed),
        "totalAmount": _num(total_amount, 2),
        "byMonth": months,
        "byClient": clients,
        "byJobType": job_types,
    }
    return payload


def sales_forecast(from_s=None, to_s=None):
    period_from, period_to, _start_utc, _end_utc = _parse_period(from_s, to_s)
    working_days = _working_days_inclusive(period_from, period_to)
    sample_weeks = round(working_days / 6.0, 1) if working_days else 0.0
    thin_sample = sample_weeks < THIN_SAMPLE_WEEKS

    # Committed pipeline: accepted but not delivered (fact)
    pipeline_jobs = JobOrder.query.filter(
        JobOrder.status != JobOrderStatus.COMPLETED
    ).all()
    by_exp_month = defaultdict(lambda: {"amount": 0.0, "jobCount": 0})
    pipeline_total = 0.0
    for job in pipeline_jobs:
        amt = float(job.amount or 0)
        pipeline_total += amt
        exp = _expected_completion_shop_date(job)
        key = f"{exp.year:04d}-{exp.month:02d}"
        by_exp_month[key]["amount"] += amt
        by_exp_month[key]["jobCount"] += 1

    committed = {
        "label": "committedPipeline",
        "description": (
            "Accepted jobs not yet delivered (fact, not a forecast). "
            "Grouped by expected completion from scheduled_end when present, "
            "otherwise due_date."
        ),
        "totalAmount": _num(pipeline_total, 2),
        "jobCount": len(pipeline_jobs),
        "byExpectedCompletionMonth": [
            {
                "month": key,
                "jobCount": by_exp_month[key]["jobCount"],
                "amount": _num(by_exp_month[key]["amount"], 2),
            }
            for key in sorted(by_exp_month.keys())
        ],
    }

    completed = _completed_jobs_in_period(period_from, period_to)
    completed_revenue = sum(float(j.amount or 0) for j, _ in completed)
    revenue_per_day = (
        completed_revenue / working_days if working_days > 0 else None
    )
    today = shop_now().date()
    horizon_from = today
    horizon_to = today + timedelta(days=FORECAST_HORIZON_WEEKS * 7 - 1)
    horizon_wd = _working_days_inclusive(horizon_from, horizon_to)
    projected_amount = (
        revenue_per_day * horizon_wd if revenue_per_day is not None else None
    )

    projected = {
        "label": "projectedRevenue",
        "description": (
            "Rough guess from recent finished jobs: average income per shop day, "
            f"carried forward for the next {FORECAST_HORIZON_WEEKS} weeks. "
            "Not the same as accepted jobs still open."
        ),
        "sampleCompletedJobs": len(completed),
        "sampleWorkingDays": working_days,
        "sampleWeeks": sample_weeks,
        "revenuePerWorkingDay": _num(revenue_per_day, 2),
        "horizonWeeks": FORECAST_HORIZON_WEEKS,
        "horizon": {
            "from": horizon_from.isoformat(),
            "to": horizon_to.isoformat(),
        },
        "horizonWorkingDays": horizon_wd,
        "projectedAmount": _num(projected_amount, 2),
    }
    if thin_sample:
        projected["thinSampleNote"] = (
            f"Only {sample_weeks} weeks of shop days so far "
            f"(we like at least {THIN_SAMPLE_WEEKS}). This guess is rough."
        )

    return {
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "workingDaysInSample": working_days,
        "sampleWeeks": sample_weeks,
        "thinSample": thin_sample,
        "committedPipeline": committed,
        "projectedRevenue": projected,
    }


def capacity_type_rows(active_types, units_by_type, load_by_type, available_per_unit):
    """
    Build per-type capacity rows.
    availableHours = availableHoursPerUnit * activeUnitCount (same rule as by-machine).
    """
    rows = []
    for mt in active_types:
        n = len(units_by_type.get(mt.id) or [])
        avail = available_per_unit * n
        load = float(load_by_type.get(mt.id, 0.0) or 0.0)
        pct = (load / avail * 100.0) if avail > 0 else None
        rows.append(
            {
                "machineTypeId": mt.id,
                "machineTypeCode": mt.code,
                "machineTypeName": getattr(mt, "name", None),
                "activeUnitCount": n,
                "availableHours": _num(avail, 2),
                "scheduledLoadHours": _num(load, 2),
                "projectedLoadPct": _num(pct, 2) if pct is not None else None,
                "above80Pct": bool(pct is not None and pct >= CAPACITY_LOAD_FLAG_PCT),
            }
        )
    return rows


def demand_capacity(from_s=None, to_s=None):
    """
    Next-4-weeks load vs available hours × active unit count.
    Optional from/to are ignored for the horizon (fixed forward window) but
    accepted for API symmetry; sample metadata still uses shop 'today'.
    """
    _ = from_s, to_s  # horizon is always forward-looking
    today = shop_now().date()
    horizon_from = today
    horizon_to = today + timedelta(days=FORECAST_HORIZON_WEEKS * 7 - 1)
    horizon_wd = _working_days_inclusive(horizon_from, horizon_to)
    available_per_unit = float(horizon_wd * 9)
    start_utc = shop_local_to_utc(horizon_from, time(0, 0))
    end_utc = shop_local_to_utc(horizon_to + timedelta(days=1), time(0, 0))

    active_types = MachineType.query.order_by(MachineType.code).all()
    active_units = MachineUnit.query.filter_by(active=True).all()
    units_by_type = defaultdict(list)
    for u in active_units:
        units_by_type[u.machine_type_id].append(u)

    scheduled_ops = (
        JobOperation.query.join(JobOrder)
        .filter(
            JobOrder.status != JobOrderStatus.COMPLETED,
            JobOperation.status != OperationStatus.COMPLETED,
            JobOperation.scheduled_start.isnot(None),
            JobOperation.scheduled_end.isnot(None),
            JobOperation.scheduled_start < end_utc,
            JobOperation.scheduled_end > start_utc,
        )
        .all()
    )
    load_by_type = defaultdict(float)
    for op in scheduled_ops:
        if op.machine_type_id:
            load_by_type[op.machine_type_id] += float(op.estimated_hours or 0)

    thin = len(scheduled_ops) == 0
    machine_types = capacity_type_rows(
        active_types, units_by_type, load_by_type, available_per_unit
    )

    payload = {
        "horizon": {
            "from": horizon_from.isoformat(),
            "to": horizon_to.isoformat(),
        },
        "horizonWorkingDays": horizon_wd,
        "availableHoursPerUnit": _num(available_per_unit, 2),
        "scheduledOperationsInHorizon": len(scheduled_ops),
        "thinSample": thin,
        "machineTypes": machine_types,
    }
    if thin:
        payload["thinSampleNote"] = (
            "No scheduled operations in the next 4 weeks; "
            "expected workload is zero until open operations have scheduled times."
        )
    return payload


# --- Pure helpers for unit tests ---

def average_variance_pct(operations):
    """Exclude null estimated_hours from the variance average."""
    vals = [
        float(o.variance_pct)
        for o in operations
        if o.estimated_hours is not None
        and o.variance_pct is not None
    ]
    if not vals:
        return None
    return sum(vals) / len(vals)


def split_worked_hours(operations):
    """Separate original vs rework worked hours."""
    original = sum(
        float(o.actual_worked_hours or 0)
        for o in operations
        if o.rework_of_operation_id is None
    )
    rework = sum(
        float(o.actual_worked_hours or 0)
        for o in operations
        if o.rework_of_operation_id is not None
    )
    return original, rework


def utilization_from_segments(segment_hours, available_hours):
    if not available_hours:
        return None
    return segment_hours / available_hours * 100.0


def filter_by_min_ops(groups, min_ops):
    """groups: iterable of dicts with operationCount."""
    return [g for g in groups if g.get("operationCount", 0) >= min_ops]
