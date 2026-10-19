"""Auth rate limits shared across two app instances using the same DB (H-03)."""

from app import create_app
from app.config import Config
from app.extensions import bcrypt, db
from app.models.rate_limit import RateLimitCounter
from app.models.user import User, UserRole, UserStatus


class SharedRateConfig(Config):
    TESTING = True
    RATELIMIT_ENABLED = True
    AUTH_RATE_LIMIT_LOGIN = "3 per minute"


def test_login_lockout_shared_across_two_app_instances(app):
    """Two create_app() processes share counters via rate_limit_counters."""
    uri = app.config["SQLALCHEMY_DATABASE_URI"]
    secret = app.config["SECRET_KEY"]
    jwt_secret = app.config["JWT_SECRET_KEY"]

    class Cfg(SharedRateConfig):
        SQLALCHEMY_DATABASE_URI = uri
        SECRET_KEY = secret
        JWT_SECRET_KEY = jwt_secret

    with app.app_context():
        RateLimitCounter.query.delete()
        db.session.commit()
        user = User(
            email="twin_rate@test.local",
            mobile_number="+639171110001",
            password_hash=bcrypt.generate_password_hash("Worker123!").decode("utf-8"),
            full_name="Twin Rate",
            role=UserRole.ADMIN,
            status=UserStatus.ACTIVE,
            active=True,
        )
        db.session.add(user)
        db.session.commit()

    app_a = create_app(Cfg)
    app_b = create_app(Cfg)
    client_a = app_a.test_client()
    client_b = app_b.test_client()
    payload = {"identifier": "nobody@test.local", "password": "wrong"}

    assert client_a.post("/api/v1/auth/login", json=payload).status_code == 401
    assert client_b.post("/api/v1/auth/login", json=payload).status_code == 401
    assert client_a.post("/api/v1/auth/login", json=payload).status_code == 401

    blocked = client_b.post("/api/v1/auth/login", json=payload)
    assert blocked.status_code == 429
    assert blocked.get_json()["error"]["code"] == "RATE_LIMIT_EXCEEDED"

    with app.app_context():
        RateLimitCounter.query.delete()
        User.query.filter_by(email="twin_rate@test.local").delete()
        db.session.commit()
