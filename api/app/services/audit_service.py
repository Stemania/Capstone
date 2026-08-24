"""SQLAlchemy audit listeners for JobOrder, JobOperation, User, Tool."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from flask import has_request_context, request
from flask_jwt_extended import get_jwt, get_jwt_identity, verify_jwt_in_request
from sqlalchemy import event, insert
from sqlalchemy.orm import Session

from app.extensions import db
from app.models.audit_log import AuditLog
from app.models.client import Client
from app.models.job_order import JobOrder
from app.models.notification import NotificationLog
from app.models.operation import JobOperation
from app.models.operation_time import MachineDowntime, OperationTimeLog
from app.models.tool import Tool
from app.models.user import User


_REGISTERED = False
_PENDING_KEY = "pending_audit_logs"


def _utcnow():
    return datetime.now(timezone.utc)


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


def _row_values(action, entity_type, entity_id, before=None, after=None):
    user_id, user_role, ip = _actor()
    return {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "user_role": user_role,
        "action": action,
        "entity_type": entity_type,
        "entity_id": str(entity_id) if entity_id else None,
        "before_json": before,
        "after_json": after,
        "ip_address": ip,
        "created_at": _utcnow(),
    }


def _insert_audit(connection, values: dict) -> None:
    """Write an audit row on the given connection (same transaction, no Session.add)."""
    connection.execute(insert(AuditLog.__table__), values)


def _log(action, entity_type, entity_id, before=None, after=None):
    """Explicit / non-mapper audit writes.

    If the Session is mid-flush, queue the row and insert after flush completes.
    Otherwise insert immediately via the current connection.
    """
    values = _row_values(action, entity_type, entity_id, before=before, after=after)
    session = db.session
    if getattr(session, "_flushing", False):
        session.info.setdefault(_PENDING_KEY, []).append(values)
        return
    _insert_audit(session.connection(), values)


def write_audit_event(action, entity_type, entity_id=None, before=None, after=None):
    """Explicit security/audit events (invitation, PIN, password, etc.)."""
    _log(action, entity_type, entity_id, before=before, after=after)


def _entity_type(obj):
    return obj.__class__.__name__


def _after_insert(mapper, connection, target):
    _insert_audit(
        connection,
        _row_values(
            "CREATE",
            _entity_type(target),
            getattr(target, "id", None),
            before=None,
            after=_safe_dict(target),
        ),
    )


def _after_update(mapper, connection, target):
    _insert_audit(
        connection,
        _row_values(
            "UPDATE",
            _entity_type(target),
            getattr(target, "id", None),
            before=None,
            after=_safe_dict(target),
        ),
    )


def _after_delete(mapper, connection, target):
    _insert_audit(
        connection,
        _row_values(
            "DELETE",
            _entity_type(target),
            getattr(target, "id", None),
            before=_safe_dict(target),
            after=None,
        ),
    )


def _after_flush_postexec(session, flush_context):
    pending = session.info.pop(_PENDING_KEY, None)
    if not pending:
        return
    connection = session.connection()
    for values in pending:
        _insert_audit(connection, values)


def register_audit_listeners():
    global _REGISTERED
    if _REGISTERED:
        return

    for model in (
        JobOrder,
        JobOperation,
        User,
        Tool,
        OperationTimeLog,
        MachineDowntime,
        Client,
        NotificationLog,
    ):
        event.listen(model, "after_insert", _after_insert)
        event.listen(model, "after_update", _after_update)
        event.listen(model, "after_delete", _after_delete)

    event.listen(Session, "after_flush_postexec", _after_flush_postexec)
    _REGISTERED = True
