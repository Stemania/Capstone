from app.extensions import bcrypt, db
from app.models.user import User, UserRole, UserStatus
from app.services.audit_service import write_audit_event
from app.services.device_pin_service import revoke_all_devices_for_user
from app.utils.errors import AppError
from app.utils.passwords import validate_password
from app.utils.phone import looks_like_email, looks_like_mobile, normalize_ph_mobile

GENERIC_LOGIN_ERROR = AppError(
    "Invalid email/mobile or password", "INVALID_CREDENTIALS", 401
)


def _find_user_by_identifier(identifier: str) -> User | None:
    raw = (identifier or "").strip()
    if not raw:
        return None
    if looks_like_email(raw):
        return User.query.filter_by(email=raw.lower()).first()
    if looks_like_mobile(raw):
        try:
            mobile = normalize_ph_mobile(raw, required=True)
        except AppError:
            return None
        return User.query.filter_by(mobile_number=mobile).first()
    user = User.query.filter_by(email=raw.lower()).first()
    if user:
        return user
    try:
        mobile = normalize_ph_mobile(raw, required=True)
    except AppError:
        return None
    return User.query.filter_by(mobile_number=mobile).first()


def authenticate_user(identifier: str, password: str) -> User:
    user = _find_user_by_identifier(identifier)
    if (
        not user
        or user.status != UserStatus.ACTIVE
        or not user.password_hash
        or not password
        or not bcrypt.check_password_hash(user.password_hash, password)
    ):
        raise GENERIC_LOGIN_ERROR
    return user


def get_user_by_id(user_id):
    user = User.query.get(user_id)
    if not user:
        raise AppError("User not found", "NOT_FOUND", 404)
    return user


def create_user(data):
    """Removed from the admin path. Use invitation_service.create_invited_user."""
    raise AppError(
        "Direct user create is disabled; use the invitation flow",
        "GONE",
        410,
    )


def update_user(user, data):
    role_changed = "role" in data and data["role"] != user.role
    if role_changed and user.role == UserRole.ADMIN:
        other_admins = User.query.filter(
            User.role == UserRole.ADMIN,
            User.status != UserStatus.DISABLED,
            User.id != user.id,
        ).count()
        if other_admins == 0:
            raise AppError(
                "This is the last Admin. Make another user an Admin before changing this role.",
                "LAST_ADMIN",
                409,
            )

    if "email" in data:
        email = (data["email"] or "").strip().lower() or None
        if email != user.email:
            if email and User.query.filter_by(email=email).first():
                raise AppError("Email already exists", "CONFLICT", 409)
            user.email = email

    if "nickname" in data:
        user.nickname = (data["nickname"] or "").strip()[:40] or None

    if "mobileNumber" in data:
        mobile = normalize_ph_mobile(data["mobileNumber"], required=False)
        if mobile:
            other = User.query.filter_by(mobile_number=mobile).first()
            if other and other.id != user.id:
                raise AppError("Mobile number already exists", "CONFLICT", 409)
        user.mobile_number = mobile

    if "fullName" in data:
        user.full_name = data["fullName"]
    if role_changed:
        user.role = data["role"]

    if "status" in data:
        user.status = (
            data["status"]
            if isinstance(data["status"], UserStatus)
            else UserStatus(data["status"])
        )
        user.sync_active_flag()
    elif "active" in data:
        if data["active"]:
            if user.status == UserStatus.DISABLED:
                user.status = (
                    UserStatus.ACTIVE if user.password_hash else UserStatus.INVITED
                )
        else:
            user.status = UserStatus.DISABLED
        user.sync_active_flag()

    if "password" in data and data["password"]:
        validate_password(data["password"])
        user.password_hash = bcrypt.generate_password_hash(data["password"]).decode(
            "utf-8"
        )
        if user.status == UserStatus.INVITED:
            user.status = UserStatus.ACTIVE
            user.sync_active_flag()
        write_audit_event("PASSWORD_CHANGED", "User", user.id)
        db.session.flush()
        revoke_all_devices_for_user(user.id)
        return user

    from app.services.worker_profile_service import ensure_worker_profile

    if user.role in (UserRole.PRODUCTION_WORKER, UserRole.ADMIN):
        ensure_worker_profile(user)

    db.session.commit()
    if role_changed:
        revoke_all_devices_for_user(user.id)
    return user


def change_own_password(user: User, current_password: str, new_password: str) -> User:
    if not user.password_hash or not bcrypt.check_password_hash(
        user.password_hash, current_password
    ):
        raise AppError("Current password is incorrect", "INVALID_CREDENTIALS", 401)
    validate_password(new_password)
    user.password_hash = bcrypt.generate_password_hash(new_password).decode("utf-8")
    write_audit_event("PASSWORD_CHANGED", "User", user.id)
    db.session.flush()
    revoke_all_devices_for_user(user.id)
    return user
