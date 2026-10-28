"""Low-stock alerts: tell the Office Staff when a consumable reaches its reorder level.

The reorder level is the computed one from ``forecast_service`` (average daily
usage x supplier lead time + safety stock). An item raises one alert while it
stays at or below that level; once it is back above (after a delivery or a
correction) its alert key is released, so the next drop alerts again.
Runs with the page-open and daily background checks. Commits.
"""

from __future__ import annotations

from app.extensions import db
from app.models.staff_alert import StaffAlert, StaffAlertKind
from app.models.tool import Tool, ToolCategory
from app.models.user import UserRole
from app.services import forecast_service, staff_alert_service


def _key(tool_id: str) -> str:
    return f"low-stock:{tool_id}"


def _qty(value) -> str:
    v = float(value or 0)
    return f"{v:g}"


def reorder_now_items(today=None) -> tuple[list[dict], list[str]]:
    """Consumables at or below their computed reorder level, and the ids of the rest."""
    tools = Tool.query.filter(
        Tool.category == ToolCategory.CONSUMABLE, Tool.active.is_(True)
    ).order_by(Tool.name).all()
    snaps = forecast_service.stock_snapshot_for_tools(tools, today)
    low, other = [], []
    for tool in tools:
        snap = snaps.get(tool.id) or {}
        if snap.get("status") == forecast_service.STOCK_REORDER and snap.get("reorderPoint") is not None:
            low.append(
                {
                    "id": tool.id,
                    "name": tool.name,
                    "unit": tool.unit or "pcs",
                    "onHand": float(tool.quantity_on_hand or 0),
                    "reorderLevel": snap["reorderPoint"],
                    "suggestedOrderQty": snap.get("suggestedOrderQty"),
                }
            )
        else:
            other.append(tool.id)
    return low, other


def check_low_stock(today=None) -> int:
    """Raise LOW_STOCK alerts for consumables at their reorder level. Returns the count."""
    low, other = reorder_now_items(today)
    raised = 0
    for item in low:
        unit = item["unit"]
        message = (
            f"{_qty(item['onHand'])} {unit} on hand, reorder level "
            f"{_qty(item['reorderLevel'])} {unit}."
        )
        if item["suggestedOrderQty"]:
            message += f" Suggested order: {_qty(item['suggestedOrderQty'])} {unit}."
        raised += len(
            staff_alert_service.raise_alert(
                roles=[UserRole.OFFICE_STAFF],
                kind=StaffAlertKind.LOW_STOCK,
                title=f"{item['name']} has reached its reorder level",
                message=message,
                dedupe_key=_key(item["id"]),
            )
        )
    released = [_key(tool_id) for tool_id in other]
    if released:
        StaffAlert.query.filter(StaffAlert.dedupe_key.in_(released)).update(
            {StaffAlert.dedupe_key: None}, synchronize_session=False
        )
    db.session.commit()
    return raised
