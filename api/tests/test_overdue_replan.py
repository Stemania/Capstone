"""Re-plan of Scheduled jobs whose first start has passed (dry run and apply)."""

from datetime import datetime, time, timedelta, timezone

from app.extensions import db
from app.models.job_order import JobOrder, MaterialStatus
from app.models.schedule_move import DelayKind, ScheduleMove
from app.services.overdue_replan_service import replan_overdue
from app.services.schedule_calendar import ensure_utc, utc_to_shop
from tests.test_material_delay import _job, _local, shop  # noqa: F401


def _reload(job):
    db.session.expire_all()
    return db.session.get(JobOrder, job.id)


def _past_job(shop, *, days_ago=2, materials=True):
    job, ops = _job(shop, _local(shop["today"] - timedelta(days=days_ago), 9))
    if not materials:
        job.material_status = MaterialStatus.NOT_REQUIRED
        job.raw_materials = []
        db.session.commit()
    return job, [ensure_utc(op.scheduled_start) for op in ops]


def test_dry_run_lists_job_and_changes_nothing(app, shop):
    job, old = _past_job(shop)
    result = replan_overdue(apply=False)

    assert [r["jobNumber"] for r in result["moved"]] == [job.job_number]
    row = result["moved"][0]
    assert row["currentFirstStart"] == old[0].isoformat()
    assert row["waitingForMaterials"] is True
    assert row["startedByMaterials"] is True
    assert {w["workerId"] for w in row["workers"]} == {shop["worker"].id}

    job = _reload(job)
    assert [ensure_utc(op.scheduled_start) for op in job.operations] == old
    assert job.material_delay_original_start is None
    assert ScheduleMove.query.count() == 0


def test_material_move_then_reschedule_keeps_both_kinds(app, shop):
    job, old = _past_job(shop, materials=False)
    job.material_delay_original_start = old[0] - timedelta(days=5)
    job.delay_kind = DelayKind.MATERIAL
    db.session.add(
        ScheduleMove(
            job_order_id=job.id,
            kind=DelayKind.MATERIAL,
            previous_start=old[0] - timedelta(days=5),
            new_start=old[0],
        )
    )
    db.session.commit()
    replan_overdue(apply=True)

    job = _reload(job)
    assert job.delay_kind == DelayKind.RESCHEDULED
    kinds = sorted(m.kind for m in ScheduleMove.query.filter_by(job_order_id=job.id))
    assert kinds == [DelayKind.MATERIAL, DelayKind.RESCHEDULED]


def test_apply_uses_material_floor_and_records_original_start(app, shop):
    job, old = _past_job(shop)
    result = replan_overdue(apply=True)
    assert len(result["moved"]) == 1

    job = _reload(job)
    first = min(job.operations, key=lambda o: o.sequence_no)
    start = utc_to_shop(ensure_utc(first.scheduled_start))
    # Planned material not ordered: today + longest active lead time (10 days).
    assert start.date() == shop["today"] + timedelta(days=10)
    assert start.time() == time(8, 0)
    assert all(op.assigned_worker_id == shop["worker"].id for op in job.operations)
    assert ensure_utc(job.material_delay_original_start) == old[0]
    assert job.material_delay_reason.startswith("Overdue re-plan")
    assert job.delay_kind == DelayKind.MATERIAL
    assert result["moved"][0]["delayKind"] == DelayKind.MATERIAL
    moves = ScheduleMove.query.filter_by(job_order_id=job.id).all()
    assert [(m.kind, ensure_utc(m.previous_start)) for m in moves] == [(DelayKind.MATERIAL, old[0])]
    assert ensure_utc(moves[0].new_start) == ensure_utc(first.scheduled_start)


def test_without_materials_moves_to_now_or_later(app, shop):
    job, old = _past_job(shop, materials=False)
    before = datetime.now(timezone.utc)
    replan_overdue(apply=True)

    job = _reload(job)
    starts = sorted(ensure_utc(op.scheduled_start) for op in job.operations)
    assert starts[0] >= before.replace(microsecond=0) - timedelta(minutes=1)
    assert all(new > o for new, o in zip(starts, old))
    assert "start date passed" in job.material_delay_reason
    assert job.material_delay_supplier_order_id is None
    assert job.delay_kind == DelayKind.RESCHEDULED
    assert job.to_dict()["materialDelay"]["kind"] == DelayKind.RESCHEDULED
    assert [m.kind for m in ScheduleMove.query.filter_by(job_order_id=job.id)] == [DelayKind.RESCHEDULED]


def test_original_start_is_kept_from_an_earlier_delay(app, shop):
    job, old = _past_job(shop, materials=False)
    earlier = old[0] - timedelta(days=5)
    job.material_delay_original_start = earlier
    db.session.commit()
    replan_overdue(apply=True)
    assert ensure_utc(_reload(job).material_delay_original_start) == earlier


def test_excluded_jobs_are_left_as_they_are(app, shop):
    keep, old = _past_job(shop, materials=False)
    result = replan_overdue(apply=True, exclude=[keep.job_number])

    assert result["moved"] == [] and result["excluded"] == [keep.job_number]
    keep = _reload(keep)
    assert ensure_utc(min(keep.operations, key=lambda o: o.sequence_no).scheduled_start) == old[0]
    assert keep.delay_kind is None and ScheduleMove.query.count() == 0


def test_future_and_started_jobs_are_left_alone(app, shop):
    future, future_old = _job(shop, _local(shop["today"] + timedelta(days=3), 9))
    started, started_ops = _job(shop, _local(shop["today"] - timedelta(days=1), 9))
    started_ops[0].actual_start = started_ops[0].scheduled_start
    db.session.commit()

    result = replan_overdue(apply=True)
    assert result["moved"] == [] and result["notPlaced"] == []
    assert _reload(started).material_delay_original_start is None


def test_job_that_cannot_be_placed_is_listed_with_reason(app, shop):
    job, old = _past_job(shop, materials=False)
    job.operations[1].assigned_worker_id = None
    db.session.commit()

    result = replan_overdue(apply=True)
    assert result["moved"] == []
    assert [r["jobNumber"] for r in result["notPlaced"]] == [job.job_number]
    assert result["notPlaced"][0]["reason"]
    job = _reload(job)
    assert ensure_utc(min(job.operations, key=lambda o: o.sequence_no).scheduled_start) == old[0]
    assert job.material_delay_original_start is None


def test_two_overdue_jobs_for_one_worker_do_not_overlap(app, shop):
    a, _ = _past_job(shop, days_ago=3, materials=False)
    b, _ = _past_job(shop, days_ago=2, materials=False)
    replan_overdue(apply=True)

    windows = sorted(
        (ensure_utc(op.scheduled_start), ensure_utc(op.scheduled_end))
        for job in (_reload(a), _reload(b))
        for op in job.operations
    )
    for (s1, e1), (s2, _) in zip(windows, windows[1:]):
        assert s2 >= e1
