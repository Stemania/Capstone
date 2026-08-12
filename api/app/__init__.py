import os
import uuid
from datetime import datetime, timezone

from flask import Flask
from flask_cors import CORS
from flask_migrate import Migrate

from app.extensions import bcrypt, db, jwt, redis_client
from app.utils.errors import register_error_handlers


def create_app(config_object=None):
    app = Flask(__name__)

    if config_object:
        app.config.from_object(config_object)
    else:
        from app.config import Config

        app.config.from_object(Config)

    db.init_app(app)
    migrate = Migrate(app, db)
    jwt.init_app(app)
    bcrypt.init_app(app)
    redis_client.init_app(app)

    cors_origins = app.config.get("CORS_ORIGINS", "http://localhost:5173")
    if isinstance(cors_origins, str):
        cors_origins = [o.strip() for o in cors_origins.split(",")]
    CORS(app, origins=cors_origins, supports_credentials=True)

    register_error_handlers(app)
    _register_blueprints(app)
    _register_cli(app)

    from app.services.audit_service import register_audit_listeners

    register_audit_listeners()

    return app


def _register_blueprints(app):
    from app.blueprints.auth.routes import auth_bp
    from app.blueprints.users.routes import users_bp
    from app.blueprints.workers.routes import workers_bp
    from app.blueprints.clients.routes import clients_bp
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
    app.register_blueprint(job_orders_bp, url_prefix=f"{prefix}/job-orders")
    app.register_blueprint(operations_bp, url_prefix=f"{prefix}/operations")
    app.register_blueprint(tools_bp, url_prefix=f"{prefix}/tools")
    app.register_blueprint(inventory_bp, url_prefix=f"{prefix}/inventory")
    app.register_blueprint(calendar_bp, url_prefix=f"{prefix}/calendar")
    app.register_blueprint(operation_types_bp, url_prefix=f"{prefix}/operation-types")
    app.register_blueprint(analytics_bp, url_prefix=f"{prefix}/analytics")
    from app.blueprints.notifications.routes import notifications_bp
    from app.blueprints.schedule.routes import schedule_bp

    app.register_blueprint(notifications_bp, url_prefix=f"{prefix}/notifications")
    app.register_blueprint(schedule_bp, url_prefix=f"{prefix}/schedule")


def _register_cli(app):
    @app.cli.command("seed")
    def seed_command():
        """Seed the database with demo data."""
        from app.seed.seed_data import seed_database

        seed_database()
        print("Database seeded successfully.")

    @app.cli.command("create-admin")
    def create_admin_command():
        """Create an admin user interactively."""
        from app.models.user import User, UserRole
        from app.extensions import bcrypt

        email = input("Admin email: ")
        password = input("Admin password: ")
        full_name = input("Full name: ")

        if User.query.filter_by(email=email).first():
            print("User already exists.")
            return

        user = User(
            email=email,
            password_hash=bcrypt.generate_password_hash(password).decode("utf-8"),
            full_name=full_name,
            role=UserRole.ADMIN,
            active=True,
        )
        db.session.add(user)
        db.session.commit()
        print(f"Admin user {email} created.")


def utcnow():
    return datetime.now(timezone.utc)


def generate_uuid():
    return str(uuid.uuid4())
