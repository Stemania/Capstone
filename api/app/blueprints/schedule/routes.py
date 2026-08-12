from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import require_roles
from app.models.user import UserRole
from app.services import board_service

schedule_bp = Blueprint("schedule", __name__)


def _bool_arg(name: str, default: bool = True) -> bool:
    raw = request.args.get(name)
    if raw is None or raw == "":
        return default
    return str(raw).lower() in ("1", "true", "yes", "on")


@schedule_bp.route("/board", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF, UserRole.PRODUCTION_WORKER)
def board():
    return jsonify(
        board_service.schedule_board(
            from_s=request.args.get("from"),
            to_s=request.args.get("to"),
            machine_type_id=request.args.get("machineTypeId")
            or request.args.get("machine_type_id"),
            worker_id=request.args.get("workerId") or request.args.get("worker_id"),
            client_id=request.args.get("clientId") or request.args.get("client_id"),
            include_completed=_bool_arg("includeCompleted", True),
        )
    )
