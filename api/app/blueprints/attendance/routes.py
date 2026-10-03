from flask import Blueprint, Response, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import get_current_user_id, require_roles
from app.models.user import UserRole
from app.services import attendance_service as svc

attendance_bp = Blueprint("attendance", __name__)


@attendance_bp.route("/day", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def day_sheet():
    return jsonify(svc.day_sheet(request.args.get("date")))


@attendance_bp.route("/workers/<worker_id>", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def worker_history(worker_id):
    return jsonify(
        svc.worker_history(worker_id, request.args.get("from"), request.args.get("to"))
    )


def _csv(body, filename):
    return Response(
        body,
        mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@attendance_bp.route("/day.csv", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def day_sheet_csv():
    sheet = svc.day_sheet(request.args.get("date"))
    return _csv(svc.rows_to_csv(sheet["rows"]), f"attendance-{sheet['date']}.csv")


@attendance_bp.route("/workers/<worker_id>.csv", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def worker_history_csv(worker_id):
    hist = svc.worker_history(worker_id, request.args.get("from"), request.args.get("to"))
    slug = "-".join(hist["workerName"].lower().split())
    return _csv(
        svc.rows_to_csv(hist["rows"]),
        f"attendance-{slug}-{hist['from']}_{hist['to']}.csv",
    )


@attendance_bp.route("/clock-in", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def clock_in():
    data = request.get_json(silent=True) or {}
    record = svc.clock_in(data, get_current_user_id())
    return jsonify(record.to_dict()), 201


@attendance_bp.route("/<record_id>/clock-out", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def clock_out(record_id):
    data = request.get_json(silent=True) or {}
    return jsonify(svc.clock_out(record_id, data, get_current_user_id()).to_dict())


@attendance_bp.route("/<record_id>", methods=["PATCH"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def update_record(record_id):
    data = request.get_json(silent=True) or {}
    return jsonify(svc.update_record(record_id, data, get_current_user_id()).to_dict())


@attendance_bp.route("/<record_id>", methods=["DELETE"])
@jwt_required()
@require_roles(UserRole.ADMIN)
def delete_record(record_id):
    svc.delete_record(record_id)
    return "", 204
