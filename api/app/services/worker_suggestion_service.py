import re

from app.models.user import User, UserRole
from app.models.worker_profile import WorkerProfile
from app.services.worker_availability import is_worker_available


def _tokenize(text):
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def suggest_workers(operations, exclude_job_id=None, scheduled_start=None, scheduled_end=None, exclude_operation_id=None):
    """
    Rank production workers by skill match against operation names.
    Busy workers (schedule overlap / in-progress) are omitted.
    `operations` may be a list of names or a single name string.
    """
    if isinstance(operations, str):
        op_names = [operations]
    else:
        op_names = list(operations or [])

    operation_tokens = set()
    for op_name in op_names:
        operation_tokens.update(_tokenize(op_name))

    workers = (
        User.query.filter_by(role=UserRole.PRODUCTION_WORKER, active=True)
        .join(WorkerProfile)
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

        skills = worker.worker_profile.skills if worker.worker_profile else []
        skill_tokens = set()
        for skill in skills:
            skill_tokens.update(_tokenize(skill))

        matched_skills = []
        score = 0
        for skill in skills:
            skill_lower = skill.lower()
            for op_name in op_names:
                if skill_lower in op_name.lower() or any(
                    t in op_name.lower() for t in _tokenize(skill)
                ):
                    if skill not in matched_skills:
                        matched_skills.append(skill)
                        score += 1

        overlap = len(skill_tokens & operation_tokens)
        score += overlap

        suggestions.append(
            {
                "workerId": worker.id,
                "fullName": worker.full_name,
                "email": worker.email,
                "skills": skills,
                "score": score,
                "matchedSkills": matched_skills,
                "available": True,
            }
        )

    suggestions.sort(key=lambda s: s["score"], reverse=True)
    return suggestions
