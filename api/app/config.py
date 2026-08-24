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

    SQLALCHEMY_DATABASE_URI = _normalize_database_url(
        os.getenv("DATABASE_URL", "postgresql+psycopg://bmsc:bmsc_dev@localhost:5432/bmsc")
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173")

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
    SQLALCHEMY_DATABASE_URI = _normalize_database_url(
        os.getenv("TEST_DATABASE_URL", "postgresql+psycopg://bmsc:bmsc_dev@localhost:5432/bmsc_test")
    )
