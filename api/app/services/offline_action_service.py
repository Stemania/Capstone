"""Process each phone action once (see OfflineActionReceipt)."""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models.offline_action import OfflineActionReceipt
from app.utils.errors import AppError


def client_action_id(data: dict) -> str | None:
    value = (data or {}).get("clientActionId")
    if value in (None, ""):
        return None
    value = str(value).strip()
    if not value or len(value) > 64:
        raise AppError("clientActionId must be 1-64 characters", "VALIDATION_ERROR", 400)
    return value


def previous_result(action_id: str | None, user_id: str, action: str) -> str | None:
    """The result id if this action was already processed, else None."""
    if not action_id:
        return None
    receipt = db.session.get(OfflineActionReceipt, action_id)
    if receipt is None:
        return None
    if receipt.user_id != user_id or receipt.action != action:
        raise AppError(
            "This action id was already used for a different action.",
            "ACTION_ID_CONFLICT",
            409,
        )
    return receipt.result_id


def record(action_id: str | None, user_id: str, action: str, result_id: str) -> None:
    if not action_id:
        return
    db.session.add(
        OfflineActionReceipt(
            client_action_id=action_id, user_id=user_id, action=action, result_id=result_id
        )
    )
    try:
        db.session.commit()
    except IntegrityError:
        # Sent twice at the same moment: the other request kept the receipt.
        db.session.rollback()
