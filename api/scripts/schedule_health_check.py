"""
Read-only schedule health check: lists double bookings from now on, work booked
on machines that are down, stalled operations, in-progress work running past
its plan into later work, and repair dates that have passed.

It never changes anything: the database session is switched to READ ONLY,
commits are refused, and everything is rolled back at the end. It does not run
the background checks that move work (only the API server starts those).

Usage (from the api folder; uses DATABASE_URL from the environment / .env):
    .venv\\Scripts\\python.exe scripts\\schedule_health_check.py
"""

from __future__ import annotations

import sys
from collections import defaultdict
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402


def _refuse_commit(*_args, **_kwargs):
    raise RuntimeError("schedule_health_check is read-only; refusing to commit")


def _read_only_session() -> None:
    conn = db.session.connection()
    if conn.dialect.name == "postgresql":
        conn.exec_driver_sql("SET TRANSACTION READ ONLY")
        conn.exec_driver_sql("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
        state = conn.exec_driver_sql("SHOW transaction_read_only").scalar()
        if state != "on":
            raise SystemExit("Could not switch the session to read-only; stopping.")
    db.session.commit = _refuse_commit


def main() -> int:
    app = create_app()
    with app.app_context():
        _read_only_session()
        try:
            return _report()
        finally:
            db.session.rollback()


def _report() -> int:
    from app.models.job_order import JobOrder, JobOrderStatus
    from app.models.operation import JobOperation, OperationStatus
    from app.services import shop_floor_check_service as checks
    from app.services.operation_service import open_downtimes_by_unit
    from app.services.schedule_calendar import ensure_utc, utc_to_shop
    from app.services.schedule_service import operation_working_segments, paused_at

    now = datetime.now(timezone.utc)

    def when(dt):
        return utc_to_shop(ensure_utc(dt)).strftime("%a %d %b %H:%M") if dt else "-"

    def label(op):
        job = op.job_order
        return f"{job.job_number or job.id[:8]} #{op.sequence_no} {op.operation_name}"

    def who(op):
        return op.assigned_worker.full_name if op.assigned_worker else "no worker"

    def unit(op):
        return op.machine_unit.label if op.machine_unit else "no machine"

    print(f"Schedule health check (read-only) at {when(now)} shop time, database host: {db.engine.url.host}")

    ops = (
        JobOperation.query.join(JobOrder)
        .filter(
            JobOrder.status != JobOrderStatus.DRAFT,
            JobOperation.status.in_(
                (OperationStatus.SCHEDULED, OperationStatus.IN_PROGRESS, OperationStatus.REWORK)
            ),
        )
        .all()
    )
    ahead = {}
    for op in ops:
        segs = [(max(s, now), e) for s, e in operation_working_segments(op, now) if e > now]
        if segs:
            ahead[op.id] = segs

    def shared_hours(a, b):
        return sum(
            (min(e1, e2) - max(s1, s2)).total_seconds()
            for s1, e1 in ahead[a.id]
            for s2, e2 in ahead[b.id]
            if s1 < e2 and s2 < e1
        ) / 3600.0

    by_key = defaultdict(list)
    for op in ops:
        if op.id not in ahead:
            continue
        if op.machine_unit_id:
            by_key[("Machine", unit(op))].append(op)
        for wid in op.crew_ids:
            name = next((m["fullName"] for m in op.crew_dicts() if m.get("id") == wid), wid)
            by_key[("Worker", name)].append(op)

    print("\n1. Double bookings from now on (same machine or same worker, shared working time)")
    clashes = 0
    for (kind, name), items in sorted(by_key.items()):
        for a, b in combinations(items, 2):
            hours = shared_hours(a, b)
            if hours > 0.01:
                clashes += 1
                print(f"   {kind} {name}: {hours:.2f} h shared")
                print(f"      {label(a)} [{a.status.value}] {when(a.scheduled_start)} -> {when(a.scheduled_end)}")
                print(f"      {label(b)} [{b.status.value}] {when(b.scheduled_start)} -> {when(b.scheduled_end)}")
    print(f"   {clashes} clash(es)")

    print("\n2. Unstarted work booked on a machine that is down")
    down_work = checks.work_on_down_units(now)
    for op, row in down_work:
        repair = row.expected_repair_date.strftime("%a %d %b") if row.expected_repair_date else "no repair date"
        print(f"   {unit(op)} (down since {when(row.started_at)}, {row.reason}, {repair}): "
              f"{label(op)} booked {when(op.scheduled_start)}, {who(op)}")
    downs = open_downtimes_by_unit()
    running_on_down = [
        op for op in ops
        if op.status == OperationStatus.IN_PROGRESS and op.machine_unit_id in downs
    ]
    for op in running_on_down:
        print(f"   (in progress) {unit(op)}: {label(op)}, {who(op)}")
    print(f"   {len(down_work)} unstarted, {len(running_on_down)} in progress")

    print("\n3. Stalled operations (paused over a working day, not resumed)")
    stalled = checks.stalled_operations(now)
    for op, since in stalled:
        print(f"   {label(op)}: paused {when(paused_at(op))}, stalled since {when(since)}, {who(op)}, {unit(op)}")
    print(f"   {len(stalled)} stalled")

    print("\n4. In-progress work running past its plan into later work")
    overruns = checks.overrun_clashes(now)
    for c in overruns:
        r = c["running"]
        print(f"   {label(r)}: planned end {when(c['plannedEnd'])}, now expected {when(c['projectedFinish'])}; "
              f"clashes with {', '.join(label(o) for o in c['affected'])}")
    print(f"   {len(overruns)} overrun(s)")

    print("\n5. Breakdowns past their expected repair date")
    today = utc_to_shop(now).date()
    passed = [row for row in downs.values() if row.expected_repair_date and row.expected_repair_date < today]
    for row in passed:
        print(f"   {row.machine_unit.label}: expected back {row.expected_repair_date:%a %d %b}, still down")
    print(f"   {len(passed)} passed")

    problems = clashes + len(down_work) + len(stalled) + len(overruns) + len(passed)
    print(f"\n{'No problems found.' if not problems else f'{problems} item(s) to look at.'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
