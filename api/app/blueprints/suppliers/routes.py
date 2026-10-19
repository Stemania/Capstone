from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import require_roles
from app.models.user import UserRole
from app.services import supplier_service as svc

suppliers_bp = Blueprint("suppliers", __name__)


@suppliers_bp.route("", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def list_suppliers():
    active_only = str(request.args.get("activeOnly", "")).lower() in (
        "1",
        "true",
        "yes",
    )
    search = request.args.get("search") or None
    rows = svc.list_suppliers(active_only=active_only, search=search)
    return jsonify([s.to_dict() for s in rows])


@suppliers_bp.route("/reliability", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def supplier_reliability():
    from datetime import date

    from app.services.supplier_reliability_service import supplier_reliability
    from app.utils.errors import AppError

    def _date(key):
        raw = request.args.get(key)
        if not raw:
            return None
        try:
            return date.fromisoformat(raw)
        except ValueError:
            raise AppError(f"{key} must be YYYY-MM-DD", "VALIDATION_ERROR", 400)

    return jsonify(supplier_reliability(from_date=_date("from"), to_date=_date("to")))


@suppliers_bp.route("/<supplier_id>", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def get_supplier(supplier_id):
    return jsonify(svc.get_supplier(supplier_id).to_dict())


@suppliers_bp.route("", methods=["POST"])
@jwt_required()
@require_roles(UserRole.OFFICE_STAFF)
def create_supplier():
    data = request.get_json() or {}
    s = svc.create_supplier(data)
    return jsonify(s.to_dict()), 201


@suppliers_bp.route("/<supplier_id>", methods=["PATCH"])
@jwt_required()
@require_roles(UserRole.OFFICE_STAFF)
def update_supplier(supplier_id):
    data = request.get_json() or {}
    s = svc.update_supplier(supplier_id, data)
    return jsonify(s.to_dict())
