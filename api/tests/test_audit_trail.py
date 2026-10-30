"""Audit trail: sign-in events, old → new values on changes, secrets kept out,
and the Admin-only Audit Log and job History."""

from datetime import date, datetime, time, timedelta, timezone

import pytest
from flask_jwt_extended import create_access_token

from app.extensions import bcrypt, db
from app.models.audit_log import AuditLog
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.machine import MachineType, MachineUnit
from app.models.operation import JobOperation, OperationHelper
from app.models.user import User, UserRole, UserStatus
from app.models.worker_profile import WorkerProfile

PASSWORD = "Passw0rd!"


def _user(email, role, name):
    user = User(
        email=email,
        password_hash=bcrypt.generate_password_hash(PASSWORD).decode("utf-8"),
        full_name=name,
        role=role,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    db.session.flush()
    if role == UserRole.PRODUCTION_WORKER:
        db.session.add(WorkerProfile(user_id=user.id))
    return user


def _headers(user):
    token = create_access_token(identity=user.id, additional_claims={"role": user.role.value})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def shop(app):
    admin = _user("audit_admin@test.local", UserRole.ADMIN, "Audit Admin")
    office = _user("audit_office@test.local", UserRole.OFFICE_STAFF, "Audit Office")
    worker = _user("audit_worker@test.local", UserRole.PRODUCTION_WORKER, "Audit Worker")
    helper = _user("audit_helper@test.local", UserRole.PRODUCTION_WORKER, "Audit Helper")
    lathe = MachineType(code="LATHE", name="Lathe", units=1)
    db.session.add(lathe)
    db.session.flush()
    unit = MachineUnit(machine_type_id=lathe.id, label="Lathe A-1")
    client_row = Client(name="Audit Client")
    db.session.add_all([unit, client_row])
    db.session.commit()
    return {
        "admin": admin,
        "office": office,
        "worker": worker,
        "helper": helper,
        "unit": unit,
        "lathe": lathe,
        "client": client_row,
    }


def _job(shop, title="Audit Shaft"):
    job = JobOrder(
        client_id=shop["client"].id,
        title=title,
        due_date=date(2031, 4, 1),
        status=JobOrderStatus.DRAFT,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        material_status=MaterialStatus.NOT_REQUIRED,
        created_by_id=shop["office"].id,
    )
    db.session.add(job)
    db.session.commit()
    return job


def _rows(**filters):
    return AuditLog.query.filter_by(**filters).order_by(AuditLog.created_at).all()


# --- sign-in events -----------------------------------------------------------


def test_successful_login_is_recorded_with_the_user(client, shop):
    res = client.post(
        "/api/v1/auth/login",
        json={"identifier": "audit_office@test.local", "password": PASSWORD, "deviceLabel": "Chrome on Windows"},
    )
    assert res.status_code == 200, res.get_json()
    [row] = _rows(action="LOGIN_SUCCEEDED")
    assert row.user_id == shop["office"].id
    assert row.user_role == "OFFICE_STAFF"
    assert row.after_json == {"via": "PASSWORD", "device": "Chrome on Windows"}


def test_failed_logins_record_the_reason_but_answer_generically(client, shop):
    res = client.post(
        "/api/v1/auth/login", json={"identifier": "audit_office@test.local", "password": "wrong-one"}
    )
    assert res.status_code == 401
    assert res.get_json()["error"]["code"] == "INVALID_CREDENTIALS"
    res = client.post("/api/v1/auth/login", json={"identifier": "nobody@test.local", "password": "x"})
    assert res.status_code == 401

    wrong, unknown = _rows(action="LOGIN_FAILED")
    assert wrong.user_id == shop["office"].id
    assert wrong.after_json["reason"] == "WRONG_PASSWORD"
    assert "wrong-one" not in str(wrong.after_json)
    assert unknown.user_id is None
    assert unknown.after_json == {"identifier": "nobody@test.local", "reason": "UNKNOWN_ACCOUNT"}


def test_blocked_logins_are_noted_once_per_minute(app, client, shop):
    app.config["RATELIMIT_ENABLED"] = True
    app.config["AUTH_RATE_LIMIT_LOGIN"] = "2 per minute"
    for _ in range(5):
        client.post("/api/v1/auth/login", json={"identifier": "audit_office@test.local", "password": "bad"})
    assert len(_rows(action="LOGIN_BLOCKED")) == 1
    assert len(_rows(action="LOGIN_FAILED")) == 2


def test_logout_is_recorded(client, shop):
    res = client.post("/api/v1/auth/logout", headers=_headers(shop["worker"]))
    assert res.status_code == 200
    [row] = _rows(action="LOGOUT")
    assert row.user_id == shop["worker"].id


# --- what changed ---------------------------------------------------------------


def test_update_keeps_only_the_changed_fields_old_and_new(app, shop):
    job = _job(shop)
    job.due_date = date(2031, 4, 8)
    job.title = "Audit Shaft v2"
    db.session.commit()
    [row] = _rows(entity_type="JobOrder", entity_id=job.id, action="UPDATE")
    assert row.before_json == {"due_date": "2031-04-01", "title": "Audit Shaft"}
    assert row.after_json == {"due_date": "2031-04-08", "title": "Audit Shaft v2"}


def test_save_without_a_real_change_writes_nothing(app, shop):
    job = _job(shop)
    job.title = "Audit Shaft"  # same value
    db.session.commit()
    assert _rows(entity_type="JobOrder", entity_id=job.id, action="UPDATE") == []


def test_passwords_never_reach_the_log(app, shop):
    user = shop["office"]
    user.password_hash = bcrypt.generate_password_hash("N3w-Passw0rd!").decode("utf-8")
    db.session.commit()
    [row] = _rows(entity_type="User", entity_id=user.id, action="UPDATE")
    assert row.before_json == {"password_hash": "[hidden]"}
    assert row.after_json == {"password_hash": "[hidden]"}


def test_machines_and_helpers_are_covered(app, shop):
    unit = shop["unit"]
    unit.default_operator_id = shop["worker"].id
    db.session.commit()
    [row] = _rows(entity_type="MachineUnit", entity_id=unit.id, action="UPDATE")
    assert row.after_json == {"default_operator_id": shop["worker"].id}

    job = _job(shop)
    op = JobOperation(job_order_id=job.id, sequence_no=1, operation_name="Turning")
    db.session.add(op)
    db.session.flush()
    db.session.add(OperationHelper(operation_id=op.id, worker_id=shop["helper"].id, position=1))
    db.session.commit()
    [helper_row] = _rows(entity_type="OperationHelper", action="CREATE")
    assert helper_row.entity_id == op.id


# --- the Admin's screens ----------------------------------------------------------


def test_only_the_admin_can_read_the_log(client, shop):
    for who in ("office", "worker"):
        res = client.get("/api/v1/admin/audit-logs", headers=_headers(shop[who]))
        assert res.status_code == 403, who
    res = client.get("/api/v1/admin/audit-logs", headers=_headers(shop["admin"]))
    assert res.status_code == 200


def test_the_log_cannot_be_edited_or_deleted(client, shop):
    _job(shop)
    row = AuditLog.query.first()
    for method in (client.delete, client.patch, client.put):
        res = method(f"/api/v1/admin/audit-logs/{row.id}", headers=_headers(shop["admin"]), json={})
        assert res.status_code in (404, 405)
    assert db.session.get(AuditLog, row.id) is not None


def test_log_reads_as_sentences_with_old_and_new_values(client, shop):
    job = _job(shop)
    job.due_date = date(2031, 4, 8)
    db.session.commit()
    res = client.get(
        "/api/v1/admin/audit-logs",
        query_string={"entityId": job.id, "action": "UPDATE"},
        headers=_headers(shop["admin"]),
    )
    [item] = res.get_json()["items"]
    assert item["actionLabel"] == "Changed"
    assert item["entityLabel"] == "Job order"
    assert item["recordLabel"] == f"{job.job_number} · Audit Shaft"
    assert item["link"] == f"/job-orders/{job.id}"
    assert item["details"] == [{"label": "Due date", "from": "2031-04-01", "to": "2031-04-08"}]
    assert "changed due date on job order" in item["summary"]


def test_ids_in_changes_show_as_names(client, shop):
    unit = shop["unit"]
    unit.default_operator_id = shop["worker"].id
    db.session.commit()
    res = client.get(
        "/api/v1/admin/audit-logs",
        query_string={"entityType": "MachineUnit", "action": "UPDATE"},
        headers=_headers(shop["admin"]),
    )
    [item] = res.get_json()["items"]
    assert item["recordLabel"] == "Lathe A-1"
    assert item["details"] == [{"label": "Default operator", "from": None, "to": "Audit Worker"}]


def test_filters_category_user_search_and_dates(client, shop):
    client.post("/api/v1/auth/login", json={"identifier": "audit_office@test.local", "password": PASSWORD})
    job = _job(shop, title="Flange Plate")
    admin = _headers(shop["admin"])

    res = client.get("/api/v1/admin/audit-logs", query_string={"category": "SIGN_IN"}, headers=admin)
    actions = {i["action"] for i in res.get_json()["items"]}
    assert actions == {"LOGIN_SUCCEEDED"}

    res = client.get(
        "/api/v1/admin/audit-logs",
        query_string={"userId": shop["office"].id, "category": "SIGN_IN"},
        headers=admin,
    )
    assert res.get_json()["total"] == 1

    for q in (job.job_number, "flange"):
        res = client.get("/api/v1/admin/audit-logs", query_string={"q": q}, headers=admin)
        ids = {i["entityId"] for i in res.get_json()["items"]}
        assert job.id in ids, q

    today = datetime.now(timezone.utc).date()
    res = client.get(
        "/api/v1/admin/audit-logs",
        query_string={"from": (today + timedelta(days=5)).isoformat()},
        headers=admin,
    )
    assert res.get_json()["total"] == 0
    res = client.get(
        "/api/v1/admin/audit-logs",
        query_string={"from": "2031-05-02", "to": "2031-05-01"},
        headers=admin,
    )
    assert res.status_code == 400


def test_options_list_people_and_record_types(client, shop):
    client.post("/api/v1/auth/login", json={"identifier": "audit_office@test.local", "password": PASSWORD})
    res = client.get("/api/v1/admin/audit-logs/options", headers=_headers(shop["admin"]))
    data = res.get_json()
    assert {"id": shop["office"].id, "name": "Audit Office", "role": "OFFICE_STAFF"} in data["users"]
    assert {"value": "User", "label": "User account"} in data["entityTypes"]
    assert [c["value"] for c in data["categories"]] == ["SIGN_IN", "CHANGES", "ACTIONS"]


def test_job_history_covers_the_job_and_its_operations(client, shop):
    job = _job(shop)
    other = _job(shop, title="Someone Else's Job")
    op = JobOperation(job_order_id=job.id, sequence_no=1, operation_name="Turning")
    db.session.add(op)
    db.session.commit()
    op.assigned_worker_id = shop["worker"].id
    db.session.add(OperationHelper(operation_id=op.id, worker_id=shop["helper"].id, position=1))
    db.session.commit()

    res = client.get(f"/api/v1/admin/audit-logs/job-orders/{job.id}", headers=_headers(shop["admin"]))
    assert res.status_code == 200
    items = res.get_json()["items"]
    types = {i["entityType"] for i in items}
    assert {"JobOrder", "JobOperation", "OperationHelper"} <= types
    assert all(i["entityId"] != other.id for i in items)
    assign = next(i for i in items if i["entityType"] == "JobOperation" and i["action"] == "UPDATE")
    assert assign["details"] == [{"label": "Lead worker", "from": None, "to": "Audit Worker"}]
    assert assign["recordLabel"].endswith("Op 1 Turning")

    res = client.get(f"/api/v1/admin/audit-logs/job-orders/{job.id}", headers=_headers(shop["office"]))
    assert res.status_code == 403


def test_older_entries_and_system_changes_read_plainly(client, shop):
    job = _job(shop)
    db.session.add(
        AuditLog(
            action="UPDATE",
            entity_type="JobOrder",
            entity_id=job.id,
            before_json=None,
            after_json={"id": job.id, "title": "Audit Shaft", "status": "DRAFT"},
        )
    )
    db.session.commit()
    res = client.get(
        "/api/v1/admin/audit-logs",
        query_string={"entityId": job.id},
        headers=_headers(shop["admin"]),
    )
    items = res.get_json()["items"]
    legacy = next(i for i in items if i["action"] == "UPDATE")
    assert legacy["details"] == []
    assert "older entry" in legacy["summary"]
    created = next(i for i in items if i["action"] == "CREATE")
    assert created["user"] is None
    assert created["summary"].startswith("The system created job order")


def test_breakdown_entry_names_the_machine(client, shop):
    from app.models.operation_time import DowntimeCategory, MachineDowntime

    db.session.add(MachineDowntime(machine_unit_id=shop["unit"].id, category=DowntimeCategory.MECHANICAL_FAILURE, reason="Spindle noise",
                                   started_at=datetime(2031, 4, 1, 1, tzinfo=timezone.utc),
                                   reported_by_id=shop["admin"].id))
    db.session.commit()
    res = client.get(
        "/api/v1/admin/audit-logs",
        query_string={"entityType": "MachineDowntime"},
        headers=_headers(shop["admin"]),
    )
    [item] = res.get_json()["items"]
    assert item["recordLabel"] == "Lathe A-1"
    assert "Lathe A-1" in item["summary"]
