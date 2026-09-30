"""Office records purchases on drafts; scheduling waits for the purchase lines.

Uses the bmsc_test database from conftest (schema built from the models).
"""

from datetime import date, datetime
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
from app.services.schedule_calendar import utc_to_shop


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
    admin = _user("rd_admin@test.local", UserRole.ADMIN)
    office = _user("rd_office@test.local", UserRole.OFFICE_STAFF)
    client_row = Client(name="Readiness Client")
    fast = Supplier(name="Fast Steel", typical_lead_time_days=3)
    slow = Supplier(name="Slow Alloys", typical_lead_time_days=7)
    unknown = Supplier(name="No Lead Co")
    db.session.add_all([client_row, fast, slow, unknown])
    db.session.commit()
    return {
        "admin": admin,
        "office": office,
        "client": client_row,
        "fast": fast,
        "slow": slow,
        "unknown": unknown,
    }


def _draft(shop, *, expected=None):
    job = JobOrder(
        client_id=shop["client"].id,
        title="Readiness Job",
        due_date=date(2031, 6, 1),
        status=JobOrderStatus.DRAFT,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        material_status=MaterialStatus.TO_ORDER,
        material_expected_date=expected,
        created_by_id=shop["office"].id,
    )
    db.session.add(job)
    db.session.flush()
    db.session.add(
        JobOperation(
            job_order_id=job.id,
            sequence_no=1,
            operation_name="Cutting",
            estimated_hours=Decimal("2"),
            status=OperationStatus.PENDING,
        )
    )
    db.session.commit()
    return job


def _line(job, supplier, ordered, received=None, name="Plate"):
    p = MaterialPurchase(
        job_order_id=job.id,
        material_name=name,
        quantity=Decimal("1"),
        unit="pcs",
        unit_cost=Decimal("100"),
        supplier_id=supplier.id,
        date_ordered=ordered,
        date_received=received,
    )
    db.session.add(p)
    db.session.commit()
    return p


def test_office_opens_draft_detail_and_records_purchase(client, shop):
    job = _draft(shop)
    headers = _headers(shop["office"])

    res = client.get(f"/api/v1/job-orders/{job.id}", headers=headers)
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["status"] == "DRAFT"

    res = client.post(
        f"/api/v1/job-orders/{job.id}/material-purchases",
        json={
            "materialName": "A36 plate 10mm",
            "supplierId": shop["fast"].id,
            "quantity": 2,
            "unit": "pcs",
            "unitCost": 850,
            "dateOrdered": "2031-03-02",
        },
        headers=headers,
    )
    assert res.status_code == 201, res.get_json()
    order_id = res.get_json()["supplierOrderId"]
    assert res.get_json()["status"] == "DRAFT"

    # On a draft PO the material is not ordered yet.
    body = client.get(f"/api/v1/job-orders/{job.id}", headers=headers).get_json()
    assert body["materialStatus"] == "TO_ORDER"

    res = client.post(
        f"/api/v1/supplier-orders/{order_id}/issue",
        json={"dateIssued": "2031-03-02"},
        headers=_headers(shop["admin"]),
    )
    assert res.status_code == 200, res.get_json()

    body = client.get(f"/api/v1/job-orders/{job.id}", headers=headers).get_json()
    assert body["status"] == "DRAFT"
    assert body["materialStatus"] == "ORDERED"
    assert body["materialReadiness"]["source"] == "PURCHASE_LINES"
    assert body["materialReadiness"]["expectedDate"] == "2031-03-05"


def test_derived_expected_date_is_latest_outstanding_line(client, shop):
    job = _draft(shop, expected=date(2031, 3, 1))
    _line(job, shop["fast"], date(2031, 3, 1), name="Flat bar")  # 03-04
    slow = _line(job, shop["slow"], date(2031, 3, 2), name="Alloy rod")  # 03-09
    _line(job, shop["fast"], date(2031, 2, 20), received=date(2031, 3, 5), name="Bolts")

    body = client.get(
        f"/api/v1/job-orders/{job.id}", headers=_headers(shop["admin"])
    ).get_json()
    readiness = body["materialReadiness"]
    assert readiness["expectedDate"] == "2031-03-09"
    assert readiness["limitingLine"]["purchaseId"] == slow.id
    assert readiness["limitingLine"]["basis"] == "LEAD_TIME"
    assert {l["basis"] for l in readiness["lines"]} == {"LEAD_TIME", "RECEIVED"}

    res = client.post(
        f"/api/v1/job-orders/{job.id}/schedule/propose",
        json={},
        headers=_headers(shop["admin"]),
    )
    assert res.status_code == 200, res.get_json()
    data = res.get_json()
    not_before = utc_to_shop(datetime.fromisoformat(data["materialNotBefore"]))
    assert not_before.date() == date(2031, 3, 9)
    assert "Alloy rod from Slow Alloys" in data["materialConstraintReason"]


