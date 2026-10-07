"""Consolidated supplier purchase orders: lines from several jobs on one PO.

Uses the bmsc_test database from conftest (schema built from the models).
"""

from datetime import date
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.material_purchase import MaterialPurchase
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


def _job(shop, title, raw_materials):
    job = JobOrder(
        client_id=shop["client"].id,
        title=title,
        due_date=date(2031, 6, 1),
        status=JobOrderStatus.DRAFT,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        material_status=MaterialStatus.TO_ORDER,
        raw_materials=raw_materials,
        created_by_id=shop["office"].id,
    )
    db.session.add(job)
    db.session.commit()
    return job


@pytest.fixture
def shop(app):
    admin = _user("so_admin@test.local", UserRole.ADMIN)
    office = _user("so_office@test.local", UserRole.OFFICE_STAFF)
    client_row = Client(name="PO Client")
    steel = Supplier(name="PO Steel", typical_lead_time_days=5, address="1 Mill Rd")
    other = Supplier(name="Other Metals", typical_lead_time_days=2)
    db.session.add_all([client_row, steel, other])
    db.session.commit()
    s = {"admin": admin, "office": office, "client": client_row, "steel": steel, "other": other}
    s["job_a"] = _job(s, "Shaft A", [{"name": "Round bar 50mm", "quantity": 4, "unit": "pcs"}])
    s["job_b"] = _job(s, "Shaft B", [{"name": "Round bar 50mm", "quantity": 6, "unit": "pcs"}])
    return s


def _planned_id(job):
    return job.raw_materials[0]["id"]


def _plan(job, name, quantity, unit="pcs"):
    """Add a planned material to the job; only planned materials can be ordered."""
    job.raw_materials = [*(job.raw_materials or []), {"name": name, "quantity": quantity, "unit": unit}]
    db.session.commit()
    return job.raw_materials[-1]["id"]


def _add_lines(client, shop, lines, supplier=None, user=None):
    return client.post(
        "/api/v1/supplier-orders/draft-lines",
        json={"supplierId": (supplier or shop["steel"]).id, "lines": lines},
        headers=_headers(user or shop["office"]),
    )


def _both_jobs_draft(client, shop):
    res = _add_lines(
        client,
        shop,
        [
            {
                "jobOrderId": shop["job_a"].id,
                "plannedMaterialId": _planned_id(shop["job_a"]),
                "quantity": 4,
                "unitCost": 250,
                "gradeOrSpec": "AISI 1045",
            },
            {
                "jobOrderId": shop["job_b"].id,
                "plannedMaterialId": _planned_id(shop["job_b"]),
                "quantity": 6,
                "unitCost": 250,
                "gradeOrSpec": "aisi 1045",
            },
        ],
    )
    assert res.status_code == 200, res.get_json()
    return res.get_json()


def _issue(client, shop, order_id, user=None, when="2031-03-02"):
    return client.post(
        f"/api/v1/supplier-orders/{order_id}/issue",
        json={"dateIssued": when},
        headers=_headers(user or shop["office"]),
    )


def _job_body(client, shop, job):
    return client.get(f"/api/v1/job-orders/{job.id}", headers=_headers(shop["admin"])).get_json()


