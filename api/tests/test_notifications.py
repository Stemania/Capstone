"""Client job-status notifications (email only, mocked backends / session)."""

from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app import create_app
from app.config import TestConfig
from app.models.notification import (
    NotificationChannel,
    NotificationMilestone,
    NotificationStatus,
)
from app.services.notification_service import notify_job_milestone
from app.services.notification_templates import (
    job_update_email,
    job_update_subject,
    render_message,
)


class EnabledConfig(TestConfig):
    NOTIFICATIONS_ENABLED = True


@pytest.fixture
def flask_app():
    """App context without touching the database."""
    yield create_app(EnabledConfig)


def _client(**kwargs):
    defaults = dict(
        id="client-1",
        name="Acme",
        email="a@example.com",
        mobile_number="+639171234567",
        notify_by_email=True,
        notify_by_sms=False,
    )
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def _job(client):
    return SimpleNamespace(
        id="job-abcd-1111",
        job_number="JO-2026-ABCD",
        title="Shaft repair",
        due_date=date(2026, 10, 28),
        created_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
        client=client,
        client_id=client.id,
    )


class RecordingBackend:
    name = "recording"
    delivers = True

    def __init__(self, sends, fail=False, delivers=True):
        self.sends = sends
        self.fail = fail
        self.delivers = delivers

    def send(self, to, *parts):
        if self.fail:
            raise RuntimeError("provider down")
        self.sends.append({"to": to, "parts": parts})
        return "ref-1"


def _patch_notify(monkeypatch, sends, *, fail=False, existing=None, delivers=True):
    import app.services.notification_service as svc

    logs_store = []
    existing = existing if existing is not None else set()

    class FakeJobQuery:
        def __init__(self, job):
            self._job = job

        def get(self, job_id):
            return self._job

    class FakeLogQuery:
        def filter_by(self, **kwargs):
            key = (kwargs.get("job_order_id"), kwargs.get("milestone"), kwargs.get("channel"))

            class Q:
                def first(self_inner):
                    return object() if key in existing else None

            return Q()

    def fake_add(obj):
        logs_store.append(obj)

    session = MagicMock()
    session.add.side_effect = fake_add
    monkeypatch.setattr(svc, "db", SimpleNamespace(session=session))
    backend = RecordingBackend(sends, fail=fail, delivers=delivers)
    monkeypatch.setattr(svc, "get_email_backend", lambda cfg: backend)

    def set_job(job):
        monkeypatch.setattr(svc, "JobOrder", SimpleNamespace(query=FakeJobQuery(job)))

        class NL:
            query = FakeLogQuery()

            def __init__(self, **kwargs):
                for k, v in kwargs.items():
                    setattr(self, k, v)

        monkeypatch.setattr(svc, "NotificationLog", NL)
        return logs_store

    return set_job, logs_store, existing


def test_received_templates_match_the_agreed_wording():
    m = NotificationMilestone.JOB_RECEIVED
    assert job_update_subject(m, "JO-2026-ABCD") == "Job JO-2026-ABCD received - Brothers Machine Shop"
    assert render_message(m, "JO-2026-ABCD", "Conveyor roller", date(2026, 10, 28)) == (
        "Your job JO-2026-ABCD (Conveyor roller) has been received and scheduled. "
        "Target date: Oct 28, 2026."
    )
    assert job_update_email(m, "JO-2026-ABCD", "Conveyor roller").endswith("Brothers Machine Shop")


def test_templates_have_no_links():
    long_title = "Very long description of a fabricated conveyor roller assembly with keyways"
    for m in NotificationMilestone:
        assert "http" not in job_update_email(m, "JO-2026-ABCD", long_title).lower()


def test_for_delivery_message_reads_ready_for_delivery():
    body = render_message(NotificationMilestone.JOB_DELIVERED, "JO-2026-ABCD", "Cyclodrive base")
    assert body == "Your job JO-2026-ABCD (Cyclodrive base) has been completed and is ready for delivery."
    completed = render_message(NotificationMilestone.JOB_COMPLETED, "JO-2026-ABCD", "Cyclodrive base")
    assert "ready for delivery" in completed
    assert "delivered" not in (body + completed).lower()


