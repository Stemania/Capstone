"""Database-backed rate limits for auth routes (shared across app processes)."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from functools import wraps

from flask import request

from app.extensions import db
from app.models.rate_limit import RateLimitCounter
from app.utils.errors import AppError

_LIMIT_RE = re.compile(
    r"^\s*(\d+)\s+per\s+(second|minute|hour|day|month)\s*$", re.IGNORECASE
)
_WINDOW_SECONDS = {
    "second": 1,
    "minute": 60,
    "hour": 3600,
    "day": 86400,
    "month": 2592000,
}


def parse_limit(spec: str) -> tuple[int, int]:
    """Return (max_count, window_seconds) for strings like '10 per minute'."""
    match = _LIMIT_RE.match(spec or "")
    if not match:
        raise ValueError(f"Unsupported rate limit spec: {spec!r}")
    count = int(match.group(1))
    unit = match.group(2).lower()
    return count, _WINDOW_SECONDS[unit]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def hit(key: str, limit: int, window_seconds: int) -> int:
    """
    Increment the counter for ``key`` inside the current window.

    Returns the new count. Raises AppError 429 when the limit is exceeded.
    Uses SELECT … FOR UPDATE so two app instances sharing the DB agree.
    """
    now = _utcnow()
    row = (
        RateLimitCounter.query.filter_by(key=key)
        .with_for_update()
        .one_or_none()
    )
    if row is None:
        db.session.add(
            RateLimitCounter(key=key, window_start=now, count=1)
        )
        db.session.commit()
        return 1

    elapsed = (now - row.window_start).total_seconds()
    if elapsed >= window_seconds:
        row.window_start = now
        row.count = 1
        db.session.commit()
        return 1

    if row.count >= limit:
        # Do not rollback — callers may have other work in this session
        # (tests often map commit→flush inside a single transaction).
        raise AppError(
            "Too many attempts. Please wait a minute and try again.",
            "RATE_LIMIT_EXCEEDED",
            429,
        )

    row.count += 1
    db.session.commit()
    return row.count


def client_key(prefix: str) -> str:
    """Rate-limit key from client IP + route prefix.

    Prefer ``request.remote_addr`` so ProxyFix (TRUSTED_PROXY_COUNT) supplies the
    real client behind X-Forwarded-For; do not trust the leftmost header hop.
    """
    ip = (request.remote_addr or "").strip() or "unknown"
    return f"{prefix}:{ip}"


def db_limit(limit_factory, *, prefix: str, error_message: str | None = None, on_block=None):
    """Decorator: enforce a DB-backed limit (callable or string limit spec).

    ``on_block`` runs when a request is refused (for example, to note it in
    the audit log); its own errors never change the 429 answer.
    """

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            from flask import current_app

            spec = limit_factory() if callable(limit_factory) else limit_factory
            if not current_app.config.get("RATELIMIT_ENABLED", True):
                return fn(*args, **kwargs)
            try:
                limit, window = parse_limit(spec)
            except ValueError:
                return fn(*args, **kwargs)
            try:
                hit(client_key(prefix), limit, window)
            except AppError as exc:
                if on_block is not None:
                    try:
                        on_block()
                    except Exception:  # noqa: BLE001 - logging must not break the 429
                        db.session.rollback()
                if error_message:
                    raise AppError(error_message, exc.code, exc.status_code) from exc
                raise
            return fn(*args, **kwargs)

        return wrapper

    return decorator
