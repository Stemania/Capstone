"""FR-047: resend uses current client email and consent; always logs the attempt."""

from datetime import date, timedelta

import pytest
from flask_jwt_extended import create_access_token

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.notification import (
    NotificationChannel,
    NotificationLog,
    NotificationMilestone,
    NotificationStatus,
)
from app.models.user import User, UserRole, UserStatus


PASSWORD = "Passw0rd!"


def _user(email, role):
    user = User(
        email=email,
        password_hash=bcrypt.generate_password_hash(PASSWORD).decode("utf-8"),
        full_name=email.split("@")[0],
        role=role,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    db.session.flush()
    return user


def _headers(user):
    token = create_access_token(identity=user.id, additional_claims={"role": user.role.value})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def shop(app):
    office = _user("rs_office@test.local", UserRole.OFFICE_STAFF)
    client_row = Client(
        name="Resend Client",
        email="old@example.com",
        notify_by_email=True,
        notify_by_sms=False,
    )
    db.session.add(client_row)
    db.session.flush()
    job = JobOrder(
        client_id=client_row.id,
        title="Resend job",
        due_date=date.today() + timedelta(days=7),
        status=JobOrderStatus.IN_PROGRESS,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        material_status=MaterialStatus.RECEIVED,
        created_by_id=office.id,
    )
    db.session.add(job)
    db.session.flush()
    failed = NotificationLog(
        job_order_id=job.id,
        client_id=client_row.id,
        milestone=NotificationMilestone.JOB_STARTED,
        event=NotificationMilestone.JOB_STARTED.value,
        channel=NotificationChannel.EMAIL,
        recipient="old@example.com",
        message_body="failed body",
        status=NotificationStatus.FAILED,
        error_message="provider down",
    )
    db.session.add(failed)
    db.session.commit()
    return {"office": office, "client": client_row, "job": job, "failed": failed}


def test_resend_uses_current_email_when_consent_on(client, shop, monkeypatch):
    sends = []

    class Capture:
        name = "capture"
        delivers = True

        def send(self, to, *parts):
            sends.append(to)
            return "ref-resend"

    monkeypatch.setitem(client.application.config, "NOTIFICATIONS_ENABLED", True)
    monkeypatch.setitem(client.application.config, "NOTIFY_ALLOWLIST", "")
    import app.services.email_backends as email_backends
    import app.services.notification_service as notif_svc

    monkeypatch.setattr(email_backends, "get_email_backend", lambda _cfg: Capture())
    monkeypatch.setattr(notif_svc, "get_email_backend", lambda _cfg: Capture())

    shop["client"].email = "current@example.com"
    db.session.commit()

    h = _headers(shop["office"])
    before = NotificationLog.query.count()
    res = client.post(f"/api/v1/notifications/{shop['failed'].id}/resend", headers=h)
    assert res.status_code == 200, res.get_json()
    assert NotificationLog.query.count() == before + 1
    assert sends == ["current@example.com"]
    body = res.get_json()
    assert body["recipient"] == "current@example.com"
    assert body["status"] == "SENT"


def test_resend_logs_and_errors_when_email_updates_off(client, shop):
    shop["client"].notify_by_email = False
    shop["client"].email = "still@example.com"
    db.session.commit()

    h = _headers(shop["office"])
    before = NotificationLog.query.count()
    res = client.post(f"/api/v1/notifications/{shop['failed'].id}/resend", headers=h)
    assert res.status_code == 400
    err = res.get_json()["error"]
    assert err["code"] == "EMAIL_UPDATES_OFF"
    assert err["message"] == "Email updates are off for this client"
    assert NotificationLog.query.count() == before + 1
    latest = NotificationLog.query.order_by(NotificationLog.created_at.desc()).first()
    assert latest.status == NotificationStatus.SKIPPED
    assert latest.error_message == "Email updates are off for this client"
    assert latest.recipient in ("still@example.com", "(none)") or "still@" in latest.recipient
