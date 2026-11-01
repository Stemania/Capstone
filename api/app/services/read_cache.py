"""Short-lived cache for expensive read models.

Cleared after any committed write except logging and sign-in bookkeeping
(see ``_ignored``), including bulk UPDATE/DELETE/INSERT statements. A TTL
still drops entries, so a missed invalidation cannot last; pages that change
only with writes (analytics) can therefore keep a longer TTL.
"""

from __future__ import annotations

import time
from threading import Lock

from flask import current_app, has_app_context
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import TextClause

_lock = Lock()
_generation = 0
_store: dict[tuple, tuple[int, float, object]] = {}

_IGNORED = None


def _ignored():
    """Models whose writes never change a cached page: logging, sign-in and
    rate-limit bookkeeping. Any other write clears the cache, so a new table
    is covered without anyone remembering to list it here."""
    global _IGNORED
    if _IGNORED is None:
        from app.models.audit_log import AuditLog
        from app.models.rate_limit import RateLimitCounter
        from app.models.user_security import PasswordResetToken, UserDevice, UserInvitation

        _IGNORED = (AuditLog, RateLimitCounter, UserDevice, UserInvitation, PasswordResetToken)
    return _IGNORED


def _ignored_tables():
    return {m.__table__.name for m in _ignored()}


def _enabled() -> bool:
    return has_app_context() and not current_app.config.get("TESTING")


def get(key):
    if not _enabled():
        return None
    with _lock:
        hit = _store.get(key)
        if hit is None or hit[0] != _generation or hit[1] < time.monotonic():
            return None
        return hit[2]


MAX_ENTRIES = 200


def put(key, value, ttl=30):
    if not _enabled():
        return
    now = time.monotonic()
    with _lock:
        # Drop expired entries so many different date ranges cannot pile up
        # between writes; past the cap, drop the oldest.
        for k in [k for k, (_g, exp, _v) in _store.items() if exp < now]:
            del _store[k]
        while len(_store) >= MAX_ENTRIES:
            del _store[next(iter(_store))]
        _store[key] = (_generation, now + ttl, value)


_key_locks: dict = {}


def get_or_build(key, builder, ttl=30):
    """Cached value for ``key``, building it once when missing. Requests that
    miss at the same moment wait for that one build instead of each running
    the same heavy queries."""
    if not _enabled():
        return builder()
    hit = get(key)
    if hit is not None:
        return hit
    with _lock:
        key_lock = _key_locks.setdefault(key, Lock())
        if len(_key_locks) > MAX_ENTRIES * 2:
            for k in [k for k, lk in _key_locks.items() if k != key and not lk.locked()]:
                del _key_locks[k]
    with key_lock:
        hit = get(key)
        if hit is not None:
            return hit
        value = builder()
        put(key, value, ttl=ttl)
        return value


def invalidate():
    global _generation
    with _lock:
        _generation += 1
        _store.clear()


def _mark_if_changed(session, objects):
    ignored = _ignored()
    if any(not isinstance(obj, ignored) for obj in objects):
        session.info["read_cache_dirty"] = True


def _after_flush(session, _flush_context):
    # new/dirty/deleted still hold this flush's objects here; by commit time an
    # earlier autoflush would have emptied them.
    _mark_if_changed(session, list(session.new) + list(session.dirty) + list(session.deleted))


_READ_ONLY_SQL = ("SELECT", "SET", "SHOW")


def _on_execute(orm_execute_state):
    """Bulk UPDATE/DELETE/INSERT statements bypass the flush: check their table.
    Raw SQL (the sample-history reset, data clean-up) counts as a write unless
    it only reads or sets a session option."""
    stmt = orm_execute_state.statement
    if isinstance(stmt, TextClause):
        if not stmt.text.lstrip().upper().startswith(_READ_ONLY_SQL):
            orm_execute_state.session.info["read_cache_dirty"] = True
        return
    if not (orm_execute_state.is_update or orm_execute_state.is_delete or orm_execute_state.is_insert):
        return
    table = getattr(orm_execute_state.statement, "table", None)
    name = getattr(table, "name", None)
    if name is None or name not in _ignored_tables():
        orm_execute_state.session.info["read_cache_dirty"] = True


def _after_commit(session):
    if session.info.pop("read_cache_dirty", False):
        invalidate()


def register():
    if getattr(register, "_done", False):
        return
    from sqlalchemy import event

    event.listen(Session, "after_flush", _after_flush)
    event.listen(Session, "do_orm_execute", _on_execute)
    event.listen(Session, "after_commit", _after_commit)

    register._done = True


register()