def test_each_milestone_fires_once_per_job(monkeypatch, flask_app):
    sends = []
    set_job, logs_store, existing = _patch_notify(monkeypatch, sends)
    job = _job(_client())

    import app.services.notification_service as svc

    monkeypatch.setattr(svc, "_sent_today", lambda job_id: False)
    # Delayed has its own rule (notify_client_if_delayed), not once per job.
    once = [m for m in NotificationMilestone if m != NotificationMilestone.JOB_DELAYED]
    with flask_app.app_context():
        set_job(job)
        for m in NotificationMilestone:
            for _ in range(3):
                notify_job_milestone(job.id, m)
                existing.add((job.id, m, NotificationChannel.EMAIL))

    assert len(sends) == len(once)
    assert len(logs_store) == len(once)
    assert all(log.status == NotificationStatus.SENT for log in logs_store)
    assert all(log.provider_reference == "ref-1" for log in logs_store)
    assert {log.event for log in logs_store} == {m.value for m in once}


def test_email_goes_to_normalized_client_email(monkeypatch, flask_app):
    sends = []
    set_job, _, _ = _patch_notify(monkeypatch, sends)
    job = _job(_client(email=" A@Example.com ", mobile_number="0917 123 4567"))

    with flask_app.app_context():
        set_job(job)
        notify_job_milestone(job.id, NotificationMilestone.JOB_RECEIVED)

    assert len(sends) == 1
    email = sends[0]
    assert email["to"] == "a@example.com"
    assert email["parts"][0] == "Job JO-2026-ABCD received - Brothers Machine Shop"
    assert "Your target date: Oct 28, 2026" in email["parts"][1]


def test_no_contact_produces_skipped(monkeypatch, flask_app):
    sends = []
    set_job, _, _ = _patch_notify(monkeypatch, sends)
    job = _job(_client(email=None, mobile_number=None))

    with flask_app.app_context():
        set_job(job)
        logs = notify_job_milestone(job.id, NotificationMilestone.JOB_RECEIVED)

    assert sends == []
    assert len(logs) == 1
    assert logs[0].status == NotificationStatus.SKIPPED
    assert "no valid" in (logs[0].error_message or "").lower()


def test_opted_out_produces_skipped(monkeypatch, flask_app):
    sends = []
    set_job, _, _ = _patch_notify(monkeypatch, sends)
    job = _job(_client(notify_by_email=False, notify_by_sms=True))

    with flask_app.app_context():
        set_job(job)
        logs = notify_job_milestone(job.id, NotificationMilestone.JOB_RECEIVED)

    assert sends == []
    assert len(logs) == 1
    assert logs[0].status == NotificationStatus.SKIPPED
    assert "opted out" in (logs[0].error_message or "").lower()


def test_sms_opt_in_alone_does_not_send(monkeypatch, flask_app):
    sends = []
    set_job, _, _ = _patch_notify(monkeypatch, sends)
    job = _job(_client(notify_by_email=False, notify_by_sms=True, email="a@example.com"))

    with flask_app.app_context():
        set_job(job)
        logs = notify_job_milestone(job.id, NotificationMilestone.JOB_STARTED)

    assert sends == []
    assert len(logs) == 1
    assert logs[0].status == NotificationStatus.SKIPPED


def test_failed_send_does_not_roll_back_trigger(monkeypatch, flask_app):
    sends = []
    set_job, _, _ = _patch_notify(monkeypatch, sends, fail=True)
    job = _job(_client())
    job.status = "DELIVERED"
    job.delivered_at = datetime.now(timezone.utc)

    with flask_app.app_context():
        set_job(job)
        logs = notify_job_milestone(job.id, NotificationMilestone.JOB_DELIVERED)

    assert job.status == "DELIVERED"
    assert job.delivered_at is not None
    assert len(logs) == 1
    assert logs[0].status == NotificationStatus.FAILED
    assert "provider down" in (logs[0].error_message or "")


def test_console_backend_records_skipped_not_sent(monkeypatch, flask_app):
    sends = []
    set_job, _, _ = _patch_notify(monkeypatch, sends, delivers=False)
    job = _job(_client())

    with flask_app.app_context():
        set_job(job)
        logs = notify_job_milestone(job.id, NotificationMilestone.JOB_STARTED)

    assert len(logs) == 1
    assert logs[0].status == NotificationStatus.SKIPPED
    assert "is console" in logs[0].error_message
    assert logs[0].sent_at is None
