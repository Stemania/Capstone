"""Client progress emails: progress snapshot, skip rules, Delayed, and content.

No database: jobs and operations are plain objects, and sends are recorded.
"""

from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest

from app import create_app
from app.config import TestConfig
from app.models.notification import NotificationMilestone as M
from app.services import job_update_service as ju
from app.services.email_templates import job_update_email_content


class EnabledConfig(TestConfig):
    NOTIFICATIONS_ENABLED = True


@pytest.fixture
def flask_app():
    yield create_app(EnabledConfig)


def _at(d, hour=8):
    # 8 AM Manila = 00:00 UTC.
    return datetime(d.year, d.month, d.day, hour - 8, tzinfo=timezone.utc)


def _op(i, status="SCHEDULED", hours=4.0, start=date(2031, 3, 3), end=date(2031, 3, 3), name=None):
    return SimpleNamespace(
        id=f"op-{i}",
        sequence_no=i,
        operation_name=name or f"Operation {i}",
        status=status,
        estimated_hours=hours,
        scheduled_start=_at(start),
        scheduled_end=_at(end, 16),
    )


def _job(ops, due=date(2031, 3, 20), **extra):
    client = SimpleNamespace(
        id="c-1", email="client@example.com", notify_by_email=True, update_level="DETAILED"
    )
    base = dict(
        id="job-1",
        job_number="JO-2031-0001",
        title="Conveyor shaft",
        due_date=due,
        operations=ops,
        part_condition="MACHINED",
        client=client,
        client_notified_finish=None,
    )
    base.update(extra)
    return SimpleNamespace(**base)


# ---------- progress snapshot ----------


def test_progress_uses_target_hours_and_marks_current_operation():
    ops = [
        _op(1, "COMPLETED", 2),
        _op(2, "COMPLETED", 3),
        _op(3, "IN_PROGRESS", 5, end=date(2031, 3, 12)),
    ]
    p = ju.job_progress(_job(ops))
    assert p["done"] == 2 and p["total"] == 3
    assert p["percent"] == 50  # 5 of 10 target hours
    assert [o["state"] for o in p["operations"]] == ["done", "done", "now"]
    assert p["current"] == "Operation 3"
    assert p["finish"] == date(2031, 3, 12)
    assert p["stage"] == "Machined"
    assert p["onTrack"] is True


def test_short_job_counts_working_days_without_sundays():
    # Fri Mar 7 to Mon Mar 10, 2031 = Fri, Sat, Mon = 3 working days.
    assert ju.working_days(date(2031, 3, 7), date(2031, 3, 10)) == 3
    short = ju.job_progress(_job([_op(1, start=date(2031, 3, 7), end=date(2031, 3, 10))]))
    assert ju.is_short_job(short)
    long = ju.job_progress(_job([_op(1, start=date(2031, 3, 3), end=date(2031, 3, 12))]))
    assert not ju.is_short_job(long)


def test_halfway_and_final_stage_triggers():
    ops = [_op(1, "COMPLETED", 6), _op(2, "SCHEDULED", 4)]
    assert ju.halfway_reached(_job(ops))
    assert not ju.halfway_reached(_job([_op(1, "COMPLETED", 2), _op(2, "SCHEDULED", 8)]))
    # A one-operation job has no halfway or final stage email.
    assert not ju.halfway_reached(_job([_op(1, "COMPLETED", 2)]))
    last = _op(2, "IN_PROGRESS")
    assert ju.is_final_stage_start(_job([_op(1, "COMPLETED"), last]), last)
    first = _op(1, "IN_PROGRESS")
    assert not ju.is_final_stage_start(_job([first, _op(2)]), first)
    assert not ju.is_final_stage_start(_job([first]), first)


# ---------- skip rules ----------


@pytest.fixture
def svc(monkeypatch, flask_app):
    import app.services.notification_service as svc

    sent = []

    def fake_send(job, client, milestone, *, opted_in, recipient, progress=None, skip_reason=None, delay=None):
        sent.append({"milestone": milestone, "skip": skip_reason, "progress": progress, "delay": delay})
        return SimpleNamespace(milestone=milestone)

    monkeypatch.setattr(svc, "_send_job_update", fake_send)
    monkeypatch.setattr(svc, "_already_logged", lambda *a: False)
    monkeypatch.setattr(svc, "_sent_today", lambda job_id: False)
    monkeypatch.setattr(svc, "_delayed_today", lambda job_id: False)
    monkeypatch.setattr(svc, "_remember_finish", lambda job, finish: setattr(job, "client_notified_finish", finish))
    monkeypatch.setattr(ju, "delay_reason", lambda job: "Machine breakdown")
    with flask_app.app_context():
        yield svc, sent


