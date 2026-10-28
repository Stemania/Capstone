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


def check_low_stock(today=None) -> int:
    """Raise LOW_STOCK alerts for consumables at their reorder level. Returns the count."""
    tools = Tool.query.filter(
        Tool.category == ToolCategory.CONSUMABLE, Tool.active.is_(True)
    ).all()
    snaps = forecast_service.stock_snapshot_for_tools(tools, today)
    raised = 0
    released = []
    for tool in tools:
        snap = snaps.get(tool.id) or {}
        if snap.get("status") == forecast_service.STOCK_REORDER and snap.get("reorderPoint") is not None:
            unit = tool.unit or "pcs"
            order = snap.get("suggestedOrderQty")
            message = (
                f"{_qty(tool.quantity_on_hand)} {unit} on hand, reorder level "
                f"{_qty(snap['reorderPoint'])} {unit}."
            )
            if order:
                message += f" Suggested order: {_qty(order)} {unit}."
            raised += len(
                staff_alert_service.raise_alert(
                    roles=[UserRole.OFFICE_STAFF],
                    kind=StaffAlertKind.LOW_STOCK,
                    title=f"{tool.name} has reached its reorder level",
                    message=message,
                    dedupe_key=_key(tool.id),
                )
            )
        else:
            released.append(_key(tool.id))
    if released:
        StaffAlert.query.filter(StaffAlert.dedupe_key.in_(released)).update(
            {StaffAlert.dedupe_key: None}, synchronize_session=False
        )
    db.session.commit()
    return raised
