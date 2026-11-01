"""The read cache clears after any committed write that can change a cached
page, including bulk statements and raw SQL, but not after log or sign-in
bookkeeping alone (so analytics can be kept for minutes, not seconds)."""

from sqlalchemy import text, update

from app.extensions import db
from app.models.audit_log import AuditLog
from app.models.user import User, UserRole, UserStatus
from app.services import read_cache

KEY = ("analytics", "test")


def _prime(monkeypatch):
    monkeypatch.setattr(read_cache, "_enabled", lambda: True)
    read_cache.invalidate()
    read_cache.put(KEY, "cached", ttl=300)
    assert read_cache.get(KEY) == "cached"


def _user(email="cache-test@example.com"):
    user = User(
        email=email,
        password_hash="x",
        full_name="Cache Test",
        role=UserRole.PRODUCTION_WORKER,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    db.session.commit()
    return user


def test_record_write_clears_cache(app, monkeypatch):
    _prime(monkeypatch)
    _user()
    assert read_cache.get(KEY) is None


def test_log_only_write_keeps_cache(app, monkeypatch):
    _prime(monkeypatch)
    db.session.add(AuditLog(action="LOGIN", entity_type="User", entity_id="x"))
    db.session.commit()
    assert read_cache.get(KEY) == "cached"


def test_bulk_update_clears_cache(app, monkeypatch):
    user = _user()
    _prime(monkeypatch)
    db.session.execute(update(User).where(User.id == user.id).values(full_name="Renamed"))
    db.session.commit()
    assert read_cache.get(KEY) is None


def test_raw_sql_write_clears_cache_but_reads_do_not(app, monkeypatch):
    user = _user()
    _prime(monkeypatch)
    db.session.execute(text("SELECT 1"))
    db.session.commit()
    assert read_cache.get(KEY) == "cached"

    db.session.execute(text("UPDATE users SET full_name = 'Raw' WHERE id = :id"), {"id": user.id})
    db.session.commit()
    assert read_cache.get(KEY) is None


def test_autoflushed_write_still_clears_on_commit(app, monkeypatch):
    _prime(monkeypatch)
    db.session.add(
        User(
            email="flushed@example.com",
            password_hash="x",
            full_name="Flushed",
            role=UserRole.PRODUCTION_WORKER,
            status=UserStatus.ACTIVE,
            active=True,
        )
    )
    db.session.flush()  # an earlier flush empties session.new before commit
    db.session.commit()
    assert read_cache.get(KEY) is None