def test_received_line_uses_actual_received_date(client, shop):
    job = _draft(shop)
    _line(job, shop["fast"], date(2031, 3, 1))  # expected 03-04
    _line(job, shop["fast"], date(2031, 3, 1), received=date(2031, 3, 12), name="Late")

    body = client.get(
        f"/api/v1/job-orders/{job.id}", headers=_headers(shop["admin"])
    ).get_json()
    assert body["materialReadiness"]["expectedDate"] == "2031-03-12"
    assert body["materialReadiness"]["limitingLine"]["basis"] == "RECEIVED"


def test_supplier_without_lead_time_leaves_date_unknown_and_blocks_proposal(client, shop):
    job = _draft(shop)
    _line(job, shop["fast"], date(2031, 3, 1))
    _line(job, shop["unknown"], date(2031, 3, 6), name="Brass")
    headers = _headers(shop["admin"])

    readiness = client.get(f"/api/v1/job-orders/{job.id}", headers=headers).get_json()[
        "materialReadiness"
    ]
    assert readiness["expectedDate"] is None
    assert readiness["missingLeadTimeSuppliers"] == ["No Lead Co"]
    brass = next(l for l in readiness["lines"] if l["materialName"] == "Brass")
    assert brass["basis"] == "UNKNOWN" and brass["expectedArrival"] is None

    res = client.post(f"/api/v1/job-orders/{job.id}/schedule/propose", json={}, headers=headers)
    assert res.status_code == 400
    err = res.get_json()["error"]
    assert err["code"] == "MATERIAL_DATE_UNKNOWN"
    assert "No Lead Co" in err["message"]


def test_typed_date_covers_supplier_without_lead_time(client, shop):
    job = _draft(shop)
    _line(job, shop["fast"], date(2031, 3, 1))  # 03-04
    _line(job, shop["unknown"], date(2031, 3, 6), name="Brass")
    headers = _headers(shop["admin"])

    res = client.patch(
        f"/api/v1/job-orders/{job.id}",
        json={"materialExpectedDate": "2031-03-11"},
        headers=headers,
    )
    assert res.status_code == 200, res.get_json()
    readiness = res.get_json()["materialReadiness"]
    assert readiness["expectedDate"] == "2031-03-11"
    assert readiness["limitingLine"]["basis"] == "TYPED_DATE"

    res = client.post(f"/api/v1/job-orders/{job.id}/schedule/propose", json={}, headers=headers)
    assert res.status_code == 200, res.get_json()
    not_before = utc_to_shop(datetime.fromisoformat(res.get_json()["materialNotBefore"]))
    assert not_before.date() == date(2031, 3, 11)


def test_supplier_lead_time_is_required(client, shop):
    headers = _headers(shop["office"])
    res = client.post("/api/v1/suppliers", json={"name": "Nameless Lead"}, headers=headers)
    assert res.status_code == 400
    res = client.post(
        "/api/v1/suppliers", json={"name": "Blank Lead", "typicalLeadTimeDays": ""}, headers=headers
    )
    assert res.status_code == 400

    res = client.patch(
        f"/api/v1/suppliers/{shop['fast'].id}",
        json={"typicalLeadTimeDays": None},
        headers=headers,
    )
    assert res.status_code == 400
    # A legacy supplier without one must get one before any edit saves.
    res = client.patch(
        f"/api/v1/suppliers/{shop['unknown'].id}", json={"phone": "0917"}, headers=headers
    )
    assert res.status_code == 400
    res = client.patch(
        f"/api/v1/suppliers/{shop['unknown'].id}",
        json={"typicalLeadTimeDays": 4},
        headers=headers,
    )
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["typicalLeadTimeDays"] == 4
    db.session.expire_all()
    assert Supplier.query.get(shop["fast"].id).typical_lead_time_days == 3


def test_typed_expected_date_used_when_no_lines(client, shop):
    job = _draft(shop, expected=date(2031, 3, 20))
    readiness = client.get(
        f"/api/v1/job-orders/{job.id}", headers=_headers(shop["admin"])
    ).get_json()["materialReadiness"]
    assert readiness["source"] == "JOB"
    assert readiness["expectedDate"] == "2031-03-20"