def test_lines_from_two_jobs_on_one_order(client, shop):
    order = _both_jobs_draft(client, shop)
    assert order["status"] == "DRAFT"
    assert order["poNumber"] is None
    assert order["lineCount"] == 2 and order["jobCount"] == 2
    assert {ln["jobOrderId"] for ln in order["lines"]} == {shop["job_a"].id, shop["job_b"].id}

    # "Order materials" from a job's page lands on the same open draft.
    res = client.post(
        f"/api/v1/job-orders/{shop['job_a'].id}/material-purchases",
        json={
            "supplierId": shop["steel"].id,
            "plannedMaterialId": _plan(shop["job_a"], "Cutting disc", 2),
            "quantity": 2,
            "unitCost": 40,
        },
        headers=_headers(shop["office"]),
    )
    assert res.status_code == 201, res.get_json()
    assert res.get_json()["supplierOrderId"] == order["id"]

    # A different supplier gets its own draft.
    bolts = _plan(shop["job_a"], "Bolts", 1)
    other = _add_lines(
        client,
        shop,
        [{"jobOrderId": shop["job_a"].id, "plannedMaterialId": bolts, "quantity": 1, "unitCost": 5}],
        supplier=shop["other"],
    ).get_json()
    assert other["id"] != order["id"]

    # Every line's supplier matches its order's supplier.
    for ln in MaterialPurchase.query.filter(MaterialPurchase.supplier_order_id.isnot(None)):
        assert ln.supplier_id == ln.supplier_order.supplier_id

    # Draft lines do not count as ordered.
    assert _job_body(client, shop, shop["job_a"])["materialStatus"] == "TO_ORDER"


def test_issuing_assigns_number_and_locks_lines(client, shop):
    order = _both_jobs_draft(client, shop)
    line_id = order["lines"][0]["id"]

    res = _issue(client, shop, order["id"], user=shop["admin"])
    assert res.status_code == 403

    res = _issue(client, shop, order["id"])
    assert res.status_code == 200, res.get_json()
    issued = res.get_json()
    assert issued["status"] == "ISSUED"
    assert issued["poNumber"] == "BMSC-PO-00001"
    assert issued["dateIssued"] == "2031-03-02"
    assert issued["expectedDeliveryDate"] == "2031-03-07"
    assert issued["issuedById"] == shop["office"].id
    assert issued["preparedById"] == shop["office"].id
    assert all(ln["dateOrdered"] == "2031-03-02" for ln in issued["lines"])

    headers = _headers(shop["office"])
    res = client.patch(
        f"/api/v1/supplier-orders/{order['id']}/lines/{line_id}", json={"quantity": 1}, headers=headers
    )
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "ORDER_LOCKED"
    res = client.delete(f"/api/v1/supplier-orders/{order['id']}/lines/{line_id}", headers=headers)
    assert res.status_code == 409
    res = client.patch(
        f"/api/v1/job-orders/{shop['job_a'].id}/material-purchases/{line_id}",
        json={"quantity": 1},
        headers=headers,
    )
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "ON_SUPPLIER_ORDER"

    body = _job_body(client, shop, shop["job_a"])
    assert body["materialStatus"] == "ORDERED"
    assert body["materialReadiness"]["expectedDate"] == "2031-03-07"

    # Next PO takes the next number.
    bolts = _plan(shop["job_a"], "Bolts", 1)
    nxt = _add_lines(
        client,
        shop,
        [{"jobOrderId": shop["job_a"].id, "plannedMaterialId": bolts, "quantity": 1, "unitCost": 5}],
    ).get_json()
    assert nxt["id"] != order["id"]
    assert _issue(client, shop, nxt["id"]).get_json()["poNumber"] == "BMSC-PO-00002"


def test_cancelling_a_line_returns_material_to_order(client, shop):
    order = _both_jobs_draft(client, shop)
    _issue(client, shop, order["id"])
    line_a = next(ln for ln in order["lines"] if ln["jobOrderId"] == shop["job_a"].id)

    assert _job_body(client, shop, shop["job_a"])["plannedMaterials"][0]["status"] == "PURCHASED"

    res = client.post(
        f"/api/v1/supplier-orders/{order['id']}/lines/{line_a['id']}/cancel",
        headers=_headers(shop["office"]),
    )
    assert res.status_code == 200, res.get_json()
    after = res.get_json()
    assert after["status"] == "ISSUED"
    assert after["lineCount"] == 1

    body = _job_body(client, shop, shop["job_a"])
    planned = body["plannedMaterials"][0]
    assert planned["status"] == "TO_ORDER"
    assert planned["remainingQuantity"] == 4
    assert body["materialStatus"] == "TO_ORDER"

    outstanding = client.get(
        "/api/v1/supplier-orders/outstanding", headers=_headers(shop["office"])
    ).get_json()["materials"]
    assert [m["jobOrderId"] for m in outstanding] == [shop["job_a"].id]
    # Job B's line is untouched.
    assert _job_body(client, shop, shop["job_b"])["materialStatus"] == "ORDERED"


