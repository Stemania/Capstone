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


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-jwt-secret")
    JWT_ACCESS_TOKEN_EXPIRES = 3600  # 1 hour
    JWT_REFRESH_TOKEN_EXPIRES = 604800  # 7 days
    # development | production — controls console invite secret logging
    ENV = os.getenv("FLASK_ENV", os.getenv("ENV", "production"))
    DEBUG = os.getenv("FLASK_DEBUG", "0").lower() in ("1", "true", "yes")

    SQLALCHEMY_DATABASE_URI = _normalize_database_url(
        os.getenv("DATABASE_URL", "postgresql+psycopg://bmsc:bmsc_dev@localhost:5432/bmsc")
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Optional. No localhost default — an unset/mis-set Redis URL must not
    # point production at a Redis that does not exist in the container.
    REDIS_URL = os.getenv("REDIS_URL") or None
    CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173")

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

    # Notifications — default CONSOLE (no credentials required)
    NOTIFICATION_EMAIL_PROVIDER = os.getenv("NOTIFICATION_EMAIL_PROVIDER", "console")
    NOTIFICATION_SMS_PROVIDER = os.getenv("NOTIFICATION_SMS_PROVIDER", "console")
    SMTP_HOST = os.getenv("SMTP_HOST")
    SMTP_PORT = os.getenv("SMTP_PORT", "587")
    SMTP_USER = os.getenv("SMTP_USER")
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
    SMTP_FROM = os.getenv("SMTP_FROM")
    SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true")
    SEMAPHORE_API_KEY = os.getenv("SEMAPHORE_API_KEY")
    SEMAPHORE_SENDER = os.getenv("SEMAPHORE_SENDER")
    TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
    TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
    TWILIO_FROM = os.getenv("TWILIO_FROM")
    FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
    INVITATION_TOKEN_PEPPER = os.getenv("INVITATION_TOKEN_PEPPER", SECRET_KEY)


class TestConfig(Config):
    TESTING = True
    RATELIMIT_ENABLED = False
    RATELIMIT_STORAGE_URI = "memory://"
    SQLALCHEMY_DATABASE_URI = _normalize_database_url(
        os.getenv("TEST_DATABASE_URL", "postgresql+psycopg://bmsc:bmsc_dev@localhost:5432/bmsc_test")
    )