def _use_job(monkeypatch, svc_mod, job):
    monkeypatch.setattr(svc_mod, "JobOrder", SimpleNamespace(query=SimpleNamespace(get=lambda _id: job)))


LONG = dict(start=date(2031, 3, 3), end=date(2031, 3, 14))


def test_progress_emails_go_to_every_client_with_job_updates(svc, monkeypatch):
    svc_mod, sent = svc
    job = _job([_op(1, "IN_PROGRESS", **LONG), _op(2, **LONG)])
    _use_job(monkeypatch, svc_mod, job)
    svc_mod.notify_job_milestone(job.id, M.JOB_STARTED)
    assert sent[-1]["skip"] is None

    # A client saved earlier with "key updates only" now gets progress emails too.
    job.client.update_level = "KEY"
    svc_mod.notify_job_milestone(job.id, M.JOB_HALFWAY)
    assert sent[-1]["skip"] is None


def test_progress_skipped_for_short_jobs_and_same_day(svc, monkeypatch):
    svc_mod, sent = svc
    short = _job([_op(1, "IN_PROGRESS", start=date(2031, 3, 3), end=date(2031, 3, 4))])
    _use_job(monkeypatch, svc_mod, short)
    svc_mod.notify_job_milestone(short.id, M.JOB_STARTED)
    assert sent[-1]["skip"] == ju.SHORT_JOB

    job = _job([_op(1, "IN_PROGRESS", **LONG), _op(2, **LONG)])
    _use_job(monkeypatch, svc_mod, job)
    monkeypatch.setattr(svc_mod, "_sent_today", lambda job_id: True)
    svc_mod.notify_job_milestone(job.id, M.JOB_HALFWAY)
    assert sent[-1]["skip"] == ju.ALREADY_TODAY
    # Ready for delivery is never held back.
    svc_mod.notify_job_milestone(job.id, M.JOB_DELIVERED)
    assert sent[-1]["skip"] is None


def test_halfway_is_not_sent_after_the_final_stage(svc, monkeypatch):
    svc_mod, sent = svc
    job = _job([_op(1, "COMPLETED", **LONG), _op(2, "IN_PROGRESS", **LONG)])
    _use_job(monkeypatch, svc_mod, job)
    monkeypatch.setattr(
        svc_mod, "_already_logged", lambda job_id, milestone, channel: milestone == M.JOB_FINAL_STAGE
    )
    svc_mod.notify_job_milestone(job.id, M.JOB_HALFWAY)
    assert sent == []


def test_received_remembers_the_finish_it_told_the_client(svc, monkeypatch):
    svc_mod, sent = svc
    job = _job([_op(1, **LONG)], due=date(2031, 3, 20))
    _use_job(monkeypatch, svc_mod, job)
    svc_mod.notify_job_milestone(job.id, M.JOB_RECEIVED)
    # Finish Mar 14 is before the date required: the date required is what counts.
    assert job.client_notified_finish == date(2031, 3, 20)


# ---------- Delayed ----------


def _released(ops, **extra):
    from app.models.job_order import JobOrderStatus

    return _job(ops, status=JobOrderStatus.IN_PROGRESS, **extra)


def test_delayed_only_when_the_finish_slips_past_what_the_client_knows(svc):
    svc_mod, sent = svc
    on_time = _released([_op(1, end=date(2031, 3, 19))], due=date(2031, 3, 20))
    assert svc_mod.notify_client_if_delayed(on_time) is None

    late = _released([_op(1, end=date(2031, 3, 24))], due=date(2031, 3, 20))
    assert svc_mod.notify_client_if_delayed(late) is not None
    assert sent[-1]["milestone"] == M.JOB_DELAYED
    assert sent[-1]["delay"] == {"reason": "Machine breakdown", "days": 4}
    assert late.client_notified_finish == date(2031, 3, 24)

    # Same date again, or an earlier one: nothing new to tell.
    assert svc_mod.notify_client_if_delayed(late) is None
    late.operations[0].scheduled_end = _at(date(2031, 3, 22), 16)
    assert svc_mod.notify_client_if_delayed(late) is None
    # Slips further: tell them again.
    late.operations[0].scheduled_end = _at(date(2031, 3, 26), 16)
    assert svc_mod.notify_client_if_delayed(late) is not None
    assert sent[-1]["delay"]["days"] == 6


