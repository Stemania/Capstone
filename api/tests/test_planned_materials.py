"""Material purchases link to the job's planned raw materials by stable id.

Uses the bmsc_test database from conftest (schema built from the models).
"""

import pytest
from flask_jwt_extended import create_access_token

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.supplier import Supplier
from app.models.user import User, UserRole, UserStatus


def _headers(user):
    token = create_access_token(identity=user.id, additional_claims={"role": user.role.value})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def shop(app):
    office = User(
        email="pm_office@test.local",
        password_hash=bcrypt.generate_password_hash("Passw0rd!").decode("utf-8"),
        full_name="PM Office",
        role=UserRole.OFFICE_STAFF,
        status=UserStatus.ACTIVE,
        active=True,
    )
    admin = User(
        email="pm_admin@test.local",
        password_hash=bcrypt.generate_password_hash("Passw0rd!").decode("utf-8"),
        full_name="PM Admin",
        role=UserRole.ADMIN,
        status=UserStatus.ACTIVE,
        active=True,
    )
    client_row = Client(name="Planned Client")
    supplier = Supplier(name="Plan Steel", typical_lead_time_days=3)
    db.session.add_all([office, admin, client_row, supplier])
    db.session.commit()
    return {"office": office, "admin": admin, "client": client_row, "supplier": supplier}


def _issue(client, shop, order_id):
    res = client.post(
        f"/api/v1/supplier-orders/{order_id}/issue",
        json={"dateIssued": "2031-03-02"},
        headers=_headers(shop["admin"]),
    )
    assert res.status_code == 200, res.get_json()
    return res.get_json()


def _create_job(client, shop, raw_materials):
    res = client.post(
        "/api/v1/job-orders",
        json={
            "clientId": shop["client"].id,
            "title": "Shaft",
            "dueDate": "2031-06-01",
            "jobType": "FABRICATION",
            "rawMaterials": raw_materials,
        },
        headers=_headers(shop["office"]),
    )
    assert res.status_code == 201, res.get_json()
    return res.get_json()


def _get(client, shop, job_id):
    return client.get(f"/api/v1/job-orders/{job_id}", headers=_headers(shop["office"])).get_json()


def _purchase(client, shop, job_id, **body):
    payload = {
        "supplierId": shop["supplier"].id,
        "unitCost": 100,
        "dateOrdered": "2031-03-02",
        **body,
    }
    return client.post(
        f"/api/v1/job-orders/{job_id}/material-purchases",
        json=payload,
        headers=_headers(shop["office"]),
    )


def _planned(job, name):
    return next(m for m in job["plannedMaterials"] if m["name"] == name)


def test_planned_materials_get_stable_ids(client, shop):
    job = _create_job(
        client,
        shop,
        [
            {"name": "Round bar 50mm", "quantity": 10, "unit": "pcs"},
            {"name": "Plate 10mm", "quantity": 2, "unit": "pcs"},
        ],
    )
    ids = [m["id"] for m in job["rawMaterials"]]
    assert all(ids) and len(set(ids)) == 2

    # Re-saving the list (as the edit form does) keeps the ids.
    res = client.patch(
        f"/api/v1/job-orders/{job['id']}",
        json={"rawMaterials": job["rawMaterials"]},
        headers=_headers(shop["office"]),
    )
    assert res.status_code == 200, res.get_json()
    assert [m["id"] for m in res.get_json()["rawMaterials"]] == ids


