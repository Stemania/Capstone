"""The read cache drops expired entries and never grows past its cap."""

import time

from app.services import read_cache


def test_cache_evicts_expired_and_caps_size(monkeypatch):
    monkeypatch.setattr(read_cache, "_enabled", lambda: True)
    read_cache.invalidate()
    try:
        read_cache.put(("old",), 1, ttl=0.01)
        time.sleep(0.02)
        read_cache.put(("new",), 2)
        assert ("old",) not in read_cache._store
        for i in range(read_cache.MAX_ENTRIES + 50):
            read_cache.put(("k", i), i)
        assert len(read_cache._store) <= read_cache.MAX_ENTRIES
        last = read_cache.MAX_ENTRIES + 49
        assert read_cache.get(("k", last)) == last
    finally:
        read_cache.invalidate()
