import logging
import os

import redis as redis_lib
from flask_bcrypt import Bcrypt
from flask_jwt_extended import JWTManager
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_sqlalchemy import SQLAlchemy

logger = logging.getLogger(__name__)

db = SQLAlchemy()
jwt = JWTManager()
bcrypt = Bcrypt()
# Fail open: storage errors must not take down auth routes.
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[],
    swallow_errors=True,
    in_memory_fallback_enabled=True,
)


def _is_redis_uri(uri: str | None) -> bool:
    if not uri:
        return False
    return uri.startswith(("redis://", "rediss://"))


def probe_redis(uri: str, *, timeout: float = 0.5) -> bool:
    """Return True if Redis answers PING. Never raises."""
    client = None
    try:
        client = redis_lib.from_url(uri, socket_connect_timeout=timeout, socket_timeout=timeout)
        return bool(client.ping())
    except Exception as exc:  # noqa: BLE001 — probe must never crash startup
        logger.warning("Redis probe failed for rate-limit storage (%s): %s", uri, exc)
        return False
    finally:
        if client is not None:
            try:
                client.close()
            except Exception:  # noqa: BLE001
                pass


def resolve_ratelimit_storage_uri(app) -> str:
    """
    Choose rate-limit storage URI.

    Default is memory://. Redis is used only when RATELIMIT_STORAGE_URI is an
    explicit redis/rediss URL *and* that host answers PING at startup.
    """
    configured = (app.config.get("RATELIMIT_STORAGE_URI") or "").strip() or "memory://"
    if not _is_redis_uri(configured):
        return configured

    if probe_redis(configured):
        logger.info("Rate-limit storage using Redis: %s", configured.split("@")[-1])
        return configured

    logger.warning(
        "Rate-limit Redis unreachable; falling back to memory:// "
        "(requests will still be served; limits are per-process only)."
    )
    return "memory://"
