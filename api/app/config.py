import os

from dotenv import load_dotenv

load_dotenv()


def _normalize_database_url(url):
    """Cloud hosts (Render, Neon, Railway) often provide postgres:// URLs."""
    if not url:
        return url
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://") and "+psycopg" not in url:
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


# Local-development fallbacks only; create_app refuses to start with these in production.
DEV_SECRET_KEY = "dev-secret-key"
DEV_JWT_SECRET_KEY = "dev-jwt-secret"


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY") or DEV_SECRET_KEY
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY") or DEV_JWT_SECRET_KEY
    JWT_ACCESS_TOKEN_EXPIRES = 3600  # 1 hour
    JWT_REFRESH_TOKEN_EXPIRES = 604800  # 7 days
    # development | production — controls console invite secret logging
    ENV = os.getenv("FLASK_ENV", os.getenv("ENV", "production"))
    DEBUG = os.getenv("FLASK_DEBUG", "0").lower() in ("1", "true", "yes")
    # Log method/path/duration for every request (off by default)
    REQUEST_TIMING = os.getenv("REQUEST_TIMING", "0").lower() in (
        "1",
        "true",
        "yes",
    )

    SQLALCHEMY_DATABASE_URI = _normalize_database_url(
        os.getenv("DATABASE_URL", "postgresql+psycopg://bmsc:bmsc_dev@localhost:5432/bmsc")
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # Neon closes idle connections (and suspends the database); without these a
    # request or background check can wait forever on a dead connection.
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
        "pool_recycle": 280,
        "pool_timeout": 15,
        "connect_args": {
            "connect_timeout": 10,
            "keepalives": 1,
            "keepalives_idle": 30,
            "keepalives_interval": 10,
            "keepalives_count": 3,
            "tcp_user_timeout": 30000,
        },
    }
    SLOW_REQUEST_SECONDS = float(os.getenv("SLOW_REQUEST_SECONDS", "1.0"))

    # Optional. No localhost default — an unset/mis-set Redis URL must not
    # point production at a Redis that does not exist in the container.
    REDIS_URL = os.getenv("REDIS_URL") or None
    CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173")
    # Reverse proxies in front of the API (Render: 1). 0 turns ProxyFix off.
    TRUSTED_PROXY_COUNT = int(os.getenv("TRUSTED_PROXY_COUNT", "1"))

    # Auth rate limits (per client IP). Only applied to selected auth routes.
    # Storage defaults to in-process memory. Redis only when RATELIMIT_STORAGE_URI
    # is an explicit redis:// URL *and* reachable at startup (see create_app).
    RATELIMIT_ENABLED = os.getenv("RATELIMIT_ENABLED", "true").lower() in (
        "1",
        "true",
        "yes",
    )
    RATELIMIT_STORAGE_URI = os.getenv("RATELIMIT_STORAGE_URI") or "memory://"
    RATELIMIT_SWALLOW_ERRORS = True
    RATELIMIT_IN_MEMORY_FALLBACK_ENABLED = True
    AUTH_RATE_LIMIT_LOGIN = os.getenv("AUTH_RATE_LIMIT_LOGIN", "10 per minute")
    AUTH_RATE_LIMIT_PIN_UNLOCK = os.getenv("AUTH_RATE_LIMIT_PIN_UNLOCK", "20 per minute")
    AUTH_RATE_LIMIT_INVITE_VALIDATE = os.getenv(
        "AUTH_RATE_LIMIT_INVITE_VALIDATE", "10 per minute"
    )
    AUTH_RATE_LIMIT_INVITE_ACCEPT = os.getenv(
        "AUTH_RATE_LIMIT_INVITE_ACCEPT", "5 per minute"
    )
    AUTH_RATE_LIMIT_PASSWORD_RESET_REQUEST = os.getenv(
        "AUTH_RATE_LIMIT_PASSWORD_RESET_REQUEST", "5 per minute"
    )
    AUTH_RATE_LIMIT_PASSWORD_RESET_VALIDATE = os.getenv(
        "AUTH_RATE_LIMIT_PASSWORD_RESET_VALIDATE", "10 per minute"
    )
    AUTH_RATE_LIMIT_PASSWORD_RESET_CONFIRM = os.getenv(
        "AUTH_RATE_LIMIT_PASSWORD_RESET_CONFIRM", "5 per minute"
    )

    # Outbound notifications. Nothing leaves the server unless NOTIFICATIONS_ENABLED
    # is true; NOTIFY_ALLOWLIST (comma-separated emails/phones) limits who can receive.
    NOTIFICATIONS_ENABLED = os.getenv("NOTIFICATIONS_ENABLED", "false").lower() in (
        "1",
        "true",
        "yes",
    )
    NOTIFY_ALLOWLIST = os.getenv("NOTIFY_ALLOWLIST", "")
    # gmail_api | smtp | console. smtp is for local development only (Render blocks SMTP ports).
    EMAIL_BACKEND = os.getenv("EMAIL_BACKEND") or "console"
    GMAIL_CLIENT_ID = os.getenv("GMAIL_CLIENT_ID")
    GMAIL_CLIENT_SECRET = os.getenv("GMAIL_CLIENT_SECRET")
    GMAIL_REFRESH_TOKEN = os.getenv("GMAIL_REFRESH_TOKEN")
    MAIL_FROM = os.getenv("MAIL_FROM") or os.getenv("SMTP_FROM")
    # Optional; defaults to MAIL_FROM when sending.
    MAIL_REPLY_TO = os.getenv("MAIL_REPLY_TO") or None
    SMTP_HOST = os.getenv("SMTP_HOST")
    SMTP_PORT = os.getenv("SMTP_PORT", "587")
    SMTP_USER = os.getenv("SMTP_USER")
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
    SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true")
    FRONTEND_URL = os.getenv("FRONTEND_URL") or "http://localhost:5173"
    INVITATION_TOKEN_PEPPER = os.getenv("INVITATION_TOKEN_PEPPER", SECRET_KEY)


class TestConfig(Config):
    TESTING = True
    NOTIFICATIONS_ENABLED = False
    NOTIFY_ALLOWLIST = ""
    EMAIL_BACKEND = "console"
    GMAIL_CLIENT_ID = None
    GMAIL_CLIENT_SECRET = None
    GMAIL_REFRESH_TOKEN = None
    RATELIMIT_ENABLED = False
    RATELIMIT_STORAGE_URI = "memory://"
    SQLALCHEMY_DATABASE_URI = _normalize_database_url(
        os.getenv("TEST_DATABASE_URL", "postgresql+psycopg://bmsc:bmsc_dev@localhost:5432/bmsc_test")
    )
