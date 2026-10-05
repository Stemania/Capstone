"""Material purchases link to the job's planned raw materials by stable id.

Uses the bmsc_test database from conftest (schema built from the models).
"""

from datetime import date
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus
from app.models.material_purchase import MaterialPurchase
from app.models.operation import JobOperation, OperationStatus
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
    worker = User(
        email="pm_worker@test.local",
        password_hash=bcrypt.generate_password_hash("Passw0rd!").decode("utf-8"),
        full_name="PM Worker",
        role=UserRole.PRODUCTION_WORKER,
        status=UserStatus.ACTIVE,
        active=True,
    )
    client_row = Client(name="Planned Client")
    supplier = Supplier(name="Plan Steel", typical_lead_time_days=3)
    db.session.add_all([office, admin, worker, client_row, supplier])
    db.session.commit()
    return {
        "office": office,
        "admin": admin,
        "worker": worker,
        "client": client_row,
        "supplier": supplier,
    }


def _issue(client, shop, order_id):
    res = client.post(
        f"/api/v1/supplier-orders/{order_id}/issue",
        json={"dateIssued": "2031-03-02"},
        headers=_headers(shop["office"]),
    )
    assert res.status_code == 200, res.get_json()
    return res.get_json()


def _create_job(client, shop, raw_materials, job_type="FABRICATION"):
    res = client.post(
        "/api/v1/job-orders",
        json={
            "clientId": shop["client"].id,
            "title": "Shaft",
            "dueDate": "2031-06-01",
            "jobType": job_type,
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


def test_unplanned_purchase_is_refused(client, shop):
    job = _create_job(client, shop, [{"name": "Round bar 50mm", "quantity": 10, "unit": "pcs"}])

    res = _purchase(
        client, shop, job["id"], materialName="Cutting disc", quantity=3, unit="pcs"
    )
    assert res.status_code == 400, res.get_json()
    assert res.get_json()["error"]["code"] == "PLANNED_MATERIAL_REQUIRED"

    after = _get(client, shop, job["id"])
    planned = _planned(after, "Round bar 50mm")
    assert planned["purchasedQuantity"] == 0
    assert planned["status"] == "TO_ORDER"
    assert after["materialStatus"] == "TO_ORDER"


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


# ---- Planned materials decide whether a job needs materials ---------------


def _patch(client, user, job_id, body):
    return client.patch(f"/api/v1/job-orders/{job_id}", json=body, headers=_headers(user))


def _from_stock(client, user, job_id, material_id, value=True):
    return client.patch(
        f"/api/v1/job-orders/{job_id}/planned-materials/{material_id}",
        json={"fromStock": value},
        headers=_headers(user),
    )


@pytest.mark.parametrize("job_type", ["FABRICATION", "REPAIR", "MODIFICATION"])
def test_job_with_planned_materials_is_to_order(client, shop, job_type):
    job = _create_job(client, shop, [{"name": "Bronze bushing", "quantity": 2}], job_type)
    assert job["materialStatus"] == "TO_ORDER"


@pytest.mark.parametrize("job_type", ["FABRICATION", "REPAIR"])
def test_job_without_planned_materials_is_not_required(client, shop, job_type):
    job = _create_job(client, shop, [], job_type)
    assert job["materialStatus"] == "NOT_REQUIRED"


def test_removing_planned_materials_makes_job_not_required(client, shop):
    job = _create_job(client, shop, [{"name": "Plate 10mm", "quantity": 2}])
    assert job["materialStatus"] == "TO_ORDER"

    res = _patch(client, shop["office"], job["id"], {"rawMaterials": []})
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["materialStatus"] == "NOT_REQUIRED"

    res = _patch(client, shop["office"], job["id"], {"rawMaterials": [{"name": "Plate 10mm"}]})
    assert res.get_json()["materialStatus"] == "TO_ORDER"


def test_admin_not_required_survives_planned_material_edits(client, shop):
    job = _create_job(client, shop, [{"name": "Plate 10mm", "quantity": 2}])
    res = _patch(client, shop["admin"], job["id"], {"materialStatus": "NOT_REQUIRED"})
    assert res.get_json()["materialStatus"] == "NOT_REQUIRED"

    materials = res.get_json()["rawMaterials"] + [{"name": "Round bar", "quantity": 1}]
    res = _patch(client, shop["office"], job["id"], {"rawMaterials": materials})
    assert res.get_json()["materialStatus"] == "NOT_REQUIRED"


def _released_job_with_op(client, shop, raw_materials):
    job = _create_job(client, shop, raw_materials)
    row = db.session.get(JobOrder, job["id"])
    row.status = JobOrderStatus.SCHEDULED
    op = JobOperation(
        job_order_id=row.id,
        sequence_no=1,
        operation_name="Cutting",
        estimated_hours=Decimal("1"),
        status=OperationStatus.SCHEDULED,
        assigned_worker_id=shop["worker"].id,
    )
    db.session.add(op)
    db.session.commit()
    return job, op.id


def _start(client, shop, op_id):
    return client.post(
        f"/api/v1/operations/{op_id}/start", json={}, headers=_headers(shop["worker"])
    )


def test_two_planned_materials_cannot_start_with_only_one_arrived(client, shop):
    job, op_id = _released_job_with_op(
        client,
        shop,
        [
            {"name": "Round bar 50mm", "quantity": 10, "unit": "pcs"},
            {"name": "Plate 10mm", "quantity": 2, "unit": "pcs"},
        ],
    )
    bar = _planned(job, "Round bar 50mm")
    res = _purchase(client, shop, job["id"], plannedMaterialId=bar["id"], quantity=10)
    assert res.status_code == 201, res.get_json()
    _issue(client, shop, res.get_json()["supplierOrderId"])
    line = db.session.get(MaterialPurchase, res.get_json()["id"])
    line.date_received = date(2031, 3, 5)
    db.session.commit()

    # Only the bar was ordered and it has arrived: the plate still blocks the start.
    res = _start(client, shop, op_id)
    assert res.status_code == 409, res.get_json()
    assert res.get_json()["error"]["code"] == "MATERIALS_NOT_ORDERED"

    plate = _planned(_get(client, shop, job["id"]), "Plate 10mm")
    res = _purchase(client, shop, job["id"], plannedMaterialId=plate["id"], quantity=2)
    _issue(client, shop, res.get_json()["supplierOrderId"])

    # Both ordered, one arrived: still blocked, now on receipt.
    res = _start(client, shop, op_id)
    assert res.status_code == 409, res.get_json()
    assert res.get_json()["error"]["code"] == "MATERIALS_NOT_RECEIVED"


def test_from_stock_material_needs_no_order(client, shop):
    job, op_id = _released_job_with_op(
        client,
        shop,
        [
            {"name": "Round bar 50mm", "quantity": 10, "unit": "pcs"},
            {"name": "Plate 10mm", "quantity": 2, "unit": "pcs"},
        ],
    )
    plate = _planned(job, "Plate 10mm")

    assert _from_stock(client, shop["office"], job["id"], plate["id"]).status_code == 403
    res = _from_stock(client, shop["admin"], job["id"], plate["id"])
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert _planned(body, "Plate 10mm")["status"] == "FROM_STOCK"
    assert body["materialReadiness"]["unorderedMaterials"] == ["Round bar 50mm"]

    # A From stock material can't be bought for this job.
    res = _purchase(client, shop, job["id"], plannedMaterialId=plate["id"], quantity=2)
    assert res.status_code == 400
    assert res.get_json()["error"]["code"] == "PLANNED_MATERIAL_FROM_STOCK"

    bar = _planned(body, "Round bar 50mm")
    res = _purchase(client, shop, job["id"], plannedMaterialId=bar["id"], quantity=10)
    _issue(client, shop, res.get_json()["supplierOrderId"])
    line = db.session.get(MaterialPurchase, res.get_json()["id"])
    line.date_received = date(2031, 3, 5)
    db.session.commit()

    res = _start(client, shop, op_id)
    assert res.status_code == 200, res.get_json()

    # Re-saving the list from the edit form keeps the From stock flag.
    saved = _get(client, shop, job["id"])["rawMaterials"]
    res = _patch(client, shop["office"], job["id"], {"rawMaterials": saved})
    assert _planned(res.get_json(), "Plate 10mm")["fromStock"] is True


def test_only_material_from_stock_makes_job_not_required(client, shop):
    job = _create_job(client, shop, [{"name": "Plate 10mm", "quantity": 2}])
    plate = _planned(job, "Plate 10mm")
    res = _from_stock(client, shop["admin"], job["id"], plate["id"])
    assert res.get_json()["materialStatus"] == "NOT_REQUIRED"

    res = _from_stock(client, shop["admin"], job["id"], plate["id"], value=False)
    assert res.get_json()["materialStatus"] == "TO_ORDER"
