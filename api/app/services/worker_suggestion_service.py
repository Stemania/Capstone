from app.models.machine import MachineType
from app.models.user import User, UserRole
from app.models.worker_skill import OperationType, WorkerSkill
from app.services.worker_availability import is_worker_available


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
        # Fallback: match operation type by name/code
        ot = OperationType.query.filter(
            (OperationType.name.ilike(operation_name))
            | (OperationType.code.ilike(str(operation_name).replace(" ", "_")))
        ).first()
        if ot and ot.default_machine_type_id:
            return ot.default_machine_type_id
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
    Suggest workers who have a WorkerSkill for the target machine type,
    ranked by proficiency (desc). Busy workers are omitted.

    `operations` may still be a list of names (takes first) for back-compat.
    """
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

    # No machine required (e.g. welding/checking): suggest any available worker, score 0
    if not target_machine_id:
        workers = (
            User.query.filter_by(role=UserRole.PRODUCTION_WORKER, active=True)
            .order_by(User.full_name)
            .all()
        )
        suggestions = []
        for worker in workers:
            if not is_worker_available(
                worker.id,
                start=scheduled_start,
                end=scheduled_end,
                exclude_operation_id=exclude_operation_id,
            ):
                continue
            skills = [s.to_dict() for s in (worker.skills or [])]
            suggestions.append(
                {
                    "workerId": worker.id,
                    "fullName": worker.full_name,
                    "email": worker.email,
                    "skills": [s.get("machineTypeCode") for s in skills if s.get("machineTypeCode")],
                    "score": 0,
                    "matchedSkills": [],
                    "proficiency": None,
                    "available": True,
                }
            )
        return suggestions

    mt = MachineType.query.get(target_machine_id)
    skill_rows = (
        WorkerSkill.query.filter_by(machine_type_id=target_machine_id)
        .order_by(WorkerSkill.proficiency.desc(), WorkerSkill.is_primary.desc())
        .all()
    )

    suggestions = []
    for skill in skill_rows:
        worker = skill.worker
        if not worker or not worker.active or worker.role != UserRole.PRODUCTION_WORKER:
            continue
        if not is_worker_available(
            worker.id,
            start=scheduled_start,
            end=scheduled_end,
            exclude_operation_id=exclude_operation_id,
        ):
            continue
        suggestions.append(
            {
                "workerId": worker.id,
                "fullName": worker.full_name,
                "email": worker.email,
                "skills": [
                    s.machine_type.code
                    for s in (worker.skills or [])
                    if s.machine_type
                ],
                "score": int(skill.proficiency),
                "matchedSkills": [mt.code] if mt else [],
                "proficiency": skill.proficiency,
                "available": True,
            }
        )

    suggestions.sort(key=lambda s: s["score"], reverse=True)
    return suggestions
