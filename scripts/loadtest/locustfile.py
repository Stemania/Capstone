"""
GET-only load smoke for CAPS2 (NFR-003).

Does not run against production by default — pass --host yourself.
Each virtual user logs in once, then reuses that token.

Credentials (never hardcoded):
  LOADTEST_EMAIL / LOADTEST_PASSWORD
  or LOADTEST_ACCOUNTS = "email:password;email:password" (round-robin)

Login is limited to 10 per minute per client IP. The script spaces logins
(LOADTEST_LOGIN_INTERVAL_S, default 7) so that limit is not tripped.
Do not lower the API limit to make this pass.
"""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from locust import HttpUser, between, task

_SHOP = ZoneInfo("Asia/Manila")
_login_lock = threading.Lock()
_next_login_at = 0.0
_user_n = 0


def _accounts() -> list[tuple[str, str]]:
    raw = (os.environ.get("LOADTEST_ACCOUNTS") or "").strip()
    accounts: list[tuple[str, str]] = []
    if raw:
        for part in raw.split(";"):
            email, sep, password = part.partition(":")
            if sep and email.strip() and password:
                accounts.append((email.strip(), password))
    if accounts:
        return accounts
    email = (os.environ.get("LOADTEST_EMAIL") or "").strip()
    password = (os.environ.get("LOADTEST_PASSWORD") or "").strip()
    if not email or not password:
        raise RuntimeError(
            "Set LOADTEST_EMAIL and LOADTEST_PASSWORD, or LOADTEST_ACCOUNTS, before running."
        )
    return [(email, password)]


def _login_interval() -> float:
    raw = (os.environ.get("LOADTEST_LOGIN_INTERVAL_S") or "7").strip()
    try:
        return max(0.0, float(raw))
    except ValueError:
        return 7.0


def _shop_week() -> tuple[str, str]:
    """Monday–Sunday in shop time, the same week the schedule board requests."""
    today = datetime.now(_SHOP).date()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    return monday.isoformat(), sunday.isoformat()


class Caps2User(HttpUser):
    wait_time = between(0.5, 1.5)

    def on_start(self):
        global _next_login_at, _user_n
        accounts = _accounts()
        interval = _login_interval()
        with _login_lock:
            index = _user_n
            _user_n += 1
            wait = _next_login_at - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            _next_login_at = time.monotonic() + interval
        email, password = accounts[index % len(accounts)]
        with self.client.post(
            "/api/v1/auth/login",
            json={"identifier": email, "password": password},
            name="POST /auth/login",
            catch_response=True,
        ) as res:
            if res.status_code != 200:
                res.failure(f"login failed: {res.status_code}")
                self.token = None
                return
            body = res.json()
            self.token = body.get("accessToken")
            if not self.token:
                res.failure("login response missing accessToken")

    def _auth_headers(self) -> dict[str, str]:
        if not getattr(self, "token", None):
            return {}
        return {"Authorization": f"Bearer {self.token}"}

    def _get(self, path: str, name: str, params: dict | None = None):
        if not getattr(self, "token", None):
            return
        self.client.get(path, params=params, headers=self._auth_headers(), name=name)

    @task(3)
    def schedule_board(self):
        start, end = _shop_week()
        self._get(
            "/api/v1/schedule/board",
            "GET /schedule/board",
            {"from": start, "to": end, "includeCompleted": "true"},
        )

    @task(3)
    def calendar_break(self):
        self._get("/api/v1/calendar/break", "GET /calendar/break")

    @task(3)
    def job_orders(self):
        self._get("/api/v1/job-orders", "GET /job-orders")

    @task(2)
    def inventory(self):
        self._get("/api/v1/tools", "GET /tools")

    @task(2)
    def analytics(self):
        start, end = _shop_week()
        self._get(
            "/api/v1/analytics/overview",
            "GET /analytics/overview",
            {"from": start, "to": end},
        )
