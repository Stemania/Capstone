"""Supplier reliability (objective 4.4): share of due deliveries received on or
before the date promised when the order was placed."""

from __future__ import annotations

from collections import defaultdict
from datetime import date

from sqlalchemy.orm import joinedload

from app.models.material_purchase import MaterialPurchase
from app.models.supplier import Supplier
from app.models.supplier_order import SupplierOrderStatus
from app.services.schedule_calendar import shop_now

MIN_DUE_DELIVERIES = 3
NOT_ENOUGH = "Not enough deliveries"


def _deliveries(today: date):
    """One delivery per supplier order, or per line placed without a PO.

    Each is (supplier_id, promised, received_or_None); cancelled and draft
    lines are left out, and a PO counts as received when its last open line is.
    """
    lines = (
        MaterialPurchase.query.options(
            joinedload(MaterialPurchase.supplier_order),
            joinedload(MaterialPurchase.supplier),
        )
        .filter(MaterialPurchase.cancelled_at.is_(None))
        .all()
    )
    by_order = defaultdict(list)
    out = []
    for line in lines:
        if not line.counts_as_ordered:
            continue
        if line.supplier_order_id:
            by_order[line.supplier_order_id].append(line)
        else:
            out.append((line.supplier_id, line.promised_date, line.date_received))
    for order_lines in by_order.values():
        order = order_lines[0].supplier_order
        if order.status == SupplierOrderStatus.CANCELLED:
            continue
        received = [l.date_received for l in order_lines]
        last = None if any(r is None for r in received) else max(received)
        out.append((order.supplier_id, order_lines[0].promised_date, last))
    return [d for d in out if d[1] is not None]


def supplier_reliability(
    today: date | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
) -> list[dict]:
    """Every supplier, ranked by reliability then average days late.

    A delivery is due once its promised date has passed or it has arrived.
    Late = received after the promised date, or not received and overdue.
    With a date range, only deliveries promised inside it count (all history
    otherwise); the minimum of 3 due deliveries applies within the range.
    """
    today = today or shop_now().date()
    stats = defaultdict(lambda: {"due": 0, "onTime": 0, "late": 0, "daysLate": 0, "overdue": 0})
    for supplier_id, promised, received in _deliveries(today):
        if received is None and promised >= today:
            continue
        if (from_date and promised < from_date) or (to_date and promised > to_date):
            continue
        s = stats[supplier_id]
        s["due"] += 1
        if received is not None and received <= promised:
            s["onTime"] += 1
            continue
        s["late"] += 1
        s["daysLate"] += ((received or today) - promised).days
        if received is None:
            s["overdue"] += 1

    rows = []
    for sup in Supplier.query.order_by(Supplier.name).all():
        s = stats.get(sup.id, {"due": 0, "onTime": 0, "late": 0, "daysLate": 0, "overdue": 0})
        enough = s["due"] >= MIN_DUE_DELIVERIES
        rows.append(
            {
                "supplierId": sup.id,
                "supplierName": sup.name,
                "active": bool(sup.active),
                "dueDeliveries": s["due"],
                "onTimeDeliveries": s["onTime"],
                "lateDeliveries": s["late"],
                "overdueDeliveries": s["overdue"],
                "reliabilityPct": round(s["onTime"] / s["due"] * 100, 1) if enough else None,
                "avgDaysLate": round(s["daysLate"] / s["late"], 1) if s["late"] else 0.0,
                "enoughData": enough,
                "label": f"{round(s['onTime'] / s['due'] * 100)}% on time" if enough else NOT_ENOUGH,
            }
        )
    rows.sort(
        key=lambda r: (
            not r["enoughData"],
            -(r["reliabilityPct"] or 0),
            r["avgDaysLate"],
            r["supplierName"].lower(),
        )
    )
    rank = 0
    for r in rows:
        if r["enoughData"]:
            rank += 1
            r["rank"] = rank
        else:
            r["rank"] = None
    return rows
