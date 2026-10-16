"""Draft PATCH rejects operation windows that violate sequence order."""

from datetime import time, timedelta

from flask_jwt_extended import create_access_token

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.user import User, UserRole, UserStatus
from app.models.worker_profile import WorkerProfile
from app.models.worker_skill import WorkerSchedule
from app.services.schedule_calendar import shop_local_to_utc, shop_now


def _headers(user):
    token = create_access_token(identity=user.id, additional_claims={"role": user.role.value})
    return {"Authorization": f"Bearer {token}"}


def _user(email, role):
    user = User(
        email=email,
        password_hash=bcrypt.generate_password_hash("Passw0rd!").decode("utf-8"),
        full_name=email.split("@")[0],
        role=role,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    db.session.flush()
    if role == UserRole.PRODUCTION_WORKER:
        db.session.add(WorkerProfile(user_id=user.id))
        for dow in range(6):
            db.session.add(
                WorkerSchedule(
                    worker_id=user.id,
                    day_of_week=dow,
                    is_working=True,
                    start_time=time(8, 0),
                    end_time=time(17, 0),
                )
            )
    return user


def _iso(d, hh, mm=0):
    return shop_local_to_utc(d, time(hh, mm)).isoformat()


def test_draft_patch_rejects_sequence_violation(client, app):
    office = _user("seq_office@test.local", UserRole.OFFICE_STAFF)
    admin = _user("seq_admin@test.local", UserRole.ADMIN)
    worker = _user("seq_worker@test.local", UserRole.PRODUCTION_WORKER)
    client_row = Client(name="Seq Client")
    db.session.add(client_row)
    db.session.commit()

    today = shop_now().date()
    mon = today + timedelta(days=(7 - today.weekday()) % 7 + 7)

    created = client.post(
        "/api/v1/job-orders",
        json={
            "clientId": client_row.id,
            "title": "Seq job",
            "dueDate": "2031-06-01",
            "jobType": "FABRICATION",
            "materialStatus": "NOT_REQUIRED",
        },
        headers=_headers(office),
    )
    assert created.status_code == 201, created.get_json()
    job_id = created.get_json()["id"]

    res = client.patch(
        f"/api/v1/job-orders/{job_id}",
        json={
            "operations": [
                {
                    "sequenceNo": 1,
                    "operationName": "Turning",
                    "assignedWorkerId": worker.id,
                    "estimatedHours": 4,
                    "scheduledStart": _iso(mon, 8),
                    "scheduledEnd": _iso(mon, 12),
                },
                {
                    "sequenceNo": 2,
                    "operationName": "Milling",
                    "assignedWorkerId": worker.id,
                    "estimatedHours": 3,
                    # Starts before op 1 ends.
                    "scheduledStart": _iso(mon, 10),
                    "scheduledEnd": _iso(mon, 13),
                },
            ]
        },
        headers=_headers(admin),
    )
    assert res.status_code == 409, res.get_json()
    assert res.get_json()["error"]["code"] == "SEQUENCE_VIOLATION"


def test_draft_patch_accepts_in_order_windows(client, app):
    office = _user("seq2_office@test.local", UserRole.OFFICE_STAFF)
    admin = _user("seq2_admin@test.local", UserRole.ADMIN)
    worker = _user("seq2_worker@test.local", UserRole.PRODUCTION_WORKER)
    client_row = Client(name="Seq2 Client")
    db.session.add(client_row)
    db.session.commit()

    today = shop_now().date()
    mon = today + timedelta(days=(7 - today.weekday()) % 7 + 7)

    created = client.post(
        "/api/v1/job-orders",
        json={
            "clientId": client_row.id,
            "title": "Seq ok",
            "dueDate": "2031-06-01",
            "jobType": "FABRICATION",
            "materialStatus": "NOT_REQUIRED",
        },
        headers=_headers(office),
    )
    assert created.status_code == 201, created.get_json()
    job_id = created.get_json()["id"]

    res = client.patch(
        f"/api/v1/job-orders/{job_id}",
        json={
            "operations": [
                {
                    "sequenceNo": 1,
                    "operationName": "Turning",
                    "assignedWorkerId": worker.id,
                    "estimatedHours": 4,
                    "scheduledStart": _iso(mon, 8),
                    "scheduledEnd": _iso(mon, 12),
                },
                {
                    "sequenceNo": 2,
                    "operationName": "Milling",
                    "assignedWorkerId": worker.id,
                    "estimatedHours": 3,
                    "scheduledStart": _iso(mon, 12),
                    "scheduledEnd": _iso(mon, 15),
                },
            ]
        },
        headers=_headers(admin),
    )
    assert res.status_code == 200, res.get_json()
