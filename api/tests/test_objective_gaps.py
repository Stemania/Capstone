"""Objective gaps: operation instructions, breakdowns per job, server-side scheduling
checks, editing user details, and audit rows for purchasing records.

Uses the bmsc_test database from conftest (schema built from the models).
"""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.extensions import bcrypt, db
from app.models.audit_log import AuditLog
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.machine import MachineType, MachineUnit
from app.models.operation import JobOperation, OperationStatus
from app.models.operation_time import DowntimeCategory, MachineDowntime
from app.models.user import User, UserRole, UserStatus
from app.models.user_security import UserDevice
from app.models.worker_profile import WorkerProfile
from app.models.worker_skill import WorkerSchedule, WorkerSkill

T0 = datetime(2031, 3, 10, 1, 0, tzinfo=timezone.utc)


def _user(email, role, name=None):
    user = User(
        email=email,
        password_hash=bcrypt.generate_password_hash("Passw0rd!").decode("utf-8"),
        full_name=name or email.split("@")[0],
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


def _headers(user):
    token = create_access_token(identity=user.id, additional_claims={"role": user.role.value})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def shop(app):
    admin = _user("gap_admin@test.local", UserRole.ADMIN, "Gap Admin")
    office = _user("gap_office@test.local", UserRole.OFFICE_STAFF, "Gap Office")
    worker = _user("gap_worker@test.local", UserRole.PRODUCTION_WORKER, "Gap Worker")
    other = _user("gap_other@test.local", UserRole.PRODUCTION_WORKER, "Gap Other")
    lathe = MachineType(code="LATHE", name="Lathe", units=2)
    db.session.add(lathe)
    db.session.flush()
    unit_a = MachineUnit(machine_type_id=lathe.id, label="Lathe A-1")
    unit_b = MachineUnit(machine_type_id=lathe.id, label="Lathe A-2")
    client_row = Client(name="Gap Client")
    db.session.add_all([unit_a, unit_b, client_row])
    db.session.add(WorkerSkill(worker_id=worker.id, machine_type_id=lathe.id, proficiency=4))
    db.session.commit()
    return {
        "admin": admin,
        "office": office,
        "worker": worker,
        "other": other,
        "lathe": lathe,
        "unit_a": unit_a,
        "unit_b": unit_b,
        "client": client_row,
    }


def _job(shop, status=JobOrderStatus.SCHEDULED, amount=None):
    job = JobOrder(
        client_id=shop["client"].id,
        title="Gap Job",
        due_date=date(2031, 4, 1),
        status=status,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        material_status=MaterialStatus.NOT_REQUIRED,
        amount=amount,
        created_by_id=shop["office"].id,
    )
    db.session.add(job)
    db.session.flush()
    return job


def _op(job, seq, name, *, worker=None, machine=None, unit=None, window=True, notes=None):
    op = JobOperation(
        job_order_id=job.id,
        sequence_no=seq,
        operation_name=name,
        machine_type_id=machine.id if machine else None,
        machine_unit_id=unit.id if unit else None,
        assigned_worker_id=worker.id if worker else None,
        estimated_hours=Decimal("2"),
        scheduled_start=T0 + timedelta(hours=3 * seq) if window else None,
        scheduled_end=T0 + timedelta(hours=3 * seq + 2) if window else None,
        status=OperationStatus.SCHEDULED if job.status != JobOrderStatus.DRAFT else OperationStatus.PENDING,
        notes=notes,
    )
    db.session.add(op)
    db.session.commit()
    return op


# 1. Per-operation instructions


def test_planning_saves_instructions_and_worker_sees_them(client, shop):
    job = _job(shop, status=JobOrderStatus.DRAFT)
    res = client.patch(
        f"/api/v1/job-orders/{job.id}",
        json={
            "operations": [
                {
                    "operationName": "Turning",
                    "machineTypeId": shop["lathe"].id,
                    "assignedWorkerId": shop["worker"].id,
                    "estimatedHours": 2,
                    "notes": "Hold Ø40 h7. Deburr all edges.",
                },
                {"operationName": "Checking", "estimatedHours": 1},
            ]
        },
        headers=_headers(shop["admin"]),
    )
    assert res.status_code == 200, res.get_json()
    ops = sorted(res.get_json()["operations"], key=lambda o: o["sequenceNo"])
    assert ops[0]["notes"] == "Hold Ø40 h7. Deburr all edges."
    assert ops[1]["notes"] is None

    job.status = JobOrderStatus.SCHEDULED
    db.session.commit()
    res = client.get(f"/api/v1/job-orders/{job.id}", headers=_headers(shop["worker"]))
    assert res.status_code == 200
    worker_ops = sorted(res.get_json()["operations"], key=lambda o: o["sequenceNo"])
    assert worker_ops[0]["notes"] == "Hold Ø40 h7. Deburr all edges."


# 2. Breakdowns per job order


def _report(client, user, unit, body):
    return client.post(
        f"/api/v1/operations/machine-units/{unit.id}/downtime",
        json=body,
        headers=_headers(user),
    )


def test_worker_breakdown_links_operation_and_job(client, shop):
    job = _job(shop)
    op = _op(job, 1, "Turning", worker=shop["worker"], machine=shop["lathe"], unit=shop["unit_a"])
    res = _report(
        client,
        shop["worker"],
        shop["unit_a"],
        {"category": "MECHANICAL_FAILURE", "operationId": op.id},
    )
    assert res.status_code == 201, res.get_json()
    body = res.get_json()
    assert body["category"] == "MECHANICAL_FAILURE"
    assert body["reason"] == "Mechanical failure"
    assert body["operationId"] == op.id
    assert body["jobOrderId"] == job.id
    assert body["operationName"] == "Turning"


def test_breakdowns_listed_on_their_job_only(client, shop):
    job = _job(shop)
    other_job = _job(shop)
    op = _op(job, 1, "Turning", worker=shop["worker"], machine=shop["lathe"], unit=shop["unit_a"])
    _report(client, shop["worker"], shop["unit_a"], {"category": "UNDER_REPAIR", "operationId": op.id})
    _report(client, shop["office"], shop["unit_b"], {"category": "ELECTRICAL_FAULT"})

    res = client.get(f"/api/v1/job-orders/{job.id}/breakdowns", headers=_headers(shop["office"]))
    assert res.status_code == 200
    rows = res.get_json()
    assert [r["category"] for r in rows] == ["UNDER_REPAIR"]
    assert rows[0]["machineUnitLabel"] == "Lathe A-1"

    res = client.get(
        f"/api/v1/job-orders/{other_job.id}/breakdowns", headers=_headers(shop["office"])
    )
    assert res.get_json() == []

    res = client.get(f"/api/v1/job-orders/{job.id}/breakdowns", headers=_headers(shop["worker"]))
    assert res.status_code == 403


@pytest.mark.parametrize(
    "body, code",
    [
        ({"category": "SPINDLE_ON_FIRE"}, "VALIDATION_ERROR"),
        ({}, "VALIDATION_ERROR"),
        ({"category": "OTHER"}, "VALIDATION_ERROR"),
    ],
)
def test_breakdown_category_is_server_validated(client, shop, body, code):
    res = _report(client, shop["office"], shop["unit_a"], body)
    assert res.status_code == 400
    assert res.get_json()["error"]["code"] == code
    assert MachineDowntime.query.count() == 0


def test_breakdown_accepts_label_and_other_with_note(client, shop):
    res = _report(client, shop["office"], shop["unit_a"], {"reason": "Waiting for parts"})
    assert res.status_code == 201
    assert res.get_json()["category"] == "WAITING_FOR_PARTS"

    res = _report(
        client, shop["office"], shop["unit_b"], {"category": "OTHER", "note": "Chuck key missing"}
    )
    assert res.status_code == 201
    row = db.session.get(MachineDowntime, res.get_json()["id"])
    assert row.category == DowntimeCategory.OTHER
    assert row.note == "Chuck key missing"


def test_worker_cannot_link_breakdown_to_someone_elses_operation(client, shop):
    job = _job(shop)
    op = _op(job, 1, "Turning", worker=shop["worker"], machine=shop["lathe"], unit=shop["unit_a"])
    res = _report(
        client, shop["other"], shop["unit_a"], {"category": "UNDER_REPAIR", "operationId": op.id}
    )
    assert res.status_code == 403
    assert MachineDowntime.query.count() == 0


def test_breakdown_operation_must_run_on_that_machine(client, shop):
    job = _job(shop)
    op = _op(job, 1, "Turning", worker=shop["worker"], machine=shop["lathe"], unit=shop["unit_a"])
    res = _report(
        client, shop["worker"], shop["unit_b"], {"category": "UNDER_REPAIR", "operationId": op.id}
    )
    assert res.status_code == 400
    assert MachineDowntime.query.count() == 0


# 3. Server-side scheduling checks


def _assign(client, shop, op, worker):
    return client.patch(
        f"/api/v1/operations/{op.id}/assign",
        json={"assignedWorkerId": worker.id},
        headers=_headers(shop["admin"]),
    )


def test_assign_refuses_worker_without_machine_skill(client, shop):
    job = _job(shop)
    op = _op(job, 1, "Turning", machine=shop["lathe"], window=False)
    res = _assign(client, shop, op, shop["other"])
    assert res.status_code == 400
    err = res.get_json()["error"]
    assert err["code"] == "WORKER_NOT_QUALIFIED"
    assert "Lathe" in err["message"]
    assert db.session.get(JobOperation, op.id).assigned_worker_id is None

    res = _assign(client, shop, op, shop["worker"])
    assert res.status_code == 200, res.get_json()


def test_operation_without_machine_type_needs_no_skill(client, shop):
    job = _job(shop)
    op = _op(job, 1, "Deburring", window=False)
    res = _assign(client, shop, op, shop["other"])
    assert res.status_code == 200, res.get_json()


def test_planning_refuses_unqualified_worker(client, shop):
    job = _job(shop, status=JobOrderStatus.DRAFT)
    res = client.patch(
        f"/api/v1/job-orders/{job.id}",
        json={
            "operations": [
                {
                    "operationName": "Turning",
                    "machineTypeId": shop["lathe"].id,
                    "assignedWorkerId": shop["other"].id,
                    "estimatedHours": 2,
                }
            ]
        },
        headers=_headers(shop["admin"]),
    )
    assert res.status_code == 400
    assert res.get_json()["error"]["code"] == "WORKER_NOT_QUALIFIED"


def test_confirm_refused_when_operations_have_no_window(client, shop):
    job = _job(shop, status=JobOrderStatus.DRAFT)
    _op(job, 1, "Turning", worker=shop["worker"], machine=shop["lathe"])
    _op(job, 2, "Facing", worker=shop["worker"], machine=shop["lathe"], window=False)
    _op(job, 3, "Threading", worker=shop["worker"], machine=shop["lathe"], window=False)
    res = client.post(
        f"/api/v1/job-orders/{job.id}/schedule/confirm", headers=_headers(shop["admin"])
    )
    assert res.status_code == 400
    err = res.get_json()["error"]
    assert err["code"] == "OPERATIONS_UNSCHEDULED"
    assert "#2 Facing" in err["message"]
    assert "#3 Threading" in err["message"]
    assert "Turning" not in err["message"]
    assert db.session.get(JobOrder, job.id).status == JobOrderStatus.DRAFT


def test_confirm_allowed_when_every_operation_is_scheduled(client, shop):
    job = _job(shop, status=JobOrderStatus.DRAFT)
    op = _op(job, 1, "Turning", worker=shop["worker"], machine=shop["lathe"])
    # T0 + 3h is 12:00 shop time, inside the daily break; start after it.
    op.scheduled_start = T0 + timedelta(hours=4)
    op.scheduled_end = T0 + timedelta(hours=6)
    db.session.commit()
    res = client.post(
        f"/api/v1/job-orders/{job.id}/schedule/confirm", headers=_headers(shop["admin"])
    )
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["status"] == "SCHEDULED"
    assert res.get_json()["operations"][0]["status"] == "SCHEDULED"
    # Worker actions timestamped before this are refused as a wrong phone clock.
    assert db.session.get(JobOrder, job.id).released_at is not None


def test_failed_confirm_saves_nothing(client, shop):
    job = _job(shop, status=JobOrderStatus.DRAFT)
    _op(job, 1, "Turning", worker=shop["worker"], machine=shop["lathe"])
    res = client.post(
        f"/api/v1/job-orders/{job.id}/schedule/confirm",
        json={"operations": [{"sequenceNo": 1, "operationName": "Drilling", "estimatedHours": 1}]},
        headers=_headers(shop["admin"]),
    )
    assert res.status_code == 400
    db.session.expire_all()
    job = db.session.get(JobOrder, job.id)
    assert job.status == JobOrderStatus.DRAFT
    assert [op.operation_name for op in job.operations] == ["Turning"]


def test_office_staff_cannot_confirm_schedule(client, shop):
    job = _job(shop, status=JobOrderStatus.DRAFT)
    _op(job, 1, "Turning", worker=shop["worker"], machine=shop["lathe"])
    res = client.post(
        f"/api/v1/job-orders/{job.id}/schedule/confirm", headers=_headers(shop["office"])
    )
    assert res.status_code == 403


# 4. Edit user details


def _device(user, device_id):
    row = UserDevice(
        user_id=user.id,
        device_id=device_id,
        pin_hash="hashed",
        pin_set_at=T0,
    )
    db.session.add(row)
    db.session.commit()
    return row


def test_admin_edits_name_email_mobile_without_revoking_pins(client, shop):
    worker = shop["worker"]
    device = _device(worker, "dev-1")
    res = client.patch(
        f"/api/v1/users/{worker.id}",
        json={
            "fullName": "Juan Dela Cruz",
            "email": "juan@test.local",
            "mobileNumber": "09171234567",
        },
        headers=_headers(shop["admin"]),
    )
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert body["fullName"] == "Juan Dela Cruz"
    assert body["email"] == "juan@test.local"
    assert body["mobileNumber"]
    assert db.session.get(UserDevice, device.id).revoked_at is None


def test_role_change_revokes_device_pins(client, shop):
    worker = shop["worker"]
    d1 = _device(worker, "dev-1")
    d2 = _device(worker, "dev-2")
    res = client.patch(
        f"/api/v1/users/{worker.id}",
        json={"role": "OFFICE_STAFF"},
        headers=_headers(shop["admin"]),
    )
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["role"] == "OFFICE_STAFF"
    for dev_id in (d1.id, d2.id):
        row = db.session.get(UserDevice, dev_id)
        assert row.revoked_at is not None
        assert row.pin_hash is None


def test_last_admin_role_cannot_be_changed(client, shop):
    admin = shop["admin"]
    device = _device(admin, "dev-admin")
    res = client.patch(
        f"/api/v1/users/{admin.id}",
        json={"role": "OFFICE_STAFF", "fullName": "Renamed"},
        headers=_headers(admin),
    )
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "LAST_ADMIN"
    db.session.expire_all()
    row = db.session.get(User, admin.id)
    assert row.role == UserRole.ADMIN
    assert row.full_name == "Gap Admin"
    assert db.session.get(UserDevice, device.id).revoked_at is None


def test_disabled_admin_does_not_count_as_remaining_admin(client, shop):
    spare = _user("gap_admin2@test.local", UserRole.ADMIN)
    spare.status = UserStatus.DISABLED
    spare.sync_active_flag()
    db.session.commit()
    res = client.patch(
        f"/api/v1/users/{shop['admin'].id}",
        json={"role": "OFFICE_STAFF"},
        headers=_headers(shop["admin"]),
    )
    assert res.status_code == 409


def test_admin_role_can_change_when_another_admin_exists(client, shop):
    _user("gap_admin2@test.local", UserRole.ADMIN)
    db.session.commit()
    res = client.patch(
        f"/api/v1/users/{shop['admin'].id}",
        json={"role": "OFFICE_STAFF"},
        headers=_headers(shop["admin"]),
    )
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["role"] == "OFFICE_STAFF"


# 5. Audit rows for purchasing records


def _audit_rows(entity_type, entity_id):
    return AuditLog.query.filter_by(entity_type=entity_type, entity_id=entity_id).all()


def test_supplier_purchase_and_invoice_write_audit_rows_with_actor(client, shop):
    from app.services.schedule_calendar import shop_now

    office = shop["office"]
    headers = _headers(office)

    res = client.post("/api/v1/suppliers", json={"name": "Audit Steel", "typicalLeadTimeDays": 3}, headers=headers)
    assert res.status_code == 201, res.get_json()
    supplier_id = res.get_json()["id"]

    job = _job(shop, status=JobOrderStatus.SCHEDULED, amount=Decimal("1500"))
    job.raw_materials = [{"name": "AISI 1045 round bar", "quantity": 2, "unit": "pcs"}]
    db.session.commit()
    res = client.post(
        f"/api/v1/job-orders/{job.id}/material-purchases",
        json={
            "plannedMaterialId": job.raw_materials[0]["id"],
            "supplierId": supplier_id,
            "quantity": 2,
            "unit": "pcs",
            "unitCost": 450,
            "dateOrdered": "2031-03-01",
        },
        headers=headers,
    )
    assert res.status_code == 201, res.get_json()
    purchase_id = res.get_json()["id"]
    job.status = JobOrderStatus.COMPLETED
    db.session.commit()

    res = client.post(
        f"/api/v1/job-orders/{job.id}/invoice",
        json={"invoiceNumber": "OR-2031-0001", "invoiceDate": shop_now().date().isoformat()},
        headers=headers,
    )
    assert res.status_code == 201, res.get_json()
    invoice_id = res.get_json()["id"]

    for entity_type, entity_id in (
        ("Supplier", supplier_id),
        ("MaterialPurchase", purchase_id),
        ("SalesInvoice", invoice_id),
    ):
        rows = _audit_rows(entity_type, entity_id)
        creates = [r for r in rows if r.action == "CREATE"]
        assert creates, f"no CREATE audit row for {entity_type}"
        assert all(r.user_id == office.id for r in rows), entity_type
        assert all(r.user_role == UserRole.OFFICE_STAFF.value for r in rows), entity_type
        assert creates[0].after_json["id"] == entity_id
