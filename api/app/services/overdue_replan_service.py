"""Re-plan Scheduled jobs whose first operation's start has already passed, and
released jobs whose unstarted operations were scheduled before the daily break.

Uses the same scheduler and material rules as every other proposal: the
material date, the lead-time floor while anything is unordered, the assigned
workers kept as they are, and no operation placed earlier than it was. Jobs
are placed one by one, earliest current start first, and each placement is
flushed before the next job is proposed so two jobs never take the same slot.

A dry run rolls everything back; apply commits.
"""

from __future__ import annotations

from datetime import datetime

from app.extensions import db
from app.models.job_order import JobOrder, JobOrderStatus
from app.models.schedule_move import DelayKind
from app.services import material_purchase_service as mp_service
from app.services.material_delay_service import (
    _first_operation,
    _fmt,
    _responsible_order,
    material_cause,
    record_move,
    responsible_supplier_id,
)
from app.services.schedule_calendar import ensure_utc, shop_now


def overdue_jobs(now_utc: datetime | None = None) -> list[JobOrder]:
    """Scheduled, not started, first operation's scheduled start before now."""
    now_utc = ensure_utc(now_utc or shop_now())
    found = []
    for job in JobOrder.query.filter(JobOrder.status == JobOrderStatus.SCHEDULED).all():
        if mp_service.job_has_started(job):
            continue
        first = _first_operation(job)
        if first is not None and ensure_utc(first.scheduled_start) < now_utc:
            found.append(job)
    found.sort(key=lambda j: (ensure_utc(_first_operation(j).scheduled_start), j.job_number or ""))
    return found


def _workers(job: JobOrder) -> list[dict]:
    return [
        {
            "sequenceNo": op.sequence_no,
            "operationName": op.operation_name,
            "workerId": op.assigned_worker_id,
            "workerName": op.assigned_worker.full_name if op.assigned_worker else None,
        }
        for op in sorted(job.operations or [], key=lambda o: o.sequence_no or 0)
    ]


def _replan_job(job: JobOrder, now_utc: datetime) -> dict:
    from app.services.schedule_service import propose_schedule, resolve_material_not_before_utc

    first = _first_operation(job)
    old_start = ensure_utc(first.scheduled_start)
    wait = mp_service.material_wait(job)
    row = {
        "jobId": job.id,
        "jobNumber": job.job_number,
        "title": job.title,
        "dueDate": job.due_date.isoformat() if job.due_date else None,
        "currentFirstStart": old_start.isoformat(),
        "waitingForMaterials": wait is not None,
        "materialWaitReason": wait["message"] if wait else None,
        "workers": _workers(job),
    }

    floor_date, floor_reason = mp_service.scheduling_material_floor(job)
    if floor_date is None and floor_reason:
        row.update(outcome="NO_SLOT", reason=floor_reason)
        return row
    floor_utc = resolve_material_not_before_utc(job.material_status, None, floor_date)
    row["materialDate"] = floor_date.isoformat() if floor_date else None
    row["materialReason"] = floor_reason

    proposal = propose_schedule(
        list(job.operations),
        job.due_date,
        exclude_job_id=job.id,
        anchor_utc=now_utc,
        material_not_before_utc=floor_utc,
        material_constraint_reason=floor_reason,
        never_earlier=True,
    )
    results = {r.get("id"): r for r in proposal["operations"]}
    failed = [r for r in proposal["operations"] if not r.get("scheduled")]
    if failed or any(op.id not in results for op in job.operations):
        row.update(
            outcome="NO_SLOT",
            reason="; ".join(
                f"Op {r.get('sequenceNo')} {r.get('operationName') or ''}: {r.get('message') or 'not placed'}"
                for r in failed
            )
            or "Not every operation could be placed",
        )
        return row

    for op in job.operations:
        r = results[op.id]
        if r.get("assignedWorkerId") and r["assignedWorkerId"] != op.assigned_worker_id:
            raise RuntimeError("overdue re-plan tried to change a worker")
        start = datetime.fromisoformat(r["scheduledStart"].replace("Z", "+00:00"))
        if op.scheduled_start and ensure_utc(start) < ensure_utc(op.scheduled_start):
            raise RuntimeError("overdue re-plan tried to move an operation earlier")
        op.scheduled_start = start
        op.scheduled_end = datetime.fromisoformat(r["scheduledEnd"].replace("Z", "+00:00"))
        if r.get("machineUnitId"):
            op.machine_unit_id = r["machineUnitId"]

    new_start = ensure_utc(first.scheduled_start)
    floor_drove_start = floor_utc is not None and floor_utc > now_utc
    order = _responsible_order(job, floor_date, None) if floor_drove_start else None
    kind = DelayKind.MATERIAL if floor_drove_start else DelayKind.RESCHEDULED
    cause = f"waiting for materials ({floor_reason})" if floor_drove_start else "start date passed"
    record_move(
        job,
        kind,
        old_start,
        new_start,
        f"Overdue re-plan: first operation moved from {_fmt(old_start)} to "
        f"{_fmt(new_start)}; {cause}",
        order,
        supplier_id=responsible_supplier_id(job, floor_date, order) if floor_drove_start else None,
        cause=material_cause(job, floor_date) if floor_drove_start else None,
    )
    db.session.flush()

    row.update(
        outcome="MOVED",
        proposedFirstStart=new_start.isoformat(),
        projectedCompletion=proposal.get("projectedCompletion"),
        scheduleFlag=proposal.get("scheduleFlag"),
        startedByMaterials=floor_drove_start,
        delayKind=kind,
    )
    return row


