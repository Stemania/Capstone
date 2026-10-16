"""Job order info is Office-only while DRAFT; locked after release. Admin is view-only."""

from flask_jwt_extended import create_access_token

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus
from app.models.user import User, UserRole, UserStatus


def _headers(user):
    token = create_access_token(identity=user.id, additional_claims={"role": user.role.value})
    return {"Authorization": f"Bearer {token}"}


def _user(email, role):
    return User(
        email=email,
        password_hash=bcrypt.generate_password_hash("Passw0rd!").decode("utf-8"),
        full_name=email.split("@")[0],
        role=role,
        status=UserStatus.ACTIVE,
        active=True,
    )


def test_office_edits_job_info_before_release(client, app):
    office = _user("lock_office@test.local", UserRole.OFFICE_STAFF)
    admin = _user("lock_admin@test.local", UserRole.ADMIN)
    client_row = Client(name="Lock Client")
    db.session.add_all([office, admin, client_row])
    db.session.commit()

    created = client.post(
        "/api/v1/job-orders",
        json={
            "clientId": client_row.id,
            "title": "Before",
            "dueDate": "2031-06-01",
            "jobType": "FABRICATION",
        },
        headers=_headers(office),
    )
    assert created.status_code == 201, created.get_json()
    job_id = created.get_json()["id"]

    res = client.patch(
        f"/api/v1/job-orders/{job_id}",
        json={"title": "After office edit", "quantity": 2},
        headers=_headers(office),
    )
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert body["title"] == "After office edit"
    assert float(body["quantity"]) == 2.0


def test_office_edit_after_release_blocked(client, app):
    office = _user("lock2_office@test.local", UserRole.OFFICE_STAFF)
    client_row = Client(name="Lock2 Client")
    db.session.add_all([office, client_row])
    db.session.commit()

    created = client.post(
        "/api/v1/job-orders",
        json={
            "clientId": client_row.id,
            "title": "Pending",
            "dueDate": "2031-06-01",
            "jobType": "FABRICATION",
        },
        headers=_headers(office),
    )
    assert created.status_code == 201, created.get_json()
    job_id = created.get_json()["id"]

    row = db.session.get(JobOrder, job_id)
    row.status = JobOrderStatus.SCHEDULED
    db.session.commit()

    res = client.patch(
        f"/api/v1/job-orders/{job_id}",
        json={"title": "Should fail"},
        headers=_headers(office),
    )
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "JOB_INFO_LOCKED"


def test_admin_edit_job_info_blocked(client, app):
    office = _user("lock3_office@test.local", UserRole.OFFICE_STAFF)
    admin = _user("lock3_admin@test.local", UserRole.ADMIN)
    client_row = Client(name="Lock3 Client")
    db.session.add_all([office, admin, client_row])
    db.session.commit()

    created = client.post(
        "/api/v1/job-orders",
        json={
            "clientId": client_row.id,
            "title": "Admin cannot",
            "dueDate": "2031-06-01",
            "jobType": "FABRICATION",
        },
        headers=_headers(office),
    )
    assert created.status_code == 201, created.get_json()
    job_id = created.get_json()["id"]

    res = client.patch(
        f"/api/v1/job-orders/{job_id}",
        json={"title": "Admin edit"},
        headers=_headers(admin),
    )
    assert res.status_code == 403
    assert res.get_json()["error"]["code"] == "FORBIDDEN"

    row = db.session.get(JobOrder, job_id)
    row.status = JobOrderStatus.SCHEDULED
    db.session.commit()

    res = client.patch(
        f"/api/v1/job-orders/{job_id}",
        json={"description": "still blocked"},
        headers=_headers(admin),
    )
    assert res.status_code == 403
