"""Measure local dashboard-related API latency (NFR-002). Credentials from env only."""

from __future__ import annotations

import os
import statistics
import sys
import time

import requests

BASE = os.environ.get("LOADTEST_BASE", "http://localhost:5000").rstrip("/")
EMAIL = (os.environ.get("LOADTEST_EMAIL") or "").strip()
PASSWORD = (os.environ.get("LOADTEST_PASSWORD") or "").strip()
RUNS = int(os.environ.get("LOADTEST_DASHBOARD_RUNS", "5"))


def main() -> int:
    if not EMAIL or not PASSWORD:
        print("Set LOADTEST_EMAIL and LOADTEST_PASSWORD", file=sys.stderr)
        return 2

    login = requests.post(
        f"{BASE}/api/v1/auth/login",
        json={"identifier": EMAIL, "password": PASSWORD},
        timeout=30,
    )
    login.raise_for_status()
    token = login.json()["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}

    # Dashboard pulls schedule board + open job list in typical office use.
    path = "/api/v1/schedule/board"
    times_ms: list[float] = []
    for _ in range(RUNS):
        t0 = time.perf_counter()
        res = requests.get(f"{BASE}{path}", headers=headers, timeout=60)
        elapsed = (time.perf_counter() - t0) * 1000
        res.raise_for_status()
        times_ms.append(elapsed)

    times_ms.sort()
    p50 = statistics.median(times_ms)
    p95 = times_ms[max(0, int(len(times_ms) * 0.95) - 1)]
    print(f"endpoint={path}")
    print(f"runs={RUNS}")
    print(f"p50_ms={p50:.1f}")
    print(f"p95_ms={p95:.1f}")
    print(f"max_ms={max(times_ms):.1f}")
    print(f"under_3s={'yes' if max(times_ms) < 3000 else 'no'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
