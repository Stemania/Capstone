"""A stuck lock or database must not freeze sign-in or the health check."""

from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine, text

from app.extensions import db
from app.models.rate_limit import RateLimitCounter
from app.services import db_rate_limit
from app.utils.errors import AppError


def test_database_health_check_answers(client):
    res = client.get("/api/v1/health/db")
    assert res.status_code == 200
    body = res.get_json()
    assert body["database"] == "ok"


def test_rate_limit_gives_up_on_a_held_lock(app, monkeypatch):
    monkeypatch.setattr(db_rate_limit, "LOCK_WAIT_MS", 300)
    db.session.add(RateLimitCounter(key="login:10.0.0.9", window_start=datetime.now(timezone.utc), count=1))
    db.session.commit()

    # Another connection holds the counter row, as a stuck request would.
    other = create_engine(app.config["SQLALCHEMY_DATABASE_URI"])
    conn = other.connect()
    tx = conn.begin()
    conn.execute(text("SELECT * FROM rate_limit_counters WHERE key = 'login:10.0.0.9' FOR UPDATE"))
    try:
        with pytest.raises(AppError) as err:
            db_rate_limit.hit("login:10.0.0.9", 10, 60)
        assert err.value.status_code == 503
        assert err.value.code == "SERVER_BUSY"
    finally:
        tx.rollback()
        conn.close()
        other.dispose()
