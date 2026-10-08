import logging

import click
import uuid
from datetime import datetime, timezone

from flask import Flask
from flask_cors import CORS
from flask_migrate import Migrate
from werkzeug.middleware.proxy_fix import ProxyFix

from app.extensions import bcrypt, db, jwt, limiter, resolve_ratelimit_storage_uri
from app.utils.errors import register_error_handlers
from app.utils.request_metrics import init_request_metrics


def create_app(config_object=None):
    app = Flask(__name__)

    if config_object:
        app.config.from_object(config_object)
    else:
        from app.config import Config

        app.config.from_object(Config)

    _assert_production_secrets(app)

    proxies = int(app.config.get("TRUSTED_PROXY_COUNT", 1) or 0)
    if proxies > 0:
        # Render's proxy appends the client address to X-Forwarded-For; trust
        # exactly that many hops so rate limits key on the real client.
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=proxies, x_proto=proxies)

    app.config["RATELIMIT_STORAGE_URI"] = resolve_ratelimit_storage_uri(app)
    app.config.setdefault("RATELIMIT_SWALLOW_ERRORS", True)
    app.config.setdefault("RATELIMIT_IN_MEMORY_FALLBACK_ENABLED", True)

    db.init_app(app)
    migrate = Migrate(app, db)
    jwt.init_app(app)
    bcrypt.init_app(app)
    limiter.init_app(app)

    cors_origins = app.config.get("CORS_ORIGINS", "http://localhost:5173")
    if isinstance(cors_origins, str):
        cors_origins = [o.strip() for o in cors_origins.split(",")]
    CORS(app, origins=cors_origins, supports_credentials=True)


    if not app.logger.level:
        app.logger.setLevel(logging.INFO)
    init_request_metrics(app)

    @app.route("/api/v1/health", methods=["GET", "HEAD"])
    def health():
        return {"status": "ok"}

    @app.after_request
    def _security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        if app.config.get("ENV") == "production":
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        return response

    register_error_handlers(app)
    _register_blueprints(app)
    _register_cli(app)

    from app.services.audit_service import register_audit_listeners

    register_audit_listeners()

    # Work out the model relationships once, here, rather than lazily on the
    # first query while request threads and the background checks start at once.
    import app.models as _models  # noqa: F401
    from sqlalchemy.orm import configure_mappers

    configure_mappers()

    return app


def _assert_production_secrets(app):
    from app.config import DEV_JWT_SECRET_KEY, DEV_SECRET_KEY

    if app.config.get("TESTING") or app.config.get("ENV") != "production":
        return
    missing = [
        name
        for name, dev_value in (
            ("SECRET_KEY", DEV_SECRET_KEY),
            ("JWT_SECRET_KEY", DEV_JWT_SECRET_KEY),
        )
        if not app.config.get(name) or app.config.get(name) == dev_value
    ]
    if missing:
        raise RuntimeError(
            f"Refusing to start in production without {', '.join(missing)}. "
            "Set them in the environment (FLASK_ENV=development allows local fallbacks)."
        )


def _register_blueprints(app):
    from app.blueprints.auth.routes import auth_bp
    from app.blueprints.users.routes import users_bp
    from app.blueprints.workers.routes import workers_bp
    from app.blueprints.clients.routes import clients_bp
    from app.blueprints.suppliers.routes import suppliers_bp
    from app.blueprints.supplier_orders.routes import supplier_orders_bp
    from app.blueprints.job_orders.routes import job_orders_bp
    from app.blueprints.operations.routes import operations_bp
    from app.blueprints.tools.routes import tools_bp
    from app.blueprints.inventory.routes import inventory_bp
    from app.blueprints.analytics.routes import analytics_bp
    from app.blueprints.worker_profiles.routes import (
        calendar_bp,
        operation_types_bp,
        worker_profiles_bp,
    )

    prefix = "/api/v1"
    app.register_blueprint(auth_bp, url_prefix=f"{prefix}/auth")
    app.register_blueprint(users_bp, url_prefix=f"{prefix}/users")
    app.register_blueprint(workers_bp, url_prefix=f"{prefix}/workers")
    app.register_blueprint(worker_profiles_bp, url_prefix=f"{prefix}/workers")
    app.register_blueprint(clients_bp, url_prefix=f"{prefix}/clients")
    app.register_blueprint(suppliers_bp, url_prefix=f"{prefix}/suppliers")
    app.register_blueprint(supplier_orders_bp, url_prefix=f"{prefix}/supplier-orders")
    app.register_blueprint(job_orders_bp, url_prefix=f"{prefix}/job-orders")
    app.register_blueprint(operations_bp, url_prefix=f"{prefix}/operations")
    app.register_blueprint(tools_bp, url_prefix=f"{prefix}/tools")
    app.register_blueprint(inventory_bp, url_prefix=f"{prefix}/inventory")
    app.register_blueprint(calendar_bp, url_prefix=f"{prefix}/calendar")
    app.register_blueprint(operation_types_bp, url_prefix=f"{prefix}/operation-types")
    app.register_blueprint(analytics_bp, url_prefix=f"{prefix}/analytics")
    from app.blueprints.notifications.routes import notifications_bp
    from app.blueprints.schedule.routes import schedule_bp
    from app.blueprints.attendance.routes import attendance_bp
    from app.blueprints.alerts.routes import alerts_bp

    app.register_blueprint(alerts_bp, url_prefix=f"{prefix}/alerts")
    app.register_blueprint(notifications_bp, url_prefix=f"{prefix}/notifications")
    app.register_blueprint(schedule_bp, url_prefix=f"{prefix}/schedule")
    app.register_blueprint(attendance_bp, url_prefix=f"{prefix}/attendance")


def _register_cli(app):
    @app.cli.command("seed")
    def seed_command():
        """Seed the database with demo data (refused in production)."""
        if app.config.get("ENV") == "production":
            raise click.ClickException(
                "Refusing to seed: FLASK_ENV is production (or unset). The seed creates "
                "demo accounts with published passwords. To create the first account on "
                "a live database, run `flask create-admin` instead."
            )
        from app.seed.seed_data import seed_database

        seed_database()
        print("Database seeded successfully.")

    @app.cli.command("create-admin")
    def create_admin_command():
        """Create an admin user interactively."""
        from getpass import getpass

        from app.models.user import User, UserRole, UserStatus
        from app.extensions import bcrypt
        from app.utils.errors import AppError
        from app.utils.passwords import validate_password

        email = input("Admin email: ")
        password = getpass("Admin password (hidden): ")
        if getpass("Repeat password: ") != password:
            raise click.ClickException("Passwords do not match.")
        try:
            validate_password(password)
        except AppError as exc:
            raise click.ClickException(exc.message)
        full_name = input("Full name: ")
        mobile = input("Mobile number: ")

        if User.query.filter_by(email=email.strip().lower()).first():
            print("User already exists.")
            return

        from app.utils.phone import normalize_ph_mobile

        user = User(
            email=email.strip().lower(),
            mobile_number=normalize_ph_mobile(mobile, required=True),
            password_hash=bcrypt.generate_password_hash(password).decode("utf-8"),
            full_name=full_name,
            role=UserRole.ADMIN,
            status=UserStatus.ACTIVE,
            active=True,
        )
        db.session.add(user)
        db.session.commit()
        print(f"Admin user {email} created.")


def utcnow():
    return datetime.now(timezone.utc)


def generate_uuid():
    return str(uuid.uuid4())
