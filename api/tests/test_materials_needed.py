"""Materials needed on the job order form; material lines typed when ordering.

Uses the bmsc_test database from conftest (schema built from the models).
"""

from datetime import date
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus
from app.models.operation import JobOperation, OperationStatus
from app.models.supplier import Supplier
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


@pytest.fixture
def shop(app):
    office = _user("mn_office@test.local", UserRole.OFFICE_STAFF)
    admin = _user("mn_admin@test.local", UserRole.ADMIN)
    worker = _user("mn_worker@test.local", UserRole.PRODUCTION_WORKER)
    client_row = Client(name="Needed Client")
    supplier = Supplier(name="Need Steel", code="NST", typical_lead_time_days=3)
    db.session.add_all([office, admin, worker, client_row, supplier])
    db.session.commit()
    return {
        "office": office,
        "admin": admin,
        "worker": worker,
        "client": client_row,
        "supplier": supplier,
    }


def _create_job(client, shop, job_type="FABRICATION", **extra):
    res = client.post(
        "/api/v1/job-orders",
        json={
            "clientId": shop["client"].id,
            "title": "Shaft",
            "dueDate": "2031-06-01",
            "jobType": job_type,
            **extra,
        },
        headers=_headers(shop["office"]),
    )
    assert res.status_code == 201, res.get_json()
    return res.get_json()


def _patch(client, user, job_id, body):
    return client.patch(f"/api/v1/job-orders/{job_id}", json=body, headers=_headers(user))


def _get(client, shop, job_id):
    return client.get(f"/api/v1/job-orders/{job_id}", headers=_headers(shop["office"])).get_json()


def _add_line(client, shop, job_id, **body):
    payload = {
        "supplierId": shop["supplier"].id,
        "materialName": "Round bar 50mm",
        "quantity": 10,
        "unit": "pcs",
        "unitCost": 100,
        **body,
    }
    return client.post(
        f"/api/v1/job-orders/{job_id}/material-purchases",
        json=payload,
        headers=_headers(shop["office"]),
    )


def _issue(client, shop, order_id):
    res = client.post(
        f"/api/v1/supplier-orders/{order_id}/issue",
        json={"dateIssued": "2031-03-02"},
        headers=_headers(shop["office"]),
    )
    assert res.status_code == 200, res.get_json()
    return res.get_json()


def _receive(client, shop, order_id):
    res = client.post(
        f"/api/v1/supplier-orders/{order_id}/receive",
        json={"receivedDate": "2031-03-05"},
        headers=_headers(shop["office"]),
    )
    assert res.status_code == 200, res.get_json()
    return res.get_json()


@pytest.mark.parametrize(
    "job_type,expected",
    [("FABRICATION", "TO_ORDER"), ("REPAIR", "NOT_REQUIRED"), ("MODIFICATION", "NOT_REQUIRED")],
)
def test_materials_needed_defaults_by_job_type(client, shop, job_type, expected):
    job = _create_job(client, shop, job_type)
    assert job["materialStatus"] == expected
    assert job["rawMaterials"] == []


def test_form_can_choose_materials_needed(client, shop):
    assert _create_job(client, shop, "REPAIR", materialStatus="TO_ORDER")["materialStatus"] == "TO_ORDER"
    assert (
        _create_job(client, shop, "FABRICATION", materialStatus="NOT_REQUIRED")["materialStatus"]
        == "NOT_REQUIRED"
    )
    res = client.post(
        "/api/v1/job-orders",
        json={
            "clientId": shop["client"].id,
            "title": "Bad",
            "dueDate": "2031-06-01",
            "jobType": "FABRICATION",
            "materialStatus": "RECEIVED",
        },
        headers=_headers(shop["office"]),
    )
    assert res.status_code == 400


def test_raw_materials_list_is_no_longer_saved(client, shop):
    job = _create_job(client, shop, rawMaterials=[{"name": "Plate", "quantity": 1}])
    assert job["rawMaterials"] == []
    res = _patch(client, shop["office"], job["id"], {"rawMaterials": [{"name": "Plate"}]})
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["rawMaterials"] == []


def test_only_admin_sets_not_required_after_release(client, shop):
    job = _create_job(client, shop)
    # Pending: Office Staff choose freely.
    res = _patch(client, shop["office"], job["id"], {"materialStatus": "NOT_REQUIRED"})
    assert res.status_code == 200 and res.get_json()["materialStatus"] == "NOT_REQUIRED"
    res = _patch(client, shop["office"], job["id"], {"materialStatus": "TO_ORDER"})
    assert res.get_json()["materialStatus"] == "TO_ORDER"

    row = db.session.get(JobOrder, job["id"])
    row.status = JobOrderStatus.SCHEDULED
    db.session.commit()
    res = _patch(client, shop["office"], job["id"], {"materialStatus": "NOT_REQUIRED"})
    assert res.status_code == 403
    res = _patch(client, shop["admin"], job["id"], {"materialStatus": "NOT_REQUIRED"})
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["materialStatus"] == "NOT_REQUIRED"


