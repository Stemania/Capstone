"""Client job-status notifications (mocked backends / session)."""

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
    job_update_sms,
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
        notify_by_sms=True,
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
    monkeypatch.setattr(svc, "get_sms_backend", lambda cfg: backend)

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


def test_templates_have_no_links_and_sms_fits_160():
    long_title = "Very long description of a fabricated conveyor roller assembly with keyways"
    for m in NotificationMilestone:
        sms = job_update_sms(m, "JO-2026-ABCD", long_title, date(2026, 10, 28))
        assert sms.startswith("BMSC: ")
        assert len(sms) <= 160
        assert "http" not in (sms + job_update_email(m, "JO-2026-ABCD", long_title)).lower()


def test_for_delivery_message_reads_ready_for_delivery():
    body = render_message(NotificationMilestone.JOB_DELIVERED, "JO-2026-ABCD", "Cyclodrive base")
    assert body == "Your job JO-2026-ABCD (Cyclodrive base) is ready for delivery."
    completed = render_message(NotificationMilestone.JOB_COMPLETED, "JO-2026-ABCD", "Cyclodrive base")
    assert "ready for delivery" in completed
    assert "delivered" not in (body + completed).lower()


def test_each_milestone_fires_once_per_job(monkeypatch, flask_app):
    sends = []
    set_job, logs_store, existing = _patch_notify(monkeypatch, sends)
    job = _job(_client())

    with flask_app.app_context():
        set_job(job)
        for m in NotificationMilestone:
            for _ in range(3):
                notify_job_milestone(job.id, m)
                for ch in NotificationChannel:
                    existing.add((job.id, m, ch))

    assert len(sends) == 8
    assert len(logs_store) == 8
    assert all(log.status == NotificationStatus.SENT for log in logs_store)
    assert all(log.provider_reference == "ref-1" for log in logs_store)
    assert {log.event for log in logs_store} == {m.value for m in NotificationMilestone}


def test_email_goes_to_client_email_and_sms_to_normalized_mobile(monkeypatch, flask_app):
    sends = []
    set_job, _, _ = _patch_notify(monkeypatch, sends)
    job = _job(_client(email=" A@Example.com ", mobile_number="0917 123 4567"))

    with flask_app.app_context():
        set_job(job)
        notify_job_milestone(job.id, NotificationMilestone.JOB_RECEIVED)

    email, sms = sends
    assert email["to"] == "a@example.com"
    assert email["parts"][0] == "Job JO-2026-ABCD received - Brothers Machine Shop"
    assert "Target date: Oct 28, 2026." in email["parts"][1]
    assert sms["to"] == "+639171234567"
    assert sms["parts"][0].startswith("BMSC: Your job JO-2026-ABCD")


def test_no_contact_produces_skipped(monkeypatch, flask_app):
    sends = []
    set_job, _, _ = _patch_notify(monkeypatch, sends)
    job = _job(_client(email=None, mobile_number=None))

    with flask_app.app_context():
        set_job(job)
        logs = notify_job_milestone(job.id, NotificationMilestone.JOB_RECEIVED)

    assert sends == []
    assert len(logs) == 2
    assert all(log.status == NotificationStatus.SKIPPED for log in logs)
    assert all("no valid" in (log.error_message or "").lower() for log in logs)


def test_opted_out_produces_skipped(monkeypatch, flask_app):
    sends = []
    set_job, _, _ = _patch_notify(monkeypatch, sends)
    job = _job(_client(notify_by_email=False, notify_by_sms=False))

    with flask_app.app_context():
        set_job(job)
        logs = notify_job_milestone(job.id, NotificationMilestone.JOB_RECEIVED)

    assert sends == []
    assert len(logs) == 2
    assert all(log.status == NotificationStatus.SKIPPED for log in logs)
    assert all("opted out" in (log.error_message or "").lower() for log in logs)


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
    assert len(logs) == 2
    assert all(log.status == NotificationStatus.FAILED for log in logs)
    assert all("provider down" in (log.error_message or "") for log in logs)


def test_console_backend_records_skipped_not_sent(monkeypatch, flask_app):
    sends = []
    set_job, _, _ = _patch_notify(monkeypatch, sends, delivers=False)
    job = _job(_client())

    with flask_app.app_context():
        set_job(job)
        logs = notify_job_milestone(job.id, NotificationMilestone.JOB_STARTED)

    assert len(logs) == 2
    assert all(log.status == NotificationStatus.SKIPPED for log in logs)
    assert all("is console" in log.error_message for log in logs)
    assert all(log.sent_at is None for log in logs)
