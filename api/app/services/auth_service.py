from app.extensions import bcrypt, db
from app.models.user import User, UserRole, UserStatus
from app.models.worker_profile import WorkerProfile
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
    if "email" in data and data["email"] != user.email:
        if User.query.filter_by(email=data["email"].strip().lower()).first():
            raise AppError("Email already exists", "CONFLICT", 409)
        user.email = data["email"].strip().lower()

    if "mobileNumber" in data:
        mobile = normalize_ph_mobile(data["mobileNumber"], required=False)
        if mobile:
            other = User.query.filter_by(mobile_number=mobile).first()
            if other and other.id != user.id:
                raise AppError("Mobile number already exists", "CONFLICT", 409)
        user.mobile_number = mobile

    if "fullName" in data:
        user.full_name = data["fullName"]
    if "role" in data:
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

    if user.role == UserRole.PRODUCTION_WORKER and not user.worker_profile:
        db.session.add(WorkerProfile(user_id=user.id))

    db.session.commit()
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
