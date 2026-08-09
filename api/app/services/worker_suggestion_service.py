import re

from app.models.user import User, UserRole
from app.models.worker_profile import WorkerProfile
from app.services.worker_availability import get_busy_workers


def _tokenize(text):
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def suggest_workers(operations, exclude_job_id=None):
    """
    Rank production workers by skill match against operation names.

    Busy workers (ASSIGNED / IN_PROGRESS on another job) are omitted.
    The system proposes, the human decides.
    """
    operation_tokens = set()
    for op_name in operations:
        operation_tokens.update(_tokenize(op_name))

    busy = get_busy_workers(exclude_job_id=exclude_job_id)

    workers = (
        User.query.filter_by(role=UserRole.PRODUCTION_WORKER, active=True)
        .join(WorkerProfile)
        .all()
    )

    suggestions = []
    for worker in workers:
        if worker.id in busy:
            continue

        skills = worker.worker_profile.skills if worker.worker_profile else []
        skill_tokens = set()
        for skill in skills:
            skill_tokens.update(_tokenize(skill))

        matched_skills = []
        score = 0
        for skill in skills:
            skill_lower = skill.lower()
            for op_name in operations:
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