def test_choosing_planned_material_fills_name_and_remaining_quantity(client, shop):
    job = _create_job(client, shop, [{"name": "Round bar 50mm", "quantity": 10, "unit": "pcs"}])
    planned = _planned(job, "Round bar 50mm")
    assert planned["remainingQuantity"] == 10
    assert planned["status"] == "TO_ORDER"

    # The form sends the planned id with the remaining quantity; name and unit
    # come from the plan.
    res = _purchase(
        client,
        shop,
        job["id"],
        plannedMaterialId=planned["id"],
        quantity=planned["remainingQuantity"],
        gradeOrSpec="AISI 1045",
    )
    assert res.status_code == 201, res.get_json()
    body = res.get_json()
    assert body["plannedMaterialId"] == planned["id"]
    assert body["materialName"] == "Round bar 50mm"
    assert body["unit"] == "pcs"
    assert body["quantity"] == 10

    on_draft = _planned(_get(client, shop, job["id"]), "Round bar 50mm")
    assert on_draft["draftQuantity"] == 10
    assert on_draft["purchasedQuantity"] == 0
    assert on_draft["remainingQuantity"] == 0
    assert on_draft["status"] == "ON_DRAFT_ORDER"

    _issue(client, shop, body["supplierOrderId"])
    after = _planned(_get(client, shop, job["id"]), "Round bar 50mm")
    assert after["purchasedQuantity"] == 10
    assert after["draftQuantity"] == 0
    assert after["remainingQuantity"] == 0
    assert after["status"] == "PURCHASED"


def test_partial_purchase_leaves_rest_still_to_order(client, shop):
    job = _create_job(client, shop, [{"name": "Round bar 50mm", "quantity": 10, "unit": "pcs"}])
    planned = _planned(job, "Round bar 50mm")

    res = _purchase(client, shop, job["id"], plannedMaterialId=planned["id"], quantity=4)
    assert res.status_code == 201, res.get_json()
    _issue(client, shop, res.get_json()["supplierOrderId"])

    after = _planned(_get(client, shop, job["id"]), "Round bar 50mm")
    assert after["purchasedQuantity"] == 4
    assert after["remainingQuantity"] == 6
    assert after["status"] == "PARTLY_ORDERED"


def test_unplanned_purchase_is_allowed(client, shop):
    job = _create_job(client, shop, [{"name": "Round bar 50mm", "quantity": 10, "unit": "pcs"}])

    res = _purchase(
        client, shop, job["id"], materialName="Cutting disc", quantity=3, unit="pcs"
    )
    assert res.status_code == 201, res.get_json()
    assert res.get_json()["plannedMaterialId"] is None
    _issue(client, shop, res.get_json()["supplierOrderId"])

    after = _get(client, shop, job["id"])
    planned = _planned(after, "Round bar 50mm")
    assert planned["purchasedQuantity"] == 0
    assert planned["status"] == "TO_ORDER"
    assert after["materialStatus"] == "ORDERED"


def test_linked_purchase_must_match_plan_and_job(client, shop):
    job = _create_job(client, shop, [{"name": "Round bar 50mm", "quantity": 10, "unit": "pcs"}])
    other = _create_job(client, shop, [{"name": "Plate", "quantity": 1, "unit": "pcs"}])
    planned = _planned(job, "Round bar 50mm")

    res = _purchase(client, shop, job["id"], plannedMaterialId=planned["id"], quantity=2, unit="kg")
    assert res.status_code == 400
    res = _purchase(
        client,
        shop,
        job["id"],
        plannedMaterialId=_planned(other, "Plate")["id"],
        quantity=1,
    )
    assert res.status_code == 400


def test_planned_material_with_purchases_cannot_be_removed(client, shop):
    job = _create_job(
        client,
        shop,
        [
            {"name": "Round bar 50mm", "quantity": 10, "unit": "pcs"},
            {"name": "Plate 10mm", "quantity": 2, "unit": "pcs"},
        ],
    )
    bar = _planned(job, "Round bar 50mm")
    assert _purchase(client, shop, job["id"], plannedMaterialId=bar["id"], quantity=4).status_code == 201

    keep_plate_only = [m for m in job["rawMaterials"] if m["id"] != bar["id"]]
    res = client.patch(
        f"/api/v1/job-orders/{job['id']}",
        json={"rawMaterials": keep_plate_only},
        headers=_headers(shop["office"]),
    )
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "PLANNED_MATERIAL_IN_USE"
