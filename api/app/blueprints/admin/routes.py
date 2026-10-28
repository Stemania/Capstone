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


@admin_bp.route("/audit-logs", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def audit_logs():
    """The audit trail: who did what, to which record, what changed, when, from where."""
    from app.services.audit_log_service import list_audit_logs

    return jsonify(list_audit_logs(request.args))


@admin_bp.route("/audit-logs/options", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def audit_log_filter_options():
    from app.services.audit_log_service import audit_log_options

    return jsonify(audit_log_options())


@admin_bp.route("/audit-logs/job-orders/<job_id>", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def job_order_audit_history(job_id):
    from app.services.audit_log_service import job_order_history

    return jsonify(job_order_history(job_id))
