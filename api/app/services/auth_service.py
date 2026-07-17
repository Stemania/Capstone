from app.extensions import bcrypt, db
from app.models.user import User
from app.utils.errors import AppError


def authenticate_user(email, password):
    user = User.query.filter_by(email=email, active=True).first()
    if not user or not bcrypt.check_password_hash(user.password_hash, password):
        raise AppError("Invalid email or password", "INVALID_CREDENTIALS", 401)
    return user


def get_user_by_id(user_id):
    user = User.query.get(user_id)
    if not user:
        raise AppError("User not found", "NOT_FOUND", 404)
    return user


def create_user(data):
    if User.query.filter_by(email=data["email"]).first():
        raise AppError("Email already exists", "CONFLICT", 409)

    user = User(
        email=data["email"],
        password_hash=bcrypt.generate_password_hash(data["password"]).decode("utf-8"),
        full_name=data["fullName"],
        role=data["role"],
        active=data.get("active", True),
    )
    db.session.add(user)
    db.session.flush()

    if data.get("skills") is not None:
        from app.models.worker_profile import WorkerProfile

        profile = WorkerProfile(user_id=user.id, skills=data["skills"])
        db.session.add(profile)

    db.session.commit()
    return user


def update_user(user, data):
    if "email" in data and data["email"] != user.email:
        if User.query.filter_by(email=data["email"]).first():
            raise AppError("Email already exists", "CONFLICT", 409)
        user.email = data["email"]

    if "fullName" in data:
        user.full_name = data["fullName"]
    if "role" in data:
        user.role = data["role"]
    if "active" in data:
        user.active = data["active"]
    if "password" in data and data["password"]:
        user.password_hash = bcrypt.generate_password_hash(data["password"]).decode(
            "utf-8"
        )

    if "skills" in data:
        from app.models.worker_profile import WorkerProfile

        if user.worker_profile:
            user.worker_profile.skills = data["skills"]
        elif user.role.value == "PRODUCTION_WORKER":
            profile = WorkerProfile(user_id=user.id, skills=data["skills"])
            db.session.add(profile)

    db.session.commit()
    return user