def replan_overdue(
    *, apply: bool = False, now_utc: datetime | None = None, exclude=()
) -> dict:
    """exclude: job numbers left exactly as they are."""
    now_utc = ensure_utc(now_utc or shop_now())
    exclude = set(exclude)
    moved, not_placed, excluded = [], [], []
    try:
        for job in overdue_jobs(now_utc):
            if job.job_number in exclude:
                excluded.append(job.job_number)
                continue
            row = _replan_job(job, now_utc)
            (moved if row["outcome"] == "MOVED" else not_placed).append(row)
        if apply:
            db.session.commit()
        else:
            db.session.rollback()
    except Exception:
        db.session.rollback()
        raise
    return {
        "now": now_utc.isoformat(),
        "applied": apply,
        "moved": moved,
        "notPlaced": not_placed,
        "excluded": excluded,
    }


# --- Operations scheduled before the daily break existed --------------------

_RELEASED = (JobOrderStatus.SCHEDULED, JobOrderStatus.IN_PROGRESS)


def _not_started(op) -> bool:
    from app.models.operation import OperationStatus

    return (
        op.actual_start is None
        and op.status not in (OperationStatus.IN_PROGRESS, OperationStatus.COMPLETED)
        and not op.is_outsourced
    )


def _crosses_break_on_old_rules(op) -> bool:
    """The stored window overlaps the daily break and its end is not what the
    current calendar gives for its start and target hours, so it was worked out
    before the break was taken out of working time."""
    from app.constants.scheduling import DEFAULT_ESTIMATED_HOURS
    from app.services.schedule_calendar import break_intervals_utc
    from app.services.schedule_service import place_from_start

    if not (op.scheduled_start and op.scheduled_end and op.assigned_worker_id):
        return False
    start, end = ensure_utc(op.scheduled_start), ensure_utc(op.scheduled_end)
    if not any(s < end and start < e for s, e in break_intervals_utc(start, end)):
        return False
    hours = op.estimated_hours if op.estimated_hours is not None else DEFAULT_ESTIMATED_HOURS
    _s, derived_end, _ = place_from_start(op.assigned_worker_id, start, hours)
    return derived_end is None or ensure_utc(derived_end) != end


def break_crossing_jobs() -> list[JobOrder]:
    found = []
    for job in JobOrder.query.filter(JobOrder.status.in_(_RELEASED)).all():
        ops = [o for o in job.operations or [] if _not_started(o)]
        if any(_crosses_break_on_old_rules(o) for o in ops):
            found.append(job)
    found.sort(
        key=lambda j: (
            min(ensure_utc(o.scheduled_start) for o in j.operations if o.scheduled_start),
            j.job_number or "",
        )
    )
    return found


def _op_rows(job):
    return {
        op.id: {
            "sequenceNo": op.sequence_no,
            "operationName": op.operation_name,
            "workerName": op.assigned_worker.full_name if op.assigned_worker else None,
            "estimatedHours": float(op.estimated_hours) if op.estimated_hours is not None else None,
            "crossesBreak": _not_started(op) and _crosses_break_on_old_rules(op),
            "started": not _not_started(op),
            "currentStart": op.scheduled_start and ensure_utc(op.scheduled_start).isoformat(),
            "currentEnd": op.scheduled_end and ensure_utc(op.scheduled_end).isoformat(),
        }
        for op in sorted(job.operations or [], key=lambda o: o.sequence_no or 0)
    }


