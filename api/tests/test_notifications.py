"""Tests for client milestone notifications (mocked providers / session)."""

from datetime import datetime, timezone
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
from app.services.notification_templates import render_message


@pytest.fixture
def flask_app():
    """App context without touching the database."""
    application = create_app(TestConfig)
    yield application


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
        title="Shaft repair",
        created_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
        client=client,
        client_id=client.id,
    )


class RecordingProvider:
    name = "console"

    def __init__(self, sends, fail=False):
        self.sends = sends
        self.fail = fail

    def send(self, recipient, body):
        if self.fail:
            raise RuntimeError("provider down")
        self.sends.append({"recipient": recipient, "body": body})


def _patch_notify(monkeypatch, sends, *, fail=False, existing=None):
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
            key = (
                kwargs.get("job_order_id"),
                kwargs.get("milestone"),
                kwargs.get("channel"),
            )

            class Q:
                def first(self_inner):
                    return object() if key in existing else None

            return Q()

    def fake_add(obj):
        logs_store.append(obj)
        if not getattr(obj, "id", None):
            obj.id = f"log-{len(logs_store)}"

    session = MagicMock()
    session.add.side_effect = fake_add
    session.flush.return_value = None
    session.commit.return_value = None
    session.rollback.return_value = None

    monkeypatch.setattr(svc, "db", SimpleNamespace(session=session))
    monkeypatch.setattr(
        svc,
        "build_email_provider",
        lambda cfg: (RecordingProvider(sends, fail=fail), False),
    )
    monkeypatch.setattr(
        svc,
        "build_sms_provider",
        lambda cfg: (RecordingProvider(sends, fail=fail), False),
    )

    def set_job(job):
        monkeypatch.setattr(svc, "JobOrder", SimpleNamespace(query=FakeJobQuery(job)))

        class NL:
            query = FakeLogQuery()

            def __init__(self, **kwargs):
                for k, v in kwargs.items():
                    setattr(self, k, v)
                self.id = None

        monkeypatch.setattr(svc, "NotificationLog", NL)
        return logs_store

    return set_job, logs_store, existing


def test_templates_include_job_and_milestone_no_links():
    body = render_message(
        NotificationMilestone.JOB_RECEIVED, "JO-2026-ABCD", "Cyclodrive base"
    )
    assert "JO-2026-ABCD" in body
    assert "Cyclodrive" in body
    assert "http" not in body.lower()


def test_each_milestone_fires_once_per_job(monkeypatch, flask_app):
    sends = []
    set_job, logs_store, existing = _patch_notify(monkeypatch, sends)
    client = _client()
    job = _job(client)

    with flask_app.app_context():
        set_job(job)
        for m in (
            NotificationMilestone.JOB_RECEIVED,
            NotificationMilestone.JOB_STARTED,
            NotificationMilestone.JOB_COMPLETED,
            NotificationMilestone.JOB_DELIVERED,
        ):
            notify_job_milestone(job.id, m)
            for ch in (NotificationChannel.EMAIL, NotificationChannel.SMS):
                existing.add((job.id, m, ch))
            notify_job_milestone(job.id, m)

    assert len(sends) == 8
    assert len(logs_store) == 8
    assert all(log.status == NotificationStatus.SENT for log in logs_store)


def test_no_notification_per_operation_only_four_milestones(monkeypatch, flask_app):
    """Six ops still only produce four milestones (8 channel logs), not a dozen."""
    sends = []
    set_job, logs_store, existing = _patch_notify(monkeypatch, sends)
    client = _client()
    job = _job(client)

    with flask_app.app_context():
        set_job(job)
        for m in (
            NotificationMilestone.JOB_RECEIVED,
            NotificationMilestone.JOB_STARTED,
            NotificationMilestone.JOB_COMPLETED,
            NotificationMilestone.JOB_DELIVERED,
        ):
            notify_job_milestone(job.id, m)
            for ch in (NotificationChannel.EMAIL, NotificationChannel.SMS):
                existing.add((job.id, m, ch))
            for _ in range(6):
                notify_job_milestone(job.id, m)

    assert len(sends) == 8
    assert len(logs_store) == 8


def test_no_contact_produces_skipped(monkeypatch, flask_app):
    sends = []
    set_job, logs_store, _ = _patch_notify(monkeypatch, sends)
    client = _client(
        email=None, mobile_number=None, notify_by_email=True, notify_by_sms=True
    )
    job = _job(client)

    with flask_app.app_context():
        set_job(job)
        logs = notify_job_milestone(job.id, NotificationMilestone.JOB_RECEIVED)

    assert sends == []
    assert len(logs) == 2
    assert all(log.status == NotificationStatus.SKIPPED for log in logs)
    assert all("contact" in (log.error_message or "").lower() for log in logs)


def test_opted_out_produces_skipped(monkeypatch, flask_app):
    sends = []
    set_job, logs_store, _ = _patch_notify(monkeypatch, sends)
    client = _client(notify_by_email=False, notify_by_sms=False)
    job = _job(client)

    with flask_app.app_context():
        set_job(job)
        logs = notify_job_milestone(job.id, NotificationMilestone.JOB_RECEIVED)

    assert sends == []
    assert len(logs) == 2
    assert all(log.status == NotificationStatus.SKIPPED for log in logs)
    assert all("opted out" in (log.error_message or "").lower() for log in logs)


def test_failed_send_does_not_roll_back_trigger(monkeypatch, flask_app):
    sends = []
    set_job, logs_store, _ = _patch_notify(monkeypatch, sends, fail=True)
    client = _client()
    job = _job(client)
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
