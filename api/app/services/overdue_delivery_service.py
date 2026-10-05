"""Overdue supplier deliveries.

A placed line is overdue when its current expected date has passed and it has
not been received or cancelled. It stays pending: its job's material date
becomes tomorrow at the earliest (see ``line_expected_arrival``), so the job's
unstarted operations move later through the material delay rescheduling,
recorded as a MATERIAL move.

``check_overdue_deliveries`` runs when the API starts, once a day, and when the
job orders, supplier orders or schedule pages are opened. It is safe to run
repeatedly: jobs already placed after the material date do not move, and each
overdue order raises one Office Staff alert per expected date. The same runs
also sweep released jobs for at-risk alerts (``completion_estimate_service``).
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta

from app.extensions import db
from app.models.material_purchase import MaterialPurchase
from app.models.staff_alert import StaffAlertKind
from app.models.user import UserRole
from app.services import material_delay_service as delay_service
from app.services import staff_alert_service
from app.services.schedule_calendar import SHOP_TZ, shop_now

log = logging.getLogger(__name__)
_lock = threading.Lock()


def overdue_lines(today=None) -> list[MaterialPurchase]:
    today = today or shop_now().date()
    candidates = MaterialPurchase.query.filter(
        MaterialPurchase.date_received.is_(None),
        MaterialPurchase.cancelled_at.is_(None),
        MaterialPurchase.date_ordered.isnot(None),
    ).all()
    return [p for p in candidates if p.days_overdue(today) > 0]


def _days(n: int) -> str:
    return f"{n} day{'' if n == 1 else 's'}"


def _alert(group: list[MaterialPurchase], today) -> None:
    first = group[0]
    order = first.supplier_order
    expected = first.current_expected_date
    days = max(p.days_overdue(today) for p in group)
    supplier = first.supplier.name if first.supplier else "Supplier"
    jobs = sorted({p.job_order.job_number for p in group if p.job_order})
    materials = ", ".join(sorted({p.material_name for p in group}))
    if order is not None:
        title = f"{order.po_number or 'Supplier order'} from {supplier} is {_days(days)} late"
        key = f"delivery-overdue:{order.id}:{expected.isoformat()}"
    else:
        title = f"{materials} from {supplier} is {_days(days)} late"
        key = f"delivery-overdue:line:{first.id}:{expected.isoformat()}"
    staff_alert_service.raise_alert(
        roles=[UserRole.OFFICE_STAFF],
        kind=StaffAlertKind.DELIVERY_OVERDUE,
        title=title,
        message=(
            f"Expected {expected.strftime('%d %b %Y')}, not received yet ({materials}; "
            f"for {', '.join(jobs) or 'no job'}). Follow up with {supplier}."
        ),
        job_order_id=first.job_order_id if order is None else None,
        supplier_order_id=order.id if order is not None else None,
        dedupe_key=key,
    )


def check_overdue_deliveries(today=None) -> dict:
    """Move affected jobs (MATERIAL) and alert Office Staff. Commits."""
    with _lock:
        today = today or shop_now().date()
        lines = overdue_lines(today)

        groups: dict = {}
        for p in lines:
            key = ("order", p.supplier_order_id) if p.supplier_order_id else ("line", p.id)
            groups.setdefault(key, []).append(p)
        try:
            for group in groups.values():
                _alert(group, today)
            db.session.commit()
        except Exception:
            db.session.rollback()
            log.exception("Overdue delivery alerts failed")

        jobs = {p.job_order for p in lines if p.job_order is not None}
        outcomes = delay_service.reschedule_jobs(jobs, delay_service.OVERDUE)
        return {
            "overdueLines": len(lines),
            "overdueOrders": len(groups),
            "movedJobs": [o for o in outcomes if o["outcome"] == "MOVED"],
            "notMovedJobs": [o for o in outcomes if o["outcome"] == "NO_SLOT"],
        }


def _seconds_until_next_run(now=None) -> float:
    now = now or datetime.now(SHOP_TZ)
    nxt = (now + timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0)
    return max((nxt - now).total_seconds(), 60.0)


def start_background_checks(app) -> None:
    """Check now (API start), then shortly after midnight shop time every day."""
    if app.config.get("TESTING"):
        return

    def _loop():
        while True:
            try:
                with app.app_context():
                    result = check_overdue_deliveries()
                    app.logger.info(
                        "overdue_check lines=%s orders=%s moved=%s",
                        result["overdueLines"],
                        result["overdueOrders"],
                        len(result["movedJobs"]),
                    )
            except Exception:
                app.logger.exception("Overdue delivery check failed")
            try:
                with app.app_context():
                    from app.services.completion_estimate_service import check_released_jobs

                    app.logger.info("at_risk_check alerts=%s", check_released_jobs())
            except Exception:
                app.logger.exception("At-risk check failed")
            time.sleep(_seconds_until_next_run())

    threading.Thread(target=_loop, name="overdue-delivery-check", daemon=True).start()
