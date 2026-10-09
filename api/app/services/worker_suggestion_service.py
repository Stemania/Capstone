"""Rank production workers with fixed weighted scoring components.

Availability is a filter (not a weight): unqualified, busy, and off-shift
workers (per schedule + work calendar) are omitted from the shortlist entirely.
"""

from app.models.machine import MachineType
from app.models.worker_skill import OperationType
from app.services.scoring_service import (
    build_reason,
    combine_score,
    fetch_efficiency_pairs,
    load_scoring_weights,
    log_weights_used,
    score_efficiency,
    score_skill,
    score_workload,
    worker_week_load_hours,
)
from app.services.schedule_calendar import (
    derive_working_segments,
    load_calendar_exceptions,
    load_worker_schedule_maps_many,
    utc_to_shop,
)
from app.services.worker_availability import _parse_dt, get_busy_workers
from app.models.user import UserRole
from app.services.worker_profile_service import (
    NO_MACHINE_SKILL_RECORDED,
    machine_skill_holders,
    query_assignable_workers,
)


def _working_during(workers, scheduled_start, scheduled_end):
    """Keep workers with working hours inside the window (schedule + work calendar)."""
    start = _parse_dt(scheduled_start)
    end = _parse_dt(scheduled_end)
    if not start or not end or end <= start:
        return workers
    schedules = load_worker_schedule_maps_many([w.id for w in workers])
    exceptions = load_calendar_exceptions(utc_to_shop(start).date(), utc_to_shop(end).date())
    return [
        w
        for w in workers
        if derive_working_segments(start, end, schedules.get(w.id, {}), exceptions)
    ]


NOT_CLOCKED_IN = "Not clocked in today"


def _not_clocked_in_for_today_op(worker_ids, scheduled_start, operation_id):
    """Workers past their start time without a clock-in, when the operation
    starts today. Its start is the proposed window, else the saved schedule."""
    from app.models.operation import JobOperation
    from app.services.attendance_service import not_clocked_in_today
    from app.services.schedule_calendar import shop_now

    start = _parse_dt(scheduled_start)
    if start is None and operation_id:
        op = JobOperation.query.get(operation_id)
        start = op.scheduled_start if op else None
    if start is None or utc_to_shop(start).date() != shop_now().date():
        return set()
    return not_clocked_in_today(worker_ids)


def _resolve_machine_type_id(
    *,
    machine_type_id=None,
    operation_type_id=None,
    operation_name=None,
):
    if machine_type_id:
        return machine_type_id
    if operation_type_id:
        ot = OperationType.query.get(operation_type_id)
        if ot and ot.default_machine_type_id:
            return ot.default_machine_type_id
    if operation_name:
        ot = OperationType.query.filter(
            (OperationType.name.ilike(operation_name))
            | (OperationType.code.ilike(str(operation_name).replace(" ", "_")))
        ).first()
        if ot and ot.default_machine_type_id:
            return ot.default_machine_type_id
    return None


def _resolve_operation_type_id(*, operation_type_id=None, operation_name=None):
    if operation_type_id:
        return operation_type_id
    if operation_name:
        ot = OperationType.query.filter(
            (OperationType.name.ilike(operation_name))
            | (OperationType.code.ilike(str(operation_name).replace(" ", "_")))
        ).first()
        if ot:
            return ot.id
    return None


