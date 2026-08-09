from app.models.job_order import JobOrder, JobOrderStatus
from app.utils.errors import AppError


ACTIVE_ASSIGNMENT_STATUSES = (JobOrderStatus.ASSIGNED, JobOrderStatus.IN_PROGRESS)


def get_busy_workers(exclude_job_id=None):
    """
    Map worker_id -> JobOrder for workers currently assigned to an
    ASSIGNED or IN_PROGRESS job. Optionally ignore one job (edit mode).
    """
    query = JobOrder.query.filter(
        JobOrder.status.in_(ACTIVE_ASSIGNMENT_STATUSES),
        JobOrder.assigned_worker_id.isnot(None),
    )
    if exclude_job_id:
        query = query.filter(JobOrder.id != exclude_job_id)
    return {job.assigned_worker_id: job for job in query.all()}


def assert_worker_available(worker_id, exclude_job_id=None):
    busy = get_busy_workers(exclude_job_id=exclude_job_id)
    job = busy.get(worker_id)
    if job:
        raise AppError(
            f"Worker is unavailable — already assigned to '{job.title}'",
            "CONFLICT",
            409,
        )
