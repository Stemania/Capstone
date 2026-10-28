"""Office Staff dashboard summary: the office's own work waiting to be done."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.extensions import db
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.notification import (
    NotificationChannel,
    NotificationLog,
    NotificationMilestone,
    NotificationStatus,
)
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


def _log(job, status, minutes_ago):
    db.session.add(
        NotificationLog(
            job_order_id=job.id,
            client_id=job.client_id,
            milestone=NotificationMilestone.JOB_STARTED,
            event="JOB_STARTED",
            channel=NotificationChannel.EMAIL,
            recipient="client@example.com",
            message_body="x",
            status=status,
            created_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
        )
    )


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
    failed = _plain_job(shop, JobOrderStatus.IN_PROGRESS, "Email failed")
    _log(failed, NotificationStatus.FAILED, 30)
    resent = _plain_job(shop, JobOrderStatus.IN_PROGRESS, "Email resent")
    _log(resent, NotificationStatus.FAILED, 30)
    _log(resent, NotificationStatus.SENT, 10)
    db.session.commit()

    body = client.get("/api/v1/analytics/office-summary", headers=_headers(shop["office"])).get_json()
    assert body["pendingJobs"] == 1
    assert [j["id"] for j in body["materialsToOrder"]] == [to_order.id]
    assert [j["id"] for j in body["invoicesToRecord"]] == [done.id]
    assert [e["jobOrderId"] for e in body["failedEmails"]] == [failed.id]
    assert body["lowStock"] == [] and body["lateDeliveries"] == []


def test_office_summary_is_for_office_staff_only(client, shop):
    res = client.get("/api/v1/analytics/office-summary", headers=_headers(shop["admin"]))
    assert res.status_code == 403
