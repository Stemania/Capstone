"""SQLAlchemy audit listeners for JobOrder, JobOperation, User, Tool."""

from flask import has_request_context, request
from flask_jwt_extended import get_jwt, get_jwt_identity, verify_jwt_in_request

from app.extensions import db
from app.models.audit_log import AuditLog
from app.models.job_order import JobOrder
from app.models.operation import JobOperation
from app.models.operation_time import MachineDowntime, OperationTimeLog
from app.models.tool import Tool
from app.models.user import User


_REGISTERED = False


def _safe_dict(obj):
    try:
        if hasattr(obj, "to_dict"):
            # Prefer richer dicts when available
            try:
                return obj.to_dict(include_operations=False)
            except TypeError:
                try:
                    return obj.to_dict(include_custody=False)
                except TypeError:
                    return obj.to_dict()
    except Exception:
        pass
    return {"id": getattr(obj, "id", None)}


def _actor():
    user_id = None
    user_role = None
    ip = None
    if has_request_context():
        ip = request.headers.get("X-Forwarded-For", request.remote_addr)
        try:
            verify_jwt_in_request(optional=True)
            user_id = get_jwt_identity()
            claims = get_jwt() or {}
            user_role = claims.get("role")
        except Exception:
            pass
    return user_id, user_role, ip


def _log(action, entity_type, entity_id, before=None, after=None):
    user_id, user_role, ip = _actor()
    entry = AuditLog(
        user_id=user_id,
        user_role=user_role,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id else None,
        before_json=before,
        after_json=after,
        ip_address=ip,
    )
    # Use a nested transaction / separate add; flush with parent session
    db.session.add(entry)


def _entity_type(obj):
    return obj.__class__.__name__


def _after_insert(mapper, connection, target):
    _log("CREATE", _entity_type(target), getattr(target, "id", None), before=None, after=_safe_dict(target))


def _after_update(mapper, connection, target):
    _log("UPDATE", _entity_type(target), getattr(target, "id", None), before=None, after=_safe_dict(target))


def _after_delete(mapper, connection, target):
    _log("DELETE", _entity_type(target), getattr(target, "id", None), before=_safe_dict(target), after=None)


def register_audit_listeners():
    global _REGISTERED
    if _REGISTERED:
        return
    from sqlalchemy import event

    for model in (JobOrder, JobOperation, User, Tool, OperationTimeLog, MachineDowntime):
        event.listen(model, "after_insert", _after_insert)
        event.listen(model, "after_update", _after_update)
        event.listen(model, "after_delete", _after_delete)
    _REGISTERED = True
