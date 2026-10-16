from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import require_roles
from app.models.user import UserRole
from app.services import notification_service as notif_service

admin_bp = Blueprint("admin", __name__)


@admin_bp.route("/notifications/test", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def send_test_notification():
    """Send one test message (respects NOTIFICATIONS_ENABLED and NOTIFY_ALLOWLIST)."""
    data = request.get_json(silent=True) or {}
    log = notif_service.send_test_message(data.get("channel"), data.get("to"))
    return jsonify(log.to_dict())
