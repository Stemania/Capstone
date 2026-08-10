"""Rank production workers with weighted scoring components."""

from app.models.machine import MachineType
from app.models.user import User, UserRole
from app.models.worker_skill import OperationType, WorkerSkill
from app.services.scoring_service import (
    build_reason,
    combine_score,
    fetch_efficiency_pairs,
    load_scoring_weights,
    log_weights_used,
    score_availability,
    score_efficiency,
    score_skill,
    score_workload,
    worker_week_load_hours,
)


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
    Score all active production workers.

    Returns {"weights": {...}, "suggestions": [...]}.
    Unqualified workers (no WorkerSkill for target machine) get score 0.0
    and qualified=false. No proposed window uses neutral availability 0.5.
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

    skill_by_worker = {}
    if target_machine_id:
        for skill in WorkerSkill.query.filter_by(machine_type_id=target_machine_id).all():
            skill_by_worker[skill.worker_id] = skill

    workers = (
        User.query.filter_by(role=UserRole.PRODUCTION_WORKER, active=True)
        .order_by(User.full_name)
        .all()
    )

    # Peer set for workload normalization: qualified workers when machine set,
    # otherwise all active workers.
    if target_machine_id:
        peer_ids = [w.id for w in workers if w.id in skill_by_worker]
    else:
        peer_ids = [w.id for w in workers]

    load_by_worker = {
        wid: worker_week_load_hours(wid, exclude_operation_id=exclude_operation_id)
        for wid in peer_ids
    }
    peer_hours = list(load_by_worker.values())

    suggestions = []
    for worker in workers:
        skill = skill_by_worker.get(worker.id) if target_machine_id else None
        # No machine required → everyone is qualified (skill component = 1.0)
        if target_machine_id:
            qualified = skill is not None
            skill_score, skill_reason, skill_default = score_skill(
                proficiency=skill.proficiency if skill else None,
                is_primary=bool(skill and skill.is_primary),
            )
        else:
            qualified = True
            skill_score, skill_reason, skill_default = (
                1.0,
                "no machine skill required",
                False,
            )

        avail_score, avail_reason, avail_default = score_availability(
            worker.id,
            scheduled_start=scheduled_start,
            scheduled_end=scheduled_end,
            exclude_operation_id=exclude_operation_id,
        )

        hours = load_by_worker.get(
            worker.id,
            worker_week_load_hours(
                worker.id, exclude_operation_id=exclude_operation_id
            ),
        )
        # Unqualified workers are not in peer set; still score vs peer distribution
        work_score, work_reason, work_default = score_workload(hours, peer_hours)

        eff_pairs = fetch_efficiency_pairs(worker.id, resolved_op_type_id)
        eff_score, eff_reason, eff_default = score_efficiency(eff_pairs)

        components = {
            "skill": round(skill_score, 4),
            "availability": round(avail_score, 4),
            "workload": round(work_score, 4),
            "efficiency": round(eff_score, 4),
        }
        total = combine_score(weights, components, qualified=qualified)

        reason_parts = [
            (skill_reason, skill_default),
            (avail_reason, avail_default),
            (work_reason, work_default),
            (eff_reason, eff_default),
        ]
        # Prefer non-default fragments first for readability when qualified
        if qualified:
            ordered = [p for p in reason_parts if not p[1]] + [
                p for p in reason_parts if p[1]
            ]
            reason = build_reason(ordered, machine_label=machine_label, unqualified=False)
        else:
            reason = build_reason(
                reason_parts, machine_label=machine_label or "required", unqualified=True
            )

        skills_codes = [
            s.machine_type.code
            for s in (worker.skills or [])
            if s.machine_type
        ]
        suggestions.append(
            {
                "workerId": worker.id,
                "fullName": worker.full_name,
                "email": worker.email,
                "skills": skills_codes,
                "score": total,
                "qualified": qualified,
                "components": components,
                "reason": reason,
                "matchedSkills": [mt.code] if mt and skill else [],
                "proficiency": skill.proficiency if skill else None,
                "available": avail_score > 0.0,
            }
        )

    suggestions.sort(
        key=lambda s: (s["qualified"], s["score"], s.get("proficiency") or 0),
        reverse=True,
    )
    return {"weights": weights, "suggestions": suggestions}