def test_lines_are_typed_with_grade_unit_and_cost(client, shop):
    job = _create_job(client, shop)
    res = _add_line(
        client, shop, job["id"], gradeOrSpec="AISI 1045", quantity=2.5, unit="m", unitCost=480
    )
    assert res.status_code == 201, res.get_json()
    line = res.get_json()
    assert line["materialName"] == "Round bar 50mm"
    assert line["gradeOrSpec"] == "AISI 1045"
    assert Decimal(str(line["quantity"])) == Decimal("2.5")
    assert line["unit"] == "m"
    assert Decimal(str(line["unitCost"])) == Decimal("480")
    assert line["plannedMaterialId"] is None

    assert _add_line(client, shop, job["id"], materialName="").status_code == 400
    assert _add_line(client, shop, job["id"], quantity=0).status_code == 400


def test_not_required_job_takes_no_order_lines(client, shop):
    job = _create_job(client, shop, "REPAIR")
    res = _add_line(client, shop, job["id"])
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "MATERIALS_NOT_REQUIRED"


def test_job_page_lists_ordered_lines_and_earlier_planned_materials(client, shop):
    job = _create_job(client, shop)
    row = db.session.get(JobOrder, job["id"])
    row.raw_materials = [{"id": "old-1", "name": "Plate 10mm", "quantity": 2, "unit": "pcs"}]
    db.session.commit()

    order_id = _add_line(client, shop, job["id"]).get_json()["supplierOrderId"]
    _issue(client, shop, order_id)
    body = _get(client, shop, job["id"])
    [line] = body["materialLines"]
    assert line["materialName"] == "Round bar 50mm"
    assert line["status"] == "ORDERED"
    assert line["poNumber"] == "NST31000001"
    assert line["expectedDate"] == "2031-03-05"
    assert line["dateReceived"] is None
    assert "unitCost" not in line
    # Earlier planned materials stay visible as a read-only record.
    assert [m["name"] for m in body["plannedMaterials"]] == ["Plate 10mm"]

    _receive(client, shop, order_id)
    [line] = _get(client, shop, job["id"])["materialLines"]
    assert line["status"] == "RECEIVED" and line["dateReceived"] == "2031-03-05"


def _released_job_with_op(client, shop, job_type="FABRICATION"):
    job = _create_job(client, shop, job_type)
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


def test_to_order_job_starts_only_when_every_line_is_received(client, shop):
    job, op_id = _released_job_with_op(client, shop)

    res = _start(client, shop, op_id)
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "MATERIALS_NOT_ORDERED"

    # A draft line is not an issued line.
    order_id = _add_line(client, shop, job["id"]).get_json()["supplierOrderId"]
    _add_line(client, shop, job["id"], materialName="Plate 10mm", quantity=1)
    res = _start(client, shop, op_id)
    assert res.get_json()["error"]["code"] == "MATERIALS_NOT_ORDERED"

    _issue(client, shop, order_id)
    res = _start(client, shop, op_id)
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "MATERIALS_NOT_RECEIVED"

    _receive(client, shop, order_id)
    res = _start(client, shop, op_id)
    assert res.status_code == 200, res.get_json()


def test_not_required_job_starts_freely(client, shop):
    _job, op_id = _released_job_with_op(client, shop, "REPAIR")
    res = _start(client, shop, op_id)
    assert res.status_code == 200, res.get_json()


def test_admin_not_required_unblocks_a_to_order_job(client, shop):
    job, op_id = _released_job_with_op(client, shop)
    assert _start(client, shop, op_id).status_code == 409
    res = _patch(client, shop["admin"], job["id"], {"materialStatus": "NOT_REQUIRED"})
    assert res.status_code == 200, res.get_json()
    assert _start(client, shop, op_id).status_code == 200


def test_from_stock_route_is_gone(client, shop):
    job = _create_job(client, shop)
    res = client.patch(
        f"/api/v1/job-orders/{job['id']}/planned-materials/x",
        json={"fromStock": True},
        headers=_headers(shop["admin"]),
    )
    assert res.status_code in (404, 405)


def test_ordering_context_lists_jobs_that_need_materials(client, shop):
    to_order = _create_job(client, shop)
    _create_job(client, shop, "REPAIR")
    res = client.get("/api/v1/supplier-orders/outstanding", headers=_headers(shop["office"]))
    assert res.status_code == 200, res.get_json()
    jobs = res.get_json()["jobs"]
    assert [j["id"] for j in jobs] == [to_order["id"]]
    assert jobs[0]["notOrderedYet"] is True
    assert jobs[0]["issuedLineCount"] == 0
