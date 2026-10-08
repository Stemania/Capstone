"""Per-request timing and database query counts.

Any request slower than ``SLOW_REQUEST_SECONDS`` (default 1 s) is logged at
WARNING with its path, status, duration and query count, so slowness on the
live server can be diagnosed from its log. ``REQUEST_TIMING`` logs every
request at INFO.
"""

from __future__ import annotations

import time

from flask import g, has_request_context, request
from sqlalchemy import event
from sqlalchemy.engine import Engine

_listening = False


def _count_query(*_args, **_kwargs) -> None:
    if has_request_context():
        g._query_count = g.get("_query_count", 0) + 1


def query_count() -> int:
    return g.get("_query_count", 0) if has_request_context() else 0


def init_request_metrics(app) -> None:
    global _listening
    if not _listening:
        event.listen(Engine, "before_cursor_execute", _count_query)
        _listening = True

    @app.before_request
    def _request_started():
        g._request_started_at = time.perf_counter()
        g._query_count = 0

    @app.after_request
    def _request_finished(response):
        started = g.get("_request_started_at")
        if started is None:
            return response
        seconds = time.perf_counter() - started
        args = (request.method, request.path, response.status_code, seconds * 1000.0, query_count())
        if seconds >= float(app.config.get("SLOW_REQUEST_SECONDS", 1.0)):
            app.logger.warning(
                "slow_request method=%s path=%s status=%s duration_ms=%.0f queries=%s", *args
            )
        elif app.config.get("REQUEST_TIMING"):
            app.logger.info(
                "request_timing method=%s path=%s status=%s duration_ms=%.1f queries=%s", *args
            )
        return response
