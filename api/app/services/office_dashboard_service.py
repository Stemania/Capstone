"""Office Staff dashboard: the office's own work waiting to be done (objective 4.1).

Job orders still to be planned, materials not yet ordered, supplier deliveries
that are late or due this week, completed jobs without a sales invoice,
consumables at their reorder level, and client emails that failed and were not
sent since.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models.job_order import JobOrder, JobOrderStatus, MaterialStatus
from app.models.notification import NotificationLog, NotificationStatus
from app.models.sales_invoice import SalesInvoice
from app.models.supplier_order import SupplierOrder, SupplierOrderStatus
from app.services import low_stock_service
from app.services import material_purchase_service as mp_service
from app.services.schedule_calendar import shop_now

FAILED_EMAIL_DAYS = 30
DUE_SOON_DAYS = 7
OPEN_JOB = (JobOrderStatus.DRAFT, JobOrderStatus.SCHEDULED, JobOrderStatus.IN_PROGRESS)


def _job(job: JobOrder) -> dict:
    return {
        "id": job.id,
        "jobNumber": job.job_number,
        "title": job.title,
        "clientName": job.client.name if job.client else None,
        "dueDate": job.due_date.isoformat() if job.due_date else None,
        "status": job.status.value,
    }


def _materials_to_order():
    jobs = (
        JobOrder.query.options(joinedload(JobOrder.material_purchases), joinedload(JobOrder.client))
        .filter(
            JobOrder.status.in_(OPEN_JOB),
            JobOrder.archived_at.is_(None),
            JobOrder.material_status == MaterialStatus.TO_ORDER,
        )
        .order_by(JobOrder.due_date.asc())
        .all()
    )
    return [_job(j) for j in jobs if not mp_service.placed_lines(j)]


def _invoices_to_record():
    jobs = (
        JobOrder.query.options(joinedload(JobOrder.client))
        .outerjoin(SalesInvoice, SalesInvoice.job_order_id == JobOrder.id)
        .filter(JobOrder.status == JobOrderStatus.COMPLETED, SalesInvoice.id.is_(None))
        .order_by(JobOrder.due_date.asc())
        .all()
    )
    return [_job(j) for j in jobs]


def _deliveries(today):
    orders = (
        SupplierOrder.query.options(
            joinedload(SupplierOrder.supplier), joinedload(SupplierOrder.lines)
        )
        .filter(
            SupplierOrder.status.in_(
                [SupplierOrderStatus.ISSUED, SupplierOrderStatus.PARTIALLY_RECEIVED]
            ),
            SupplierOrder.expected_delivery_date.isnot(None),
            SupplierOrder.expected_delivery_date <= today + timedelta(days=DUE_SOON_DAYS),
        )
        .order_by(SupplierOrder.expected_delivery_date.asc())
        .all()
    )
    return [
        {
            "id": o.id,
            "poNumber": o.po_number,
            "supplierName": o.supplier.name if o.supplier else None,
            "expectedDeliveryDate": o.expected_delivery_date.isoformat(),
            "daysOverdue": o.days_overdue(today),
        }
        for o in orders
    ]


def _failed_emails(now):
    since = now - timedelta(days=FAILED_EMAIL_DAYS)
    logs = (
        NotificationLog.query.options(
            joinedload(NotificationLog.job_order), joinedload(NotificationLog.client)
        )
        .filter(
            NotificationLog.created_at >= since,
            NotificationLog.job_order_id.isnot(None),
            NotificationLog.milestone.isnot(None),
            NotificationLog.status.in_([NotificationStatus.FAILED, NotificationStatus.SENT]),
        )
        .order_by(NotificationLog.created_at.asc())
        .all()
    )
    latest = {}
    for log in logs:  # oldest first: the last one per job update wins
        latest[(log.job_order_id, log.milestone)] = log
    failed = [log for log in latest.values() if log.status == NotificationStatus.FAILED]
    failed.sort(key=lambda log: log.created_at, reverse=True)
    return [
        {
            "id": log.id,
            "jobOrderId": log.job_order_id,
            "jobNumber": log.job_order.job_number if log.job_order else None,
            "clientName": log.client.name if log.client else None,
            "milestone": log.milestone.value,
            "createdAt": log.created_at.isoformat(),
        }
        for log in failed
    ]


def office_summary() -> dict:
    now = shop_now()
    today = now.date()
    pending = (
        db.session.query(db.func.count(JobOrder.id))
        .filter(JobOrder.status == JobOrderStatus.DRAFT, JobOrder.archived_at.is_(None))
        .scalar()
    )
    from app.services.read_cache import get_or_build

    # The stock forecast behind this is the slow part; it changes only when
    # tools, scans or purchases do (those clear the cache).
    low = get_or_build(
        ("office-low-stock", today.isoformat()),
        lambda: low_stock_service.reorder_now_items(today)[0],
        ttl=60,
    )
    deliveries = _deliveries(today)
    return {
        "pendingJobs": int(pending or 0),
        "materialsToOrder": _materials_to_order(),
        "invoicesToRecord": _invoices_to_record(),
        "lateDeliveries": [d for d in deliveries if d["daysOverdue"] > 0],
        "deliveriesDueSoon": [d for d in deliveries if d["daysOverdue"] <= 0],
        "lowStock": low,
        "failedEmails": _failed_emails(now),
    }