def test_receiving_every_line_closes_the_order(client, shop):
    order = _both_jobs_draft(client, shop)
    _issue(client, shop, order["id"])
    line_a, line_b = order["lines"]
    headers = _headers(shop["office"])

    # Partial delivery: split line B, receive part of it.
    res = client.post(
        f"/api/v1/supplier-orders/{order['id']}/lines/{line_b['id']}/split",
        json={"quantity": 2},
        headers=headers,
    )
    assert res.status_code == 200, res.get_json()
    lines = res.get_json()["lines"]
    assert len(lines) == 3
    rest = next(ln for ln in lines if ln["id"] not in (line_a["id"], line_b["id"]))
    assert rest["quantity"] == 4

    res = client.post(
        f"/api/v1/supplier-orders/{order['id']}/receive",
        json={"lineIds": [line_a["id"], line_b["id"]], "receivedDate": "2031-03-06"},
        headers=headers,
    )
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["status"] == "PARTIALLY_RECEIVED"
    assert _job_body(client, shop, shop["job_a"])["materialStatus"] == "RECEIVED"
    assert _job_body(client, shop, shop["job_b"])["materialStatus"] == "ORDERED"

    res = client.post(
        f"/api/v1/supplier-orders/{order['id']}/receive",
        json={"lineIds": [rest["id"]], "receivedDate": "2031-03-09"},
        headers=headers,
    )
    assert res.status_code == 200, res.get_json()
    closed = res.get_json()
    assert closed["status"] == "RECEIVED"
    assert closed["receivedDate"] == "2031-03-09"
    job_b = _job_body(client, shop, shop["job_b"])
    assert job_b["materialStatus"] == "RECEIVED"
    assert job_b["materialReceivedDate"] == "2031-03-09"

    # Lead time is measured per order: issued 03-02, received 03-09 = 7 days.
    res = client.get(
        "/api/v1/analytics/purchasing?from=2031-03-01&to=2031-03-31",
        headers=_headers(shop["admin"]),
    )
    assert res.status_code == 200, res.get_json()
    lead = next(
        r for r in res.get_json()["supplierLeadTime"] if r["supplierId"] == shop["steel"].id
    )
    assert lead["sampleCount"] == 1
    assert lead["averageActualDays"] == 7


def test_printout_combines_same_material_lines(client, shop):
    order = _both_jobs_draft(client, shop)
    _add_lines(
        client,
        shop,
        [
            {
                "jobOrderId": shop["job_b"].id,
                "plannedMaterialId": _plan(shop["job_b"], "Plate 10mm", 1),
                "quantity": 1,
                "unitCost": 900,
            }
        ],
    )
    client.patch(
        f"/api/v1/supplier-orders/{order['id']}",
        json={"vatRate": 12},
        headers=_headers(shop["office"]),
    )
    _issue(client, shop, order["id"])

    res = client.get(
        f"/api/v1/supplier-orders/{order['id']}/print", headers=_headers(shop["office"])
    )
    assert res.status_code == 200, res.get_json()
    data = res.get_json()
    assert data["order"]["poNumber"] == "BMSC-PO-00001"
    assert data["supplier"]["address"] == "1 Mill Rd"
    assert len(data["rows"]) == 2
    bar = next(r for r in data["rows"] if r["materialName"] == "Round bar 50mm")
    assert bar["quantity"] == 10
    assert bar["lineCount"] == 2
    assert sorted(bar["jobNumbers"]) == sorted([shop["job_a"].job_number, shop["job_b"].job_number])
    assert bar["amount"] == 2500
    assert data["subtotal"] == 3400
    assert data["vatAmount"] == 408
    assert data["total"] == 3808

    # The system keeps one line per job.
    detail = client.get(
        f"/api/v1/supplier-orders/{order['id']}", headers=_headers(shop["office"])
    ).get_json()
    assert len(detail["lines"]) == 3


