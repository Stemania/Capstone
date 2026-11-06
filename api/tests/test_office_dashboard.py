"""Office Staff dashboard summary: the office's own work waiting to be done."""

from datetime import timedelta
from decimal import Decimal

from app.extensions import db
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.sales_invoice import SalesInvoice
from app.services import forecast_service
from tests.test_material_delay import _headers, shop  # noqa: F401  (fixtures)


def _plain_job(shop, status, title, material=MaterialStatus.NOT_REQUIRED):
    job = JobOrder(
        client_id=shop["client"].id,
        title=title,
        due_date=shop["today"] + timedelta(days=20),
        status=status,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        material_status=material,
        created_by_id=shop["office"].id,
    )
    db.session.add(job)
    db.session.flush()
    return job


def test_office_summary_lists_the_office_work(client, shop, monkeypatch):
    monkeypatch.setattr(forecast_service, "stock_snapshot_for_tools", lambda tools, today=None: {})
    _plain_job(shop, JobOrderStatus.DRAFT, "Waiting for planning")
    to_order = _plain_job(shop, JobOrderStatus.SCHEDULED, "Needs steel", MaterialStatus.TO_ORDER)
    done = _plain_job(shop, JobOrderStatus.COMPLETED, "Done, no invoice")
    invoiced = _plain_job(shop, JobOrderStatus.COMPLETED, "Done, invoiced")
    db.session.add(
        SalesInvoice(
            invoice_number="INV-1", invoice_date=shop["today"], job_order_id=invoiced.id,
            client_id=invoiced.client_id, subtotal=Decimal("100"), total=Decimal("100"),
            prepared_by_id=shop["office"].id,
        )
    )
    db.session.commit()

    body = client.get("/api/v1/analytics/office-summary", headers=_headers(shop["office"])).get_json()
    assert body["pendingJobs"] == 1
    assert [j["id"] for j in body["materialsToOrder"]] == [to_order.id]
    assert [j["id"] for j in body["invoicesToRecord"]] == [done.id]
    assert "failedEmails" not in body
    assert body["restockDue"] == [] and body["lateDeliveries"] == []


def test_office_summary_is_for_office_staff_only(client, shop):
    res = client.get("/api/v1/analytics/office-summary", headers=_headers(shop["admin"]))
    assert res.status_code == 403