def suggest_workers(
    operations=None,
    exclude_job_id=None,
    scheduled_start=None,
    scheduled_end=None,
    exclude_operation_id=None,
    machine_type_id=None,
    operation_type_id=None,
    operation_name=None,
):
    """
    Score eligible production workers and Admins.

    Filters out:
      - people without skill for the target machine type (once someone has
        that skill recorded; until then everyone qualifies). Operations
        without a machine take anyone.
      - workers busy for the proposed window (overlap), or IN_PROGRESS when no window
      - workers with no working hours in the proposed window (off shift, holiday)

    Returns {"weights": {...}, "suggestions": [...]} — only eligible workers.
    """
    del exclude_job_id  # reserved for future earliest-fit; unused in scoring

    if operations and not operation_name:
        if isinstance(operations, str):
            operation_name = operations
        elif isinstance(operations, list) and operations:
            first = operations[0]
            if isinstance(first, dict):
                operation_name = first.get("operationName") or first.get("name")
                machine_type_id = machine_type_id or first.get("machineTypeId")
                operation_type_id = operation_type_id or first.get("operationTypeId")
            else:
                operation_name = first

    target_machine_id = _resolve_machine_type_id(
        machine_type_id=machine_type_id,
        operation_type_id=operation_type_id,
        operation_name=operation_name,
    )
    resolved_op_type_id = _resolve_operation_type_id(
        operation_type_id=operation_type_id,
        operation_name=operation_name,
    )

    weights = load_scoring_weights()
    log_weights_used(weights, context="suggest")

    mt = MachineType.query.get(target_machine_id) if target_machine_id else None
    machine_label = mt.name if mt else None

    # A machine skill filters and scores once someone has it recorded; until
    # then everyone qualifies.
    machine_holders = machine_skill_holders(target_machine_id)
    skill_by_worker = machine_holders or {}
    no_machine_skill_yet = bool(target_machine_id) and machine_holders is None
    skill_required = machine_holders is not None

    workers = query_assignable_workers().all()

    if skill_required:
        workers = [w for w in workers if w.id in skill_by_worker]

    busy_workers = get_busy_workers(
        start=scheduled_start,
        end=scheduled_end,
        exclude_operation_id=exclude_operation_id,
    )
    workers = [w for w in workers if w.id not in busy_workers]
    workers = _working_during(workers, scheduled_start, scheduled_end)

    peer_ids = [w.id for w in workers]
    load_by_worker = {
        wid: worker_week_load_hours(wid, exclude_operation_id=exclude_operation_id)
        for wid in peer_ids
    }
    peer_hours = list(load_by_worker.values())

    suggestions = []
    for worker in workers:
        skill = skill_by_worker.get(worker.id) if skill_required else None
        if skill_required:
            skill_score, skill_reason, skill_default = score_skill(
                proficiency=skill.proficiency if skill else None,
                is_primary=bool(skill and skill.is_primary),
            )
        else:
            if no_machine_skill_yet:
                skill_reason = NO_MACHINE_SKILL_RECORDED
            else:
                skill_reason = "no machine skill required"
            skill_score, skill_default = 1.0, False

        hours = load_by_worker.get(worker.id, 0.0)
        work_score, work_reason, work_default = score_workload(hours, peer_hours)

        eff_pairs = fetch_efficiency_pairs(worker.id, resolved_op_type_id)
        eff_score, eff_reason, eff_default = score_efficiency(eff_pairs)

        components = {
            "skill": round(skill_score, 4),
            "workload": round(work_score, 4),
            "efficiency": round(eff_score, 4),
        }
        total = combine_score(weights, components, qualified=True)

        reason_parts = [
            (skill_reason, skill_default),
            (work_reason, work_default),
            (eff_reason, eff_default),
        ]
        ordered = [p for p in reason_parts if not p[1]] + [
            p for p in reason_parts if p[1]
        ]
        reason = build_reason(ordered, machine_label=machine_label, unqualified=False)

        skills_codes = [s.machine_type.code for s in (worker.skills or []) if s.machine_type]
        suggestions.append(
            {
                "workerId": worker.id,
                "fullName": worker.full_name,
                "nickname": worker.nickname,
                "photoVersion": worker.photo_version,
                "role": worker.role.value,
                "email": worker.email,
                "skills": skills_codes,
                "score": total,
                "qualified": True,
                "components": components,
                "reason": reason,
                "matchedSkills": [mt.code] if mt and skill else [],
                "proficiency": skill.proficiency if skill else None,
                "available": True,
            }
        )

    # Attendance is kept for production workers only.
    missing = _not_clocked_in_for_today_op(
        [s["workerId"] for s in suggestions if s["role"] == UserRole.PRODUCTION_WORKER.value],
        scheduled_start,
        exclude_operation_id,
    )
    for s in suggestions:
        s["attendanceWarning"] = NOT_CLOCKED_IN if s["workerId"] in missing else None

    suggestions.sort(
        key=lambda s: (
            s["score"],
            s.get("proficiency") or 0,
        ),
        reverse=True,
    )
    return {"weights": weights, "suggestions": suggestions}