def test_delayed_at_most_once_a_day_and_only_for_released_jobs(svc, monkeypatch):
    from app.models.job_order import JobOrderStatus

    svc_mod, sent = svc
    monkeypatch.setattr(svc_mod, "_delayed_today", lambda job_id: True)
    late = _released([_op(1, end=date(2031, 3, 24))], due=date(2031, 3, 20))
    assert svc_mod.notify_client_if_delayed(late) is None
    monkeypatch.setattr(svc_mod, "_delayed_today", lambda job_id: False)
    late.status = JobOrderStatus.COMPLETED
    assert svc_mod.notify_client_if_delayed(late) is None
    assert sent == []


# ---------- content ----------


def _progress(**extra):
    p = ju.job_progress(
        _job(
            [
                _op(1, "COMPLETED", 3, name="Cutting"),
                _op(2, "IN_PROGRESS", 3, name="Turning", end=date(2031, 3, 12)),
                _op(3, "SCHEDULED", 3, name="Final inspection", end=date(2031, 3, 12)),
            ]
        )
    )
    p.update(extra)
    return p


def test_ready_for_delivery_says_completed_and_ready(flask_app):
    with flask_app.app_context():
        c = job_update_email_content(M.JOB_DELIVERED, "JO-2031-0001", "Conveyor shaft", progress=_progress())
    assert c.subject == "Job JO-2031-0001 completed and ready for delivery - Brothers Machine Shop"
    assert "has been completed and is ready for delivery" in c.text
    assert "Ready for delivery" in c.html


def test_halfway_email_shows_progress_stage_and_operations(flask_app):
    with flask_app.app_context():
        c = job_update_email_content(M.JOB_HALFWAY, "JO-2031-0001", "Conveyor shaft", progress=_progress())
    assert "progress update" in c.subject
    assert "% of the work done" in c.text
    assert "Stage of the part: Machined" in c.text
    assert "[x] Cutting" in c.text and "[>] Turning (in progress)" in c.text
    assert "On track" in c.html
    assert "http" not in c.text.lower()


def test_delayed_email_shows_new_date_and_reason(flask_app):
    p = _progress(finish=date(2031, 3, 24), onTrack=False)
    with flask_app.app_context():
        c = job_update_email_content(
            M.JOB_DELAYED, "JO-2031-0001", "Conveyor shaft", progress=p,
            delay={"reason": "Machine breakdown", "days": 4},
        )
    assert "delayed" in c.subject
    assert "New expected finish: Mar 24, 2031" in c.text
    assert "Reason: Machine breakdown" in c.text
    assert "4 days late" in c.html


def test_finish_never_in_the_past_for_unfinished_work(monkeypatch):
    from app.services import completion_estimate_service as ces
    from app.services import schedule_calendar as sc

    monkeypatch.setattr(sc, "shop_now", lambda: datetime(2031, 3, 10, 9, tzinfo=sc.SHOP_TZ))
    late = [_op(1, "COMPLETED", 2), _op(2, "IN_PROGRESS", 5, end=date(2031, 3, 5))]

    monkeypatch.setattr(ces, "predict_job", lambda job: {"predictedFinish": _at(date(2031, 3, 13), 15).isoformat()})
    assert ju.job_progress(_job(late))["finish"] == date(2031, 3, 13)

    monkeypatch.setattr(ces, "predict_job", lambda job: None)
    assert ju.job_progress(_job(late))["finish"] == date(2031, 3, 10)  # today, not Mar 5

    done = [_op(1, "COMPLETED", 2, end=date(2031, 3, 5))]
    assert ju.job_progress(_job(done))["finish"] == date(2031, 3, 5)
