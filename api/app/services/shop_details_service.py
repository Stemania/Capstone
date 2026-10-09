"""Shop details printed on purchase orders and job orders."""

from app.extensions import db
from app.models.shop_settings import SHOP_DETAIL_FIELDS
from app.services.worker_profile_service import get_shop_settings
from app.utils.errors import AppError

REQUIRED_FIELDS = ("shopName", "address")


def get_shop_details():
    return get_shop_settings().shop_details_dict()


def update_shop_details(data: dict, actor_id: str):
    settings = get_shop_settings()
    updates = {}
    for key, attr in SHOP_DETAIL_FIELDS.items():
        if key not in data:
            continue
        value = (str(data.get(key) or "")).strip() or None
        if value is None and key in REQUIRED_FIELDS:
            raise AppError(f"{key} is required", "VALIDATION_ERROR", 400)
        column = getattr(type(settings), attr).property.columns[0]
        if value and len(value) > column.type.length:
            raise AppError(
                f"{key} is too long (max {column.type.length})", "VALIDATION_ERROR", 400
            )
        updates[attr] = value
    for attr, value in updates.items():
        setattr(settings, attr, value)
    settings.updated_by_id = actor_id
    db.session.commit()
    return settings.shop_details_dict()
