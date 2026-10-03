"""'Waiting for materials': computed on jobs, operations and the schedule board.

Uses the bmsc_test database from conftest (schema built from the models).
"""

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.material_purchase import MaterialPurchase
from app.models.operation import JobOperation, OperationStatus
from app.models.supplier import Supplier
from app.models.user import User, UserRole, UserStatus


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
    return user


def _headers(user):
    token = create_access_token(identity=user.id, additional_claims={"role": user.role.value})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def shop(app):
    admin = _user("mw_admin@test.local", UserRole.ADMIN)
    office = _user("mw_office@test.local", UserRole.OFFICE_STAFF)
    worker = _user("mw_worker@test.local", UserRole.PRODUCTION_WORKER)
    client_row = Client(name="Wait Client")
    supplier = Supplier(name="Wait Steel", typical_lead_time_days=3)
    db.session.add_all([client_row, supplier])
    db.session.commit()
    return {
        "admin": admin,
        "office": office,
        "worker": worker,
        "client": client_row,
        "supplier": supplier,
    }


def _job(shop, *, status=JobOrderStatus.SCHEDULED, material=MaterialStatus.ORDERED):
    job = JobOrder(
        client_id=shop["client"].id,
        title="Wait Job",
        due_date=date(2031, 6, 1),
        status=status,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        material_status=material,
        created_by_id=shop["office"].id,
    )
    db.session.add(job)
    db.session.flush()
    op = JobOperation(
        job_order_id=job.id,
        sequence_no=1,
        operation_name="Cutting",
        estimated_hours=Decimal("2"),
        status=OperationStatus.SCHEDULED,
        assigned_worker_id=shop["worker"].id,
        scheduled_start=datetime(2031, 3, 10, 1, 0, tzinfo=timezone.utc),
        scheduled_end=datetime(2031, 3, 10, 3, 0, tzinfo=timezone.utc),
    )
    db.session.add(op)
    db.session.commit()
    return job, op


def _line(job, supplier, received=None):
    p = MaterialPurchase(
        job_order_id=job.id,
        material_name="Plate",
        quantity=Decimal("1"),
        unit="pcs",
        unit_cost=Decimal("100"),
        supplier_id=supplier.id,
        date_ordered=date(2031, 3, 1),
        date_received=received,
    )
    db.session.add(p)
    db.session.commit()
    return p


def test_unreceived_material_shows_waiting_everywhere_and_blocks_start(client, shop):
    job, op = _job(shop)
    line = _line(job, shop["supplier"])
    staff = _headers(shop["admin"])
    worker = _headers(shop["worker"])

    listed = next(
        j for j in client.get("/api/v1/job-orders", headers=staff).get_json() if j["id"] == job.id
    )
    assert listed["waitingForMaterials"] is True
    assert listed["materialWaitCode"] == "MATERIALS_NOT_RECEIVED"
    assert "Plate" in listed["materialWaitReason"]

    detail = client.get(f"/api/v1/job-orders/{job.id}", headers=worker).get_json()
    assert detail["waitingForMaterials"] is True
    assert "have not arrived yet" in detail["materialWaitReason"]
    assert "Plate" not in detail["materialWaitReason"]

    mine = client.get("/api/v1/operations/mine", headers=worker).get_json()
    assert next(o for o in mine if o["id"] == op.id)["waitingForMaterials"] is True

    board = client.get(
        "/api/v1/schedule/board?from=2031-03-09&to=2031-03-11", headers=staff
    ).get_json()
    row = next(o for o in board["operations"] if o["id"] == op.id)
    assert row["waitingForMaterials"] is True
    assert row["materialWaitCode"] == "MATERIALS_NOT_RECEIVED"

    res = client.post(f"/api/v1/operations/{op.id}/start", json={}, headers=worker)
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "MATERIALS_NOT_RECEIVED"

    line.date_received = date(2031, 3, 4)
    db.session.commit()
    detail = client.get(f"/api/v1/job-orders/{job.id}", headers=staff).get_json()
    assert detail["waitingForMaterials"] is False
    assert detail["materialWaitReason"] is None


def test_unordered_material_reports_not_ordered(client, shop):
    job, _ = _job(shop, material=MaterialStatus.TO_ORDER)
    body = client.get(f"/api/v1/job-orders/{job.id}", headers=_headers(shop["admin"])).get_json()
    assert body["waitingForMaterials"] is True
    assert body["materialWaitCode"] == "MATERIALS_NOT_ORDERED"


def test_not_required_pending_and_started_jobs_are_not_waiting(client, shop):
    headers = _headers(shop["admin"])

    not_required, _ = _job(shop, material=MaterialStatus.NOT_REQUIRED)
    body = client.get(f"/api/v1/job-orders/{not_required.id}", headers=headers).get_json()
    assert body["waitingForMaterials"] is False

    pending, _ = _job(shop, status=JobOrderStatus.DRAFT, material=MaterialStatus.TO_ORDER)
    body = client.get(f"/api/v1/job-orders/{pending.id}", headers=headers).get_json()
    assert body["waitingForMaterials"] is False

    started, op = _job(shop, status=JobOrderStatus.IN_PROGRESS)
    _line(started, shop["supplier"])
    op.actual_start = datetime(2031, 3, 10, 1, 0, tzinfo=timezone.utc)
    op.status = OperationStatus.IN_PROGRESS
    db.session.commit()
    body = client.get(f"/api/v1/job-orders/{started.id}", headers=headers).get_json()
    assert body["waitingForMaterials"] is False
