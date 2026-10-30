"""Short-lived cache for expensive read models.

Invalidated when a job, operation, tool, purchase, or invoice is written.
A TTL still drops entries so a missed invalidation cannot last.
"""

from __future__ import annotations

import time
from threading import Lock

from flask import current_app, has_app_context
from sqlalchemy.orm import Session

_lock = Lock()
_generation = 0
_store: dict[tuple, tuple[int, float, object]] = {}

_WATCHED = None


def _watched():
    global _WATCHED
    if _WATCHED is None:
        from app.models.job_order import JobOrder
        from app.models.machine import MachineUnit
        from app.models.material_purchase import MaterialPurchase
        from app.models.operation import JobOperation
        from app.models.operation_time import MachineDowntime, OperationTimeLog
        from app.models.sales_invoice import SalesInvoice
        from app.models.tool import Tool
        from app.models.tool_event import ToolEvent
        from app.models.worker_skill import WorkCalendarException, WorkerSchedule

        _WATCHED = (
            JobOrder,
            MachineUnit,
            JobOperation,
            OperationTimeLog,
            MachineDowntime,
            Tool,
            ToolEvent,
            MaterialPurchase,
            SalesInvoice,
            WorkerSchedule,
            WorkCalendarException,
        )
    return _WATCHED


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


def _before_commit(session):
    watched = _watched()
    changed = list(session.new) + list(session.dirty) + list(session.deleted)
    session.info["read_cache_dirty"] = any(isinstance(obj, watched) for obj in changed)


def _after_commit(session):
    if session.info.pop("read_cache_dirty", False):
        invalidate()


def register():
    if getattr(register, "_done", False):
        return
    from sqlalchemy import event

    event.listen(Session, "before_commit", _before_commit)
    event.listen(Session, "after_commit", _after_commit)
    register._done = True


register()