def test_draft_and_cancelled_lines_do_not_count_as_ordered(client, shop):
    from app.models.operation import JobOperation, OperationStatus
    from app.models.user import UserRole as Role
    from app.services import operation_service
    from app.utils.errors import AppError

    job = shop["job_a"]
    job.status = JobOrderStatus.SCHEDULED
    op = JobOperation(
        job_order_id=job.id,
        sequence_no=1,
        operation_name="Turning",
        estimated_hours=Decimal("1"),
        status=OperationStatus.SCHEDULED,
        assigned_worker_id=shop["admin"].id,
    )
    db.session.add(op)
    db.session.commit()
    order = _both_jobs_draft(client, shop)
    headers = _headers(shop["admin"])

    # Draft: no date ordered, status DRAFT, still to order, no expected date.
    line_a = next(ln for ln in order["lines"] if ln["jobOrderId"] == job.id)
    assert line_a["dateOrdered"] is None and line_a["status"] == "DRAFT"
    body = _job_body(client, shop, job)
    assert body["materialStatus"] == "TO_ORDER"
    assert body["materialReadiness"]["source"] != "PURCHASE_LINES"
    assert body["materialReadiness"]["expectedDate"] is None
    assert not body["materialReadiness"].get("lines")
    assert body["plannedMaterials"][0]["purchasedQuantity"] == 0
    db.session.expire_all()
    with pytest.raises(AppError) as exc:
        operation_service.start_operation(
            JobOperation.query.get(op.id), shop["admin"].id, Role.ADMIN.value, None
        )
    assert exc.value.code == "MATERIALS_NOT_ORDERED"

    # Inventory and analytics leave draft lines out without erroring on the empty date.
    inv = client.get(
        "/api/v1/inventory/material-purchases?from=2031-01-01&to=2031-12-31", headers=headers
    )
    assert inv.status_code == 200, inv.get_json()
    assert inv.get_json()["summary"]["purchaseCount"] == 0
    assert client.get("/api/v1/inventory/material-purchases", headers=headers).status_code == 200
    ana = client.get("/api/v1/analytics/purchasing?from=2031-01-01&to=2031-12-31", headers=headers)
    assert ana.status_code == 200 and ana.get_json()["purchaseCount"] == 0

    # Issue, then cancel job A's line: it leaves spend, analytics and the gate.
    _issue(client, shop, order["id"])
    res = client.post(
        f"/api/v1/supplier-orders/{order['id']}/lines/{line_a['id']}/cancel",
        headers=_headers(shop["office"]),
    )
    assert res.status_code == 200, res.get_json()
    inv = client.get(
        "/api/v1/inventory/material-purchases?from=2031-01-01&to=2031-12-31", headers=headers
    ).get_json()
    assert inv["summary"]["purchaseCount"] == 1
    assert inv["summary"]["totalSpend"] == 1500
    ana = client.get(
        "/api/v1/analytics/purchasing?from=2031-01-01&to=2031-12-31", headers=headers
    ).get_json()
    assert ana["purchaseCount"] == 1 and ana["totalSpend"] == 1500
    detail = client.get(f"/api/v1/supplier-orders/{order['id']}", headers=headers).get_json()
    assert detail["subtotal"] == 1500 and detail["lineCount"] == 1
    db.session.expire_all()
    with pytest.raises(AppError) as exc:
        operation_service.start_operation(
            JobOperation.query.get(op.id), shop["admin"].id, Role.ADMIN.value, None
        )
    assert exc.value.code == "MATERIALS_NOT_ORDERED"


