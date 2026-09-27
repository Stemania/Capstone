from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.extensions import db
from app.middleware.rbac import require_roles
from app.models.client import Client
from app.models.user import UserRole
from app.utils.errors import AppError

clients_bp = Blueprint("clients", __name__)


def _parse_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def _apply_client_fields(client: Client, data: dict, *, creating: bool = False):
    if "name" in data or creating:
        name = (data.get("name") or "").strip()
        if not name:
            raise AppError("Name is required", "VALIDATION_ERROR", 400)
        client.name = name
    if "contact" in data:
        client.contact = data.get("contact") or None
    if "email" in data:
        email = (data.get("email") or "").strip()
        client.email = email or None
    if "mobileNumber" in data or "mobile_number" in data:
        mobile = (data.get("mobileNumber") or data.get("mobile_number") or "").strip()
        client.mobile_number = mobile or None
    if "notifyByEmail" in data or "notify_by_email" in data:
        client.notify_by_email = _parse_bool(
            data.get("notifyByEmail", data.get("notify_by_email")), False
        )
    if "notifyBySms" in data or "notify_by_sms" in data:
        client.notify_by_sms = _parse_bool(
            data.get("notifyBySms", data.get("notify_by_sms")), False
        )


@clients_bp.route("", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def list_clients():
    search = request.args.get("search", "")
    query = Client.query
    if search:
        query = query.filter(Client.name.ilike(f"%{search}%"))
    clients = query.order_by(Client.name).all()
    return jsonify([c.to_dict() for c in clients])


@clients_bp.route("", methods=["POST"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def create_client():
    data = request.get_json() or {}
    client = Client(
        name="",
        contact=None,
        email=None,
        mobile_number=None,
        notify_by_email=False,
        notify_by_sms=False,
    )
    _apply_client_fields(client, data, creating=True)
    db.session.add(client)
    db.session.commit()
    return jsonify(client.to_dict()), 201


@clients_bp.route("/<client_id>", methods=["GET"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def get_client(client_id):
    from app.models.job_order import PRODUCTION_STATUSES, JobOrder, JobOrderStatus
    from app.services.schedule_calendar import SHOP_TZ

    client = Client.query.get(client_id)
    if not client:
        raise AppError("Client not found", "NOT_FOUND", 404)

    jobs = (
        JobOrder.query.filter_by(client_id=client_id)
        .order_by(JobOrder.created_at.desc())
        .all()
    )
    job_rows = []
    total_value = 0.0
    for job in jobs:
        year = job.created_at.year if job.created_at else None
        short = (job.id or "")[:4].upper()
        job_number = f"JO-{year}-{short}" if year else None
        amount = float(job.amount) if job.amount is not None else None
        if amount is not None and job.status in PRODUCTION_STATUSES:
            total_value += amount

        on_time = None
        if job.delivered_at and job.due_date:
            done = job.delivered_at.astimezone(SHOP_TZ).date()
            on_time = done <= job.due_date
        elif job.status == JobOrderStatus.COMPLETED:
            on_time = None  # awaiting delivery

        job_rows.append(
            {
                "id": job.id,
                "jobNumber": job_number,
                "title": job.title,
                "createdAt": job.created_at.isoformat() if job.created_at else None,
                "dueDate": job.due_date.isoformat() if job.due_date else None,
                "amount": amount,
                "status": job.status.value,
                "deliveredAt": (
                    job.delivered_at.isoformat() if job.delivered_at else None
                ),
                "deliveredOnTime": on_time,
            }
        )

    payload = client.to_dict()
    payload["jobs"] = job_rows
    payload["totals"] = {
        "jobCount": len(job_rows),
        "totalValue": round(total_value, 2),
    }
    return jsonify(payload)


@clients_bp.route("/<client_id>", methods=["PATCH"])
@jwt_required()
@require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
def update_client(client_id):
    client = Client.query.get(client_id)
    if not client:
        raise AppError("Client not found", "NOT_FOUND", 404)
    data = request.get_json() or {}
    _apply_client_fields(client, data, creating=False)
    db.session.commit()
    return jsonify(client.to_dict())
