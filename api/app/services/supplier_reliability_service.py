"""Supplier reliability (objective 4.4).

Reliability % is the share of due deliveries received on or before the date
promised when the order was placed. The 0-100 reliability score weighs three
parts of a supplier's record:

  on time      50%  on-time deliveries / due deliveries
  days late    30%  1 - (average days late of the late ones / 7), floored at 0
  lead time    20%  stated lead time / average actual lead time, capped at 1

A part with no data (no stated lead time, nothing received yet) is left out
and the other weights are scaled up to 100%. Grades: A >= 90, B >= 80,
C >= 70, D below 70. Suppliers with fewer than 3 due deliveries get no score.
"""

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
SCORE_WEIGHTS = {"onTime": 0.5, "daysLate": 0.3, "leadTime": 0.2}
DAYS_LATE_FOR_ZERO = 7
GRADE_BANDS = ((90, "A"), (80, "B"), (70, "C"))


def _deliveries(today: date):
    """One delivery per supplier order, or per line placed without a PO.

    Each is (supplier_id, promised, received_or_None, ordered_or_None);
    cancelled and draft lines are left out, and a PO counts as received when
    its last open line is.
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
            out.append((line.supplier_id, line.promised_date, line.date_received, line.date_ordered))
    for order_lines in by_order.values():
        order = order_lines[0].supplier_order
        if order.status == SupplierOrderStatus.CANCELLED:
            continue
        received = [l.date_received for l in order_lines]
        last = None if any(r is None for r in received) else max(received)
        ordered = order.date_issued or min(
            (l.date_ordered for l in order_lines if l.date_ordered), default=None
        )
        out.append((order.supplier_id, order_lines[0].promised_date, last, ordered))
    return [d for d in out if d[1] is not None]


def grade_for(score):
    if score is None:
        return None
    for floor, grade in GRADE_BANDS:
        if score >= floor:
            return grade
    return "D"


def supplier_score(on_time, due, avg_days_late, avg_actual_lead=None, stated_lead=None):
    """(score 0-100, parts) from the weighted parts; (None, parts) with nothing due.

    ``parts`` maps each part to its 0-1 value (None when it has no data).
    """
    if stated_lead is None or avg_actual_lead is None:
        lead = None
    elif avg_actual_lead <= 0:
        lead = 1.0
    else:
        lead = min(1.0, float(stated_lead) / float(avg_actual_lead))
    parts = {
        "onTime": (on_time / due) if due else None,
        "daysLate": max(0.0, 1.0 - float(avg_days_late or 0) / DAYS_LATE_FOR_ZERO) if due else None,
        "leadTime": lead,
    }
    used = {k: w for k, w in SCORE_WEIGHTS.items() if parts[k] is not None}
    if not used or parts["onTime"] is None:
        return None, parts
    total = sum(used.values())
    score = sum(parts[k] * w for k, w in used.items()) / total * 100.0
    return round(score, 1), parts


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

    def blank():
        return {"due": 0, "onTime": 0, "late": 0, "daysLate": 0, "overdue": 0, "lead": []}

    stats = defaultdict(blank)
    for supplier_id, promised, received, ordered in _deliveries(today):
        if received is None and promised >= today:
            continue
        if (from_date and promised < from_date) or (to_date and promised > to_date):
            continue
        s = stats[supplier_id]
        s["due"] += 1
        if received is not None and ordered is not None and received >= ordered:
            s["lead"].append((received - ordered).days)
        if received is not None and received <= promised:
            s["onTime"] += 1
            continue
        s["late"] += 1
        s["daysLate"] += ((received or today) - promised).days
        if received is None:
            s["overdue"] += 1

    rows = []
    for sup in Supplier.query.order_by(Supplier.name).all():
        s = stats.get(sup.id) or blank()
        enough = s["due"] >= MIN_DUE_DELIVERIES
        avg_late = round(s["daysLate"] / s["late"], 1) if s["late"] else 0.0
        avg_lead = (sum(s["lead"]) / len(s["lead"])) if s["lead"] else None
        score, parts = supplier_score(
            s["onTime"], s["due"], avg_late, avg_lead, sup.typical_lead_time_days
        )
        score = score if enough else None
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
                "avgDaysLate": avg_late,
                "enoughData": enough,
                "label": f"{round(s['onTime'] / s['due'] * 100)}% on time" if enough else NOT_ENOUGH,
                "score": score,
                "grade": grade_for(score),
                "scoreParts": {k: (round(v, 3) if v is not None else None) for k, v in parts.items()},
                "scoreWeights": SCORE_WEIGHTS,
                "statedLeadTimeDays": sup.typical_lead_time_days,
                "averageActualLeadDays": round(avg_lead, 1) if avg_lead is not None else None,
                "leadTimeSamples": len(s["lead"]),
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
