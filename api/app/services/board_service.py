"""Read-only production schedule board — segments from existing calendar helpers."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta

from sqlalchemy.orm import joinedload

from app.models.job_order import JobOrder, JobOrderStatus
from app.models.machine import MachineType, MachineUnit
from app.models.operation import JobOperation, OperationStatus
from app.models.operation_time import MachineDowntime
from app.models.user import User, UserRole
from app.models.client import Client
from app.services.schedule_calendar import (
    serialize_segments,
    shop_local_to_utc,
    shop_now,
    utc_to_shop,
)
from app.services.schedule_service import (
    compute_schedule_flag,
    operation_working_segments,
)
from app.utils.errors import AppError

# Same threshold as capacity analytics (running near full).
NEAR_FULL_PCT = 80.0
HOURS_PER_SHOP_DAY = 9.0


def _parse_date(value: str | None, label: str) -> date:
    if not value:
        raise AppError(f"{label} is required (YYYY-MM-DD)", "VALIDATION_ERROR", 400)
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise AppError(f"{label} must be YYYY-MM-DD", "VALIDATION_ERROR", 400) from exc


def _num(v, digits=2):
    if v is None:
        return None
    return round(float(v), digits)


def _job_number(job: JobOrder) -> str:
    year = job.created_at.year if job.created_at else datetime.utcnow().year
    return f"JO-{year}-{(job.id or '')[:4].upper()}"


def _working_days_inclusive(start: date, end: date) -> int:
    if end < start:
        return 0
    n = 0
    cur = start
    while cur <= end:
        if cur.weekday() < 6:  # Mon–Sat
            n += 1
        cur += timedelta(days=1)
    return n


def schedule_board(
    from_s: str | None = None,
    to_s: str | None = None,
    machine_type_id: str | None = None,
    worker_id: str | None = None,
    client_id: str | None = None,
    include_completed: bool = True,
):
    """
    Scheduled operations overlapping [from, to] (shop-local dates), with
    derived working segments (never overnight wall-clock blocks).
    """
    period_from = _parse_date(from_s, "from")
    period_to = _parse_date(to_s, "to")
    if period_to < period_from:
        raise AppError("to must be on or after from", "VALIDATION_ERROR", 400)

    start_utc = shop_local_to_utc(period_from, time(0, 0))
    end_utc = shop_local_to_utc(period_to + timedelta(days=1), time(0, 0))

    q = (
        JobOperation.query.options(
            joinedload(JobOperation.job_order).joinedload(JobOrder.client),
            joinedload(JobOperation.machine_type),
            joinedload(JobOperation.machine_unit),
            joinedload(JobOperation.assigned_worker),
            joinedload(JobOperation.operation_type),
        )
        .join(JobOrder)
        .filter(
            JobOperation.scheduled_start.isnot(None),
            JobOperation.scheduled_end.isnot(None),
            JobOperation.scheduled_start < end_utc,
            JobOperation.scheduled_end > start_utc,
        )
    )
    if not include_completed:
        q = q.filter(JobOperation.status != OperationStatus.COMPLETED)
    if machine_type_id:
        q = q.filter(JobOperation.machine_type_id == machine_type_id)
    if worker_id:
        q = q.filter(JobOperation.assigned_worker_id == worker_id)
    if client_id:
        q = q.filter(JobOrder.client_id == client_id)

    ops = q.order_by(JobOperation.scheduled_start.asc()).all()

    operations_out = []
    load_by_type = defaultdict(float)
    jobs_meta = {}  # job_id -> {due, projected, flag, number, title}

    for op in ops:
        job = op.job_order
        segments = serialize_segments(operation_working_segments(op))
        # Clip to board window for payload size; keep full scheduled window for hover.
        clipped = []
        for seg in segments:
            s = max(datetime.fromisoformat(seg["start"].replace("Z", "+00:00")), start_utc)
            e = min(datetime.fromisoformat(seg["end"].replace("Z", "+00:00")), end_utc)
            if e > s:
                clipped.append({"start": s.isoformat(), "end": e.isoformat()})

        projected = None
        schedule_flag = None
        is_late = False
        if job:
            jid = job.id
            if jid not in jobs_meta:
                ends = [o.scheduled_end for o in (job.operations or []) if o.scheduled_end]
                # Prefer already-loaded ops; fall back to this op only
                if not ends and op.scheduled_end:
                    ends = [op.scheduled_end]
                # Collect max end across board ops for this job; refine below
                jobs_meta[jid] = {
                    "due": job.due_date,
                    "projected": max(ends) if ends else None,
                    "number": _job_number(job),
                    "title": job.title,
                    "status": job.status.value if job.status else None,
                }
            else:
                if op.scheduled_end and (
                    jobs_meta[jid]["projected"] is None
                    or op.scheduled_end > jobs_meta[jid]["projected"]
                ):
                    jobs_meta[jid]["projected"] = op.scheduled_end

            projected = jobs_meta[jid]["projected"]
            schedule_flag = compute_schedule_flag(projected, job.due_date)
            is_late = schedule_flag in ("AMBER", "RED")
            jobs_meta[jid]["flag"] = schedule_flag

        if op.machine_type_id and op.status != OperationStatus.COMPLETED:
            load_by_type[op.machine_type_id] += float(op.estimated_hours or 0)

        operations_out.append(
            {
                "id": op.id,
                "jobOrderId": op.job_order_id,
                "jobNumber": _job_number(job) if job else None,
                "jobTitle": job.title if job else None,
                "jobStatus": job.status.value if job and job.status else None,
                "clientId": job.client_id if job else None,
                "clientName": job.client.name if job and job.client else None,
                "sequenceNo": op.sequence_no,
                "operationName": op.operation_name,
                "status": op.status.value if op.status else None,
                "estimatedHours": _num(op.estimated_hours),
                "scheduledStart": op.scheduled_start.isoformat() if op.scheduled_start else None,
                "scheduledEnd": op.scheduled_end.isoformat() if op.scheduled_end else None,
                "segments": clipped,
                "machineTypeId": op.machine_type_id,
                "machineTypeCode": op.machine_type.code if op.machine_type else None,
                "machineTypeName": op.machine_type.name if op.machine_type else None,
                "machineUnitId": op.machine_unit_id,
                "machineUnitLabel": op.machine_unit.label if op.machine_unit else None,
                "assignedWorkerId": op.assigned_worker_id,
                "assignedWorkerName": (
                    op.assigned_worker.full_name if op.assigned_worker else None
                ),
                "dueDate": job.due_date.isoformat() if job and job.due_date else None,
                "projectedCompletion": projected.isoformat() if projected else None,
                "scheduleFlag": schedule_flag,
                "isLate": is_late,
            }
        )

    # Refine projected completion using all scheduled ends on each job (not only filtered ops)
    job_ids = list(jobs_meta.keys())
    if job_ids:
        all_ends = (
            JobOperation.query.filter(
                JobOperation.job_order_id.in_(job_ids),
                JobOperation.scheduled_end.isnot(None),
            )
            .with_entities(JobOperation.job_order_id, JobOperation.scheduled_end)
            .all()
        )
        max_by_job = {}
        for jid, end in all_ends:
            if jid not in max_by_job or end > max_by_job[jid]:
                max_by_job[jid] = end
        for jid, meta in jobs_meta.items():
            if jid in max_by_job:
                meta["projected"] = max_by_job[jid]
                meta["flag"] = compute_schedule_flag(meta["projected"], meta["due"])
        for row in operations_out:
            jid = row["jobOrderId"]
            if jid in jobs_meta:
                proj = jobs_meta[jid]["projected"]
                flag = jobs_meta[jid].get("flag")
                row["projectedCompletion"] = proj.isoformat() if proj else None
                row["scheduleFlag"] = flag
                row["isLate"] = flag in ("AMBER", "RED")

    units = (
        MachineUnit.query.options(joinedload(MachineUnit.machine_type))
        .filter_by(active=True)
        .order_by(MachineUnit.label)
        .all()
    )
    if machine_type_id:
        units = [u for u in units if u.machine_type_id == machine_type_id]

    machine_units_out = [
        {
            "id": u.id,
            "label": u.label,
            "machineTypeId": u.machine_type_id,
            "machineTypeCode": u.machine_type.code if u.machine_type else None,
            "machineTypeName": u.machine_type.name if u.machine_type else None,
        }
        for u in units
    ]

    workers = (
        User.query.filter_by(role=UserRole.PRODUCTION_WORKER, active=True)
        .order_by(User.full_name)
        .all()
    )
    workers_out = [{"id": w.id, "fullName": w.full_name} for w in workers]

    clients_out = [
        {"id": c.id, "name": c.name}
        for c in Client.query.order_by(Client.name).all()
    ]

    dts = (
        MachineDowntime.query.options(joinedload(MachineDowntime.machine_unit))
        .filter(
            MachineDowntime.started_at < end_utc,
            (MachineDowntime.ended_at.is_(None)) | (MachineDowntime.ended_at > start_utc),
        )
        .all()
    )
    if machine_type_id:
        unit_ids = {u.id for u in units}
        dts = [d for d in dts if d.machine_unit_id in unit_ids]

    far_end = end_utc
    downtimes_out = []
    for d in dts:
        d_end = d.ended_at or far_end
        s = max(d.started_at, start_utc) if d.started_at else start_utc
        e = min(d_end, end_utc)
        if e <= s:
            continue
        downtimes_out.append(
            {
                "id": d.id,
                "machineUnitId": d.machine_unit_id,
                "machineUnitLabel": d.machine_unit.label if d.machine_unit else None,
                "startedAt": d.started_at.isoformat() if d.started_at else None,
                "endedAt": d.ended_at.isoformat() if d.ended_at else None,
                "segmentStart": s.isoformat(),
                "segmentEnd": e.isoformat(),
                "reason": d.reason,
                "open": d.ended_at is None,
            }
        )

    # Near-full machines for this board window (same hours rule as capacity analytics)
    working_days = _working_days_inclusive(period_from, period_to)
    available_per_unit = working_days * HOURS_PER_SHOP_DAY
    units_by_type = defaultdict(list)
    for u in units:
        units_by_type[u.machine_type_id].append(u)

    near_full = []
    types = MachineType.query.order_by(MachineType.code).all()
    for mt in types:
        if machine_type_id and mt.id != machine_type_id:
            continue
        n = len(units_by_type.get(mt.id) or [])
        if n == 0:
            continue
        avail = available_per_unit * n
        load = float(load_by_type.get(mt.id, 0.0) or 0.0)
        pct = (load / avail * 100.0) if avail > 0 else 0.0
        if pct >= NEAR_FULL_PCT:
            near_full.append(
                {
                    "machineTypeId": mt.id,
                    "machineTypeCode": mt.code,
                    "machineTypeName": mt.name,
                    "projectedLoadPct": _num(pct, 1),
                }
            )

    at_risk = []
    seen_jobs = set()
    for row in operations_out:
        jid = row["jobOrderId"]
        if jid in seen_jobs:
            continue
        if row.get("isLate") and row.get("jobStatus") not in (
            JobOrderStatus.COMPLETED.value,
            JobOrderStatus.DELIVERED.value,
        ):
            seen_jobs.add(jid)
            at_risk.append(
                {
                    "jobOrderId": jid,
                    "jobNumber": row["jobNumber"],
                    "jobTitle": row["jobTitle"],
                    "dueDate": row["dueDate"],
                    "projectedCompletion": row["projectedCompletion"],
                    "scheduleFlag": row["scheduleFlag"],
                }
            )

    return {
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "timezone": "Asia/Manila",
        "machineUnits": machine_units_out,
        "workers": workers_out,
        "clients": clients_out,
        "operations": operations_out,
        "downtimes": downtimes_out,
        "summary": {
            "operationsScheduled": len(operations_out),
            "machinesNearFullCapacity": near_full,
            "jobsAtRisk": at_risk,
        },
    }