def _replan_break_job(job: JobOrder, now_utc: datetime) -> dict:
    """Unstarted operations keep their start where it is still free; ends are
    worked out again without the break and later operations follow on. Workers
    never change and nothing moves earlier."""
    from app.services.schedule_service import propose_schedule, resolve_material_not_before_utc

    ops = _op_rows(job)
    row = {
        "jobId": job.id,
        "jobNumber": job.job_number,
        "title": job.title,
        "status": job.status.value,
        "dueDate": job.due_date.isoformat() if job.due_date else None,
        "operations": list(ops.values()),
    }
    floor_date, floor_reason = mp_service.scheduling_material_floor(job)
    floor_utc = (
        None
        if mp_service.job_has_started(job)
        else resolve_material_not_before_utc(job.material_status, None, floor_date)
    )
    proposal = propose_schedule(
        list(job.operations),
        job.due_date,
        exclude_job_id=job.id,
        anchor_utc=now_utc,
        material_not_before_utc=floor_utc,
        material_constraint_reason=floor_reason,
        never_earlier=True,
    )
    results = {r.get("id"): r for r in proposal["operations"]}
    failed = [r for r in proposal["operations"] if not r.get("scheduled")]
    if failed or any(op.id not in results for op in job.operations):
        row.update(
            outcome="NO_SLOT",
            reason="; ".join(
                f"Op {r.get('sequenceNo')} {r.get('operationName') or ''}: {r.get('message') or 'not placed'}"
                for r in failed
            )
            or "Not every operation could be placed",
        )
        return row

    first = _first_operation(job)
    old_first = ensure_utc(first.scheduled_start) if first and first.scheduled_start else None
    for op in job.operations:
        if not _not_started(op):
            continue
        r = results[op.id]
        if r.get("assignedWorkerId") and r["assignedWorkerId"] != op.assigned_worker_id:
            raise RuntimeError("break re-plan tried to change a worker")
        start = datetime.fromisoformat(r["scheduledStart"].replace("Z", "+00:00"))
        if op.scheduled_start and ensure_utc(start) < ensure_utc(op.scheduled_start):
            raise RuntimeError("break re-plan tried to move an operation earlier")
        op.scheduled_start = start
        op.scheduled_end = datetime.fromisoformat(r["scheduledEnd"].replace("Z", "+00:00"))
        if r.get("machineUnitId"):
            op.machine_unit_id = r["machineUnitId"]
        ops[op.id]["proposedStart"] = ensure_utc(op.scheduled_start).isoformat()
        ops[op.id]["proposedEnd"] = ensure_utc(op.scheduled_end).isoformat()

    new_first = ensure_utc(first.scheduled_start) if first and first.scheduled_start else None
    if old_first and new_first and new_first != old_first and job.status == JobOrderStatus.SCHEDULED:
        record_move(
            job,
            DelayKind.RESCHEDULED,
            old_first,
            new_first,
            f"Lunch-break re-plan: first operation moved from {_fmt(old_first)} to "
            f"{_fmt(new_first)}",
            None,
        )
    db.session.flush()
    row.update(
        outcome="MOVED",
        operations=list(ops.values()),
        projectedCompletion=proposal.get("projectedCompletion"),
        scheduleFlag=proposal.get("scheduleFlag"),
    )
    return row


def replan_break_crossing(
    *, apply: bool = False, now_utc: datetime | None = None, exclude=()
) -> dict:
    """Released jobs with unstarted operations scheduled before the daily break
    existed. A dry run rolls everything back; apply commits."""
    now_utc = ensure_utc(now_utc or shop_now())
    exclude = set(exclude)
    moved, not_placed, excluded = [], [], []
    try:
        for job in break_crossing_jobs():
            if job.job_number in exclude:
                excluded.append(job.job_number)
                continue
            row = _replan_break_job(job, now_utc)
            (moved if row["outcome"] == "MOVED" else not_placed).append(row)
        if apply:
            db.session.commit()
        else:
            db.session.rollback()
    except Exception:
        db.session.rollback()
        raise
    return {
        "now": now_utc.isoformat(),
        "applied": apply,
        "moved": moved,
        "notPlaced": not_placed,
        "excluded": excluded,
    }
