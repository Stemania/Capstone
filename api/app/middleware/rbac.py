from functools import wraps

from flask import jsonify
from flask_jwt_extended import get_jwt, verify_jwt_in_request

from app.models.user import UserRole
from app.utils.errors import AppError


def require_roles(*roles):
    """Decorator enforcing server-side RBAC."""

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            claims = get_jwt()
            user_role = claims.get("role")
            if user_role not in [r.value for r in roles]:
                raise AppError("Insufficient permissions", "FORBIDDEN", 403)
            return fn(*args, **kwargs)

        return wrapper

    return decorator


def get_current_user_id():
    verify_jwt_in_request()
    return get_jwt().get("sub")


def get_current_user_role():
    verify_jwt_in_request()
    return get_jwt().get("role")


def is_admin_or_office():
    role = get_current_user_role()
    return role in (UserRole.ADMIN.value, UserRole.OFFICE_STAFF.value)
