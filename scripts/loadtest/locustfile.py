"""
GET-only load smoke for CAPS2 (NFR-003).

Does not run against production by default — pass --host yourself.
Credentials from env (never hardcoded):
  LOADTEST_EMAIL / LOADTEST_PASSWORD
Optional:
  LOADTEST_USERS (default 25), LOADTEST_SPAWN_RATE (default 5), LOADTEST_RUN_TIME (default 2m)
"""

from __future__ import annotations

import os

from locust import HttpUser, between, task


def _require_creds() -> tuple[str, str]:
    email = (os.environ.get("LOADTEST_EMAIL") or "").strip()
    password = (os.environ.get("LOADTEST_PASSWORD") or "").strip()
    if not email or not password:
        raise RuntimeError(
            "Set LOADTEST_EMAIL and LOADTEST_PASSWORD in the environment before running."
        )
    return email, password


class Caps2User(HttpUser):
    wait_time = between(0.5, 1.5)

    def on_start(self):
        email, password = _require_creds()
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

    def _get(self, path: str, name: str):
        self.client.get(path, headers=self._auth_headers(), name=name)

    @task(3)
    def dashboard(self):
        self._get("/api/v1/schedule/board", "GET /schedule/board")

    @task(3)
    def schedule(self):
        self._get("/api/v1/calendar/break", "GET /calendar/break")

    @task(3)
    def job_orders(self):
        self._get("/api/v1/job-orders", "GET /job-orders")

    @task(2)
    def inventory(self):
        self._get("/api/v1/tools", "GET /tools")

    @task(2)
    def analytics(self):
        self._get("/api/v1/analytics/overview", "GET /analytics/overview")
