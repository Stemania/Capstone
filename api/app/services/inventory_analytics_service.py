"""Inventory analytics for the Analytics → Inventory tab (objective 4.1).

Consumables: what was used in the period (QR scans), by month and by item.
Job materials (raw materials bought for job orders): what is in stock now and
how long it has sat there, what is still coming, and how stock moved
(received in, used up when the job started) month by month.

Values are quantity × unit cost: the PO line's unit cost for job materials,
the consumable's current unit cost for scans.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import joinedload

from app.constants.scheduling import SHOP_TIMEZONE
from app.extensions import db
from app.models.material_purchase import MaterialPurchase
from app.models.tool import Tool
from app.models.tool_event import ToolEvent, ToolEventType
from app.services.schedule_calendar import shop_now, utc_to_shop

# Days a received material has waited for its job to start.
AGE_BUCKETS = (
    ("0-7", "0–7 days", 0, 7),
    ("8-14", "8–14 days", 8, 14),
    ("15-30", "15–30 days", 15, 30),
    ("31+", "Over 30 days", 31, None),
)
TOP_N = 8
OLDEST_N = 5


def _f(v, places=2):
    return round(float(v or 0), places)


def _months(period_from: date, period_to: date) -> list[str]:
    out, y, m = [], period_from.year, period_from.month
    while (y, m) <= (period_to.year, period_to.month):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def _value(line: MaterialPurchase) -> Decimal:
    return Decimal(str(line.quantity or 0)) * Decimal(str(line.unit_cost or 0))


def _job_material_lines():
    return MaterialPurchase.query.options(
        joinedload(MaterialPurchase.job_order), joinedload(MaterialPurchase.supplier_order)
    ).filter(
        MaterialPurchase.job_order_id.isnot(None),
        MaterialPurchase.cancelled_at.is_(None),
    )


def _consumable_use(start_utc, end_utc):
    """Scans in the period (undone scans left out), by shop month and by item.
    Value uses the same unit cost as ABC: the latest received PO price, else the
    catalog unit cost."""
    from app.services.forecast_service import _unit_costs_batch

    shop_time = func.timezone(SHOP_TIMEZONE, ToolEvent.created_at)
    month = func.to_char(shop_time, "YYYY-MM")
    rows = (
        db.session.query(ToolEvent.tool_id, month, func.sum(ToolEvent.quantity))
        .filter(
            ToolEvent.type == ToolEventType.SCAN,
            ToolEvent.undone_at.is_(None),
            ToolEvent.tool_id.isnot(None),
            ToolEvent.created_at >= start_utc,
            ToolEvent.created_at < end_utc,
        )
        .group_by(ToolEvent.tool_id, month)
        .all()
    )
    tools = {t.id: t for t in Tool.query.filter(Tool.id.in_({r[0] for r in rows})).all()} if rows else {}
    cost = _unit_costs_batch(list(tools.values()))
    by_month: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
    by_item: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for tool_id, m, qty in rows:
        q = float(qty or 0)
        v = q * cost.get(tool_id, 0.0)
        by_month[m][0] += q
        by_month[m][1] += v
        by_item[tool_id][0] += q
        by_item[tool_id][1] += v
    ranked = sorted(by_item.items(), key=lambda kv: (-kv[1][1], -kv[1][0]))
    items = [
        (tid, tools[tid].name, tools[tid].size_spec, tools[tid].unit, q, v)
        for tid, (q, v) in ranked
        if tid in tools
    ]
    total_qty = sum(q for q, _v in by_month.values())
    total_value = sum(v for _q, v in by_month.values())
    return by_month, items, total_qty, total_value


def inventory_summary(from_s=None, to_s=None) -> dict:
    from app.services.analytics_service import _parse_period

    period_from, period_to, start_utc, end_utc = _parse_period(from_s, to_s)
    today = shop_now().date()
    months = _months(period_from, period_to)

    # Consumables used (scans).
    use_by_month, use_by_item, use_qty, use_value = _consumable_use(start_utc, end_utc)

    # Job materials moving through stock in the period.
    received = defaultdict(Decimal)
    consumed = defaultdict(Decimal)
    dwell_days: list[int] = []
    for ln in _job_material_lines().filter(
        db.or_(
            MaterialPurchase.date_received.between(period_from, period_to),
            MaterialPurchase.consumed_at.between(start_utc, end_utc),
        )
    ):
        if ln.date_received and period_from <= ln.date_received <= period_to:
            received[ln.date_received.strftime("%Y-%m")] += _value(ln)
        if ln.consumed_at:
            used_on = utc_to_shop(ln.consumed_at).date()
            if period_from <= used_on <= period_to:
                consumed[used_on.strftime("%Y-%m")] += _value(ln)
                if ln.date_received:
                    dwell_days.append(max((used_on - ln.date_received).days, 0))

    # Job materials in stock now, and on order.
    on_hand = (
        _job_material_lines()
        .filter(MaterialPurchase.date_received.isnot(None), MaterialPurchase.consumed_at.is_(None))
        .all()
    )
    incoming = (
        _job_material_lines()
        .filter(MaterialPurchase.date_ordered.isnot(None), MaterialPurchase.date_received.is_(None))
        .all()
    )
    incoming = [ln for ln in incoming if not ln.is_draft]

    buckets = {key: {"key": key, "label": label, "lines": 0, "value": Decimal("0")}
               for key, label, _lo, _hi in AGE_BUCKETS}
    aged = []
    for ln in on_hand:
        days = max((today - ln.date_received).days, 0)
        for key, _label, lo, hi in AGE_BUCKETS:
            if days >= lo and (hi is None or days <= hi):
                buckets[key]["lines"] += 1
                buckets[key]["value"] += _value(ln)
                break
        aged.append((days, ln))
    aged.sort(key=lambda t: (-t[0], -float(_value(t[1]))))

    overdue = [ln for ln in incoming if ln.days_overdue(today) > 0]

    return {
        "from": period_from.isoformat(),
        "to": period_to.isoformat(),
        "today": today.isoformat(),
        "months": [
            {
                "month": m,
                "consumableUseQty": _f(use_by_month.get(m, (0, 0))[0], 1),
                "consumableUseValue": _f(use_by_month.get(m, (0, 0))[1]),
                "materialReceivedValue": _f(received.get(m)),
                "materialConsumedValue": _f(consumed.get(m)),
            }
            for m in months
        ],
        "consumables": {
            "useQty": _f(use_qty, 1),
            "useValue": _f(use_value),
            "itemsUsed": len(use_by_item),
            "topByValue": [
                {
                    "toolId": tid,
                    "name": name,
                    "sizeSpec": size,
                    "unit": unit,
                    "quantity": _f(q, 1),
                    "value": _f(v),
                }
                for tid, name, size, unit, q, v in use_by_item[:TOP_N]
            ],
        },
        "materials": {
            "onHandLines": len(on_hand),
            "onHandValue": _f(sum((_value(ln) for ln in on_hand), Decimal("0"))),
            "incomingLines": len(incoming),
            "incomingValue": _f(sum((_value(ln) for ln in incoming), Decimal("0"))),
            "incomingOverdueLines": len(overdue),
            "receivedValue": _f(sum(received.values(), Decimal("0"))),
            "consumedValue": _f(sum(consumed.values(), Decimal("0"))),
            "avgDaysInStock": round(sum(dwell_days) / len(dwell_days), 1) if dwell_days else None,
            "daysInStockSamples": len(dwell_days),
            "ageBuckets": [
                {**b, "value": _f(b["value"])} for b in buckets.values()
            ],
            "oldestOnHand": [
                {
                    "id": ln.id,
                    "materialName": ln.material_name,
                    "gradeOrSpec": ln.grade_or_spec,
                    "sizeSpec": ln.size_spec,
                    "quantity": _f(ln.quantity),
                    "unit": ln.unit,
                    "value": _f(_value(ln)),
                    "dateReceived": ln.date_received.isoformat(),
                    "daysInStock": days,
                    "jobOrderId": ln.job_order_id,
                    "jobNumber": ln.job_order.job_number if ln.job_order else None,
                    "jobStatus": ln.job_order.status.value if ln.job_order else None,
                }
                for days, ln in aged[:OLDEST_N]
            ],
        },
    }