def test_existing_lines_stay_without_a_po(client, shop):
    legacy = MaterialPurchase(
        job_order_id=shop["job_a"].id,
        material_name="Old stock",
        quantity=Decimal("1"),
        unit="pcs",
        unit_cost=Decimal("10"),
        supplier_id=shop["steel"].id,
        date_ordered=date(2031, 1, 5),
    )
    db.session.add(legacy)
    db.session.commit()
    body = client.get(
        f"/api/v1/job-orders/{shop['job_a'].id}/material-purchases",
        headers=_headers(shop["office"]),
    ).get_json()
    assert body[0]["supplierOrderId"] is None and body[0]["poNumber"] is None
    assert body[0]["status"] == "ORDERED"
    # Still editable, since it is not on a PO.
    res = client.patch(
        f"/api/v1/job-orders/{shop['job_a'].id}/material-purchases/{legacy.id}",
        json={"quantity": 2},
        headers=_headers(shop["office"]),
    )
    assert res.status_code == 200, res.get_json()


@pytest.fixture
def one_day(shop):
    supplier = Supplier(name="Next Day Steel", typical_lead_time_days=1)
    db.session.add(supplier)
    db.session.commit()
    return supplier


def _one_line_order(client, shop, supplier, issued):
    order = _add_lines(
        client,
        shop,
        [{"jobOrderId": shop["job_a"].id, "plannedMaterialId": _planned_id(shop["job_a"]), "quantity": 4}],
        supplier=supplier,
    ).get_json()
    res = _issue(client, shop, order["id"], when=issued)
    assert res.status_code == 200, res.get_json()
    return res.get_json()


def test_saturday_order_from_one_day_supplier_is_promised_for_monday(client, shop, one_day):
    from app.services.supplier_reliability_service import supplier_reliability

    order = _one_line_order(client, shop, one_day, "2031-03-01")  # Saturday
    assert order["expectedDeliveryDate"] == "2031-03-03"  # Monday, not Sunday

    res = client.post(
        f"/api/v1/supplier-orders/{order['id']}/receive",
        json={"lineIds": [order["lines"][0]["id"]], "receivedDate": "2031-03-03"},
        headers=_headers(shop["office"]),
    )
    assert res.status_code == 200, res.get_json()
    row = next(r for r in supplier_reliability(today=date(2031, 3, 10)) if r["supplierId"] == one_day.id)
    assert row["dueDeliveries"] == 1 and row["onTimeDeliveries"] == 1 and row["lateDeliveries"] == 0


def test_promised_date_skips_shop_holidays(client, shop, one_day):
    from app.models.worker_skill import CalendarExceptionType, WorkCalendarException

    db.session.add(
        WorkCalendarException(date=date(2031, 3, 3), type=CalendarExceptionType.HOLIDAY_NO_WORK)
    )
    db.session.commit()
    order = _one_line_order(client, shop, one_day, "2031-03-01")
    assert order["expectedDeliveryDate"] == "2031-03-04"  # past Sunday and the Monday holiday


def test_edited_expected_date_moves_off_sunday(client, shop, one_day):
    order = _one_line_order(client, shop, one_day, "2031-03-04")
    res = client.patch(
        f"/api/v1/supplier-orders/{order['id']}/expected-delivery",
        json={"expectedDeliveryDate": "2031-03-09", "note": "Supplier said Sunday"},  # Sunday
        headers=_headers(shop["office"]),
    )
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["expectedDeliveryDate"] == "2031-03-10"


def test_stored_sunday_promise_counts_from_next_working_day(client, shop, one_day):
    order = _one_line_order(client, shop, one_day, "2031-03-04")
    row = db.session.get(MaterialPurchase, order["lines"][0]["id"])
    row.supplier_order.expected_delivery_date = date(2031, 3, 9)  # Sunday, saved before this rule
    db.session.commit()
    assert row.promised_date == date(2031, 3, 10)
