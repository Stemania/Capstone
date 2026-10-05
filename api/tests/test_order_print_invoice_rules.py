"""Only planned materials are ordered, a PO prints once issued, and the sales
invoice is a recorded reference to the shop's BIR-registered invoice.

Uses the bmsc_test database from conftest (schema built from the models).
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.extensions import bcrypt, db
from app.models.audit_log import AuditLog
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.material_purchase import MaterialPurchase
from app.models.operation import JobOperation, OperationStatus
from app.models.sales_invoice import SalesInvoice
from app.models.supplier import Supplier
from app.models.user import User, UserRole, UserStatus
from app.services.schedule_calendar import shop_now


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
    s = {
        "admin": _user("opi_admin@test.local", UserRole.ADMIN),
        "office": _user("opi_office@test.local", UserRole.OFFICE_STAFF),
        "client": Client(name="OPI Client"),
        "steel": Supplier(name="OPI Steel", typical_lead_time_days=5),
    }
    db.session.add_all([s["client"], s["steel"]])
    db.session.commit()
    return s


def _job(shop, *, status=JobOrderStatus.DRAFT, raw_materials=None, amount=None):
    job = JobOrder(
        client_id=shop["client"].id,
        title="OPI Shaft",
        due_date=date(2031, 6, 1),
        status=status,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        material_status=MaterialStatus.TO_ORDER if raw_materials else MaterialStatus.NOT_REQUIRED,
        raw_materials=raw_materials or [],
        amount=amount,
        created_by_id=shop["office"].id,
    )
    db.session.add(job)
    db.session.commit()
    return job


def _completed_job(shop, amount=Decimal("15000.00")):
    job = _job(shop, status=JobOrderStatus.COMPLETED, amount=amount)
    db.session.add(
        JobOperation(
            job_order_id=job.id,
            sequence_no=1,
            operation_name="Turning",
            status=OperationStatus.COMPLETED,
            estimated_hours=Decimal("1"),
        )
    )
    db.session.commit()
    return job


def _add_lines(client, shop, lines):
    return client.post(
        "/api/v1/supplier-orders/draft-lines",
        json={"supplierId": shop["steel"].id, "lines": lines},
        headers=_headers(shop["office"]),
    )


def _today():
    return shop_now().date().isoformat()


# --- 2. Only planned materials can be ordered ---


def test_line_without_a_planned_material_is_refused(client, shop):
    job = _job(shop, raw_materials=[{"name": "Round bar 50mm", "quantity": 4, "unit": "pcs"}])

    res = _add_lines(
        client,
        shop,
        [{"jobOrderId": job.id, "materialName": "Cutting disc", "quantity": 2, "unitCost": 40}],
    )
    assert res.status_code == 400
    assert res.get_json()["error"]["code"] == "PLANNED_MATERIAL_REQUIRED"
    assert MaterialPurchase.query.count() == 0


def test_job_purchase_route_also_requires_a_planned_material(client, shop):
    job = _job(shop, raw_materials=[{"name": "Round bar 50mm", "quantity": 4, "unit": "pcs"}])

    res = client.post(
        f"/api/v1/job-orders/{job.id}/material-purchases",
        json={"supplierId": shop["steel"].id, "materialName": "Bolts", "quantity": 1, "unitCost": 5},
        headers=_headers(shop["office"]),
    )
    assert res.status_code == 400
    assert res.get_json()["error"]["code"] == "PLANNED_MATERIAL_REQUIRED"


def test_planned_material_is_ordered_under_its_planned_name(client, shop):
    job = _job(shop, raw_materials=[{"name": "Round bar 50mm", "quantity": 4, "unit": "pcs"}])
    planned_id = job.raw_materials[0]["id"]

    res = _add_lines(
        client,
        shop,
        [
            {
                "jobOrderId": job.id,
                "plannedMaterialId": planned_id,
                "materialName": "Something else",
                "quantity": 4,
                "unitCost": 250,
            }
        ],
    )
    assert res.status_code == 200, res.get_json()
    line = res.get_json()["lines"][0]
    assert line["plannedMaterialId"] == planned_id
    assert line["materialName"] == "Round bar 50mm"


def test_extra_material_is_added_to_the_plan_first_then_ordered(client, shop):
    job = _job(shop, raw_materials=[{"name": "Round bar 50mm", "quantity": 4, "unit": "pcs"}])
    res = client.patch(
        f"/api/v1/job-orders/{job.id}",
        json={
            "rawMaterials": [
                *job.raw_materials,
                {"name": "Cutting disc", "quantity": 2, "unit": "pcs"},
            ]
        },
        headers=_headers(shop["office"]),
    )
    assert res.status_code == 200, res.get_json()
    disc = next(m for m in res.get_json()["plannedMaterials"] if m["name"] == "Cutting disc")

    res = _add_lines(
        client,
        shop,
        [{"jobOrderId": job.id, "plannedMaterialId": disc["id"], "quantity": 2, "unitCost": 40}],
    )
    assert res.status_code == 200, res.get_json()


def test_nothing_left_to_order_once_every_planned_material_is_on_an_order(client, shop):
    job = _job(
        shop,
        raw_materials=[
            {"name": "Round bar 50mm", "quantity": 4, "unit": "pcs"},
            {"name": "Plate 10mm", "quantity": 1, "unit": "pcs"},
        ],
    )
    headers = _headers(shop["office"])
    outstanding = client.get(f"/api/v1/supplier-orders/outstanding?jobId={job.id}", headers=headers)
    assert len(outstanding.get_json()["materials"]) == 2

    res = _add_lines(
        client,
        shop,
        [
            {"jobOrderId": job.id, "plannedMaterialId": m["id"], "quantity": m["quantity"], "unitCost": 10}
            for m in job.raw_materials
        ],
    )
    assert res.status_code == 200, res.get_json()

    outstanding = client.get(f"/api/v1/supplier-orders/outstanding?jobId={job.id}", headers=headers)
    assert outstanding.get_json()["materials"] == []
    statuses = {
        m["status"]
        for m in client.get(f"/api/v1/job-orders/{job.id}", headers=headers).get_json()[
            "plannedMaterials"
        ]
    }
    assert statuses == {"ON_DRAFT_ORDER"}


# --- 3. A PO prints only once issued ---


def test_draft_order_cannot_be_printed_until_issued(client, shop):
    job = _job(shop, raw_materials=[{"name": "Round bar 50mm", "quantity": 4, "unit": "pcs"}])
    order = _add_lines(
        client,
        shop,
        [
            {
                "jobOrderId": job.id,
                "plannedMaterialId": job.raw_materials[0]["id"],
                "quantity": 4,
                "unitCost": 250,
            }
        ],
    ).get_json()
    headers = _headers(shop["office"])

    res = client.get(f"/api/v1/supplier-orders/{order['id']}/print", headers=headers)
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "ORDER_NOT_ISSUED"
    assert res.get_json()["error"]["message"] == "Issue the order before printing."

    res = client.post(
        f"/api/v1/supplier-orders/{order['id']}/issue",
        json={"dateIssued": "2031-03-02"},
        headers=headers,
    )
    assert res.status_code == 200, res.get_json()

    res = client.get(f"/api/v1/supplier-orders/{order['id']}/print", headers=headers)
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["order"]["poNumber"] == "BMSC-PO-00001"


# --- 4. Sales invoice: a recorded reference ---


def _record(client, shop, job, user=None, **body):
    payload = {"invoiceNumber": "SI-0001234", "invoiceDate": _today(), **body}
    return client.post(
        f"/api/v1/job-orders/{job.id}/invoice",
        json=payload,
        headers=_headers(user or shop["office"]),
    )


def test_office_records_the_bir_invoice_number_and_amount_defaults_to_job_amount(client, shop):
    job = _completed_job(shop)

    res = _record(client, shop, job)
    assert res.status_code == 201, res.get_json()
    body = res.get_json()
    assert body["invoiceNumber"] == "SI-0001234"
    assert body["invoiceDate"] == _today()
    assert body["amount"] == 15000.0
    assert body["preparedById"] == shop["office"].id

    inv = SalesInvoice.query.filter_by(job_order_id=job.id).one()
    assert inv.invoice_seq is None
    assert not inv.invoice_number.startswith("BMSC-INV-")


def test_entered_amount_overrides_the_job_amount(client, shop):
    job = _completed_job(shop)
    res = _record(client, shop, job, amount=12345.5)
    assert res.status_code == 201, res.get_json()
    assert res.get_json()["amount"] == 12345.5


def test_admin_cannot_record_an_invoice(client, shop):
    job = _completed_job(shop)
    res = _record(client, shop, job, user=shop["admin"])
    assert res.status_code == 403
    assert SalesInvoice.query.count() == 0


@pytest.mark.parametrize(
    "body, field",
    [
        ({"invoiceNumber": "   "}, "invoiceNumber"),
        ({"invoiceNumber": "X" * 65}, "invoiceNumber"),
        ({"invoiceDate": None}, "invoiceDate"),
        ({"invoiceDate": "2999-01-01"}, "invoiceDate"),
        ({"amount": -1}, "amount"),
    ],
)
def test_invoice_entry_is_validated(client, shop, body, field):
    job = _completed_job(shop)
    res = _record(client, shop, job, **body)
    assert res.status_code == 400, res.get_json()
    assert field in res.get_json()["error"]["message"]


def test_invoice_number_cannot_be_reused_on_another_job(client, shop):
    assert _record(client, shop, _completed_job(shop)).status_code == 201
    res = _record(client, shop, _completed_job(shop), invoiceNumber="si-0001234")
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "DUPLICATE_INVOICE_NUMBER"


def test_invoice_needs_a_completed_job_and_only_one_per_job(client, shop):
    open_job = _job(shop, status=JobOrderStatus.IN_PROGRESS, amount=Decimal("100"))
    res = _record(client, shop, open_job)
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "INVALID_TRANSITION"

    job = _completed_job(shop)
    assert _record(client, shop, job).status_code == 201
    res = _record(client, shop, job, invoiceNumber="SI-0009999")
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "INVOICE_EXISTS"


def test_delivery_still_requires_a_recorded_invoice(client, shop):
    job = _completed_job(shop)
    headers = _headers(shop["office"])

    res = client.post(f"/api/v1/job-orders/{job.id}/deliver", headers=headers)
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "INVOICE_REQUIRED"

    assert _record(client, shop, job).status_code == 201
    res = client.post(f"/api/v1/job-orders/{job.id}/deliver", headers=headers)
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["status"] == "DELIVERED"


def _correct(client, shop, job, user=None, **body):
    return client.patch(
        f"/api/v1/job-orders/{job.id}/invoice",
        json=body,
        headers=_headers(user or shop["office"]),
    )


def test_correction_needs_a_reason_and_logs_old_and_new_values(client, shop):
    job = _completed_job(shop)
    assert _record(client, shop, job).status_code == 201
    yesterday = (shop_now().date() - timedelta(days=1)).isoformat()

    res = _correct(client, shop, job, invoiceNumber="SI-0001243", amount=14000)
    assert res.status_code == 400
    assert "reason" in res.get_json()["error"]["message"]

    res = _correct(
        client,
        shop,
        job,
        invoiceNumber="SI-0001243",
        invoiceDate=yesterday,
        amount=14000,
        reason="Digits swapped when typing",
    )
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert body["invoiceNumber"] == "SI-0001243"
    assert body["invoiceDate"] == yesterday
    assert body["amount"] == 14000.0

    inv = SalesInvoice.query.filter_by(job_order_id=job.id).one()
    row = AuditLog.query.filter_by(
        action="SALES_INVOICE_CORRECTED", entity_type="SalesInvoice", entity_id=inv.id
    ).one()
    assert row.user_id == shop["office"].id
    assert row.user_role == UserRole.OFFICE_STAFF.value
    assert row.before_json == {"invoiceNumber": "SI-0001234", "invoiceDate": _today(), "amount": 15000.0}
    assert row.after_json == {
        "invoiceNumber": "SI-0001243",
        "invoiceDate": yesterday,
        "amount": 14000.0,
        "reason": "Digits swapped when typing",
    }


def test_correction_with_no_change_is_refused(client, shop):
    job = _completed_job(shop)
    assert _record(client, shop, job).status_code == 201
    res = _correct(client, shop, job, invoiceNumber="SI-0001234", reason="Checking")
    assert res.status_code == 400


def test_admin_cannot_correct_an_invoice(client, shop):
    job = _completed_job(shop)
    assert _record(client, shop, job).status_code == 201
    res = _correct(client, shop, job, user=shop["admin"], amount=1, reason="x")
    assert res.status_code == 403


def test_invoice_is_locked_after_delivery(client, shop):
    job = _completed_job(shop)
    assert _record(client, shop, job).status_code == 201
    headers = _headers(shop["office"])
    assert client.post(f"/api/v1/job-orders/{job.id}/deliver", headers=headers).status_code == 200

    res = _correct(client, shop, job, amount=1, reason="Too late")
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "INVOICE_LOCKED"
    assert SalesInvoice.query.filter_by(job_order_id=job.id).one().total == Decimal("15000.00")


def test_existing_generated_invoice_numbers_stay_as_references(client, shop):
    job = _completed_job(shop)
    db.session.add(
        SalesInvoice(
            invoice_seq=7,
            invoice_number="BMSC-INV-00007",
            invoice_date=date(2026, 9, 1),
            job_order_id=job.id,
            client_id=job.client_id,
            description="Old generated invoice",
            subtotal=Decimal("10000"),
            vat_rate=Decimal("12"),
            vat_amount=Decimal("1200"),
            total=Decimal("11200"),
            prepared_by_id=shop["office"].id,
        )
    )
    db.session.commit()

    body = client.get(f"/api/v1/job-orders/{job.id}/invoice", headers=_headers(shop["office"])).get_json()
    assert body["invoiceNumber"] == "BMSC-INV-00007"
    assert body["amount"] == 11200.0

    res = client.post(f"/api/v1/job-orders/{job.id}/deliver", headers=_headers(shop["office"]))
    assert res.status_code == 200, res.get_json()
