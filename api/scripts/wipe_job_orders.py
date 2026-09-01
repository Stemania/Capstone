"""
Remove all job orders from the local database for a clean testing slate.

Also removes HIST-SEED extras (history clients, downtimes, calendar exceptions).

    cd api
    .\\.venv\\Scripts\\python.exe scripts\\wipe_job_orders.py

Activate the venv first if you prefer: .venv\\Scripts\\activate

LOCAL ONLY — refuses non-localhost / non-5433 DATABASE_URL.
"""

from __future__ import annotations

import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app import create_app
from app.extensions import db
from app.models.job_order import JobOrder
from app.models.notification import NotificationLog
from app.models.tool_event import ToolEvent

from scripts.seed_history import _assert_local_db, _wipe_hist_artifacts  # noqa: E402


def _clear_job_dependencies() -> tuple[int, int]:
    """Remove notification logs and unlink tool events before job deletes."""
    notif_count = NotificationLog.query.delete()
    tool_count = ToolEvent.query.filter(ToolEvent.job_order_id.isnot(None)).update(
        {ToolEvent.job_order_id: None},
        synchronize_session=False,
    )
    db.session.commit()
    return notif_count, tool_count


def wipe_all_job_orders() -> int:
    """Delete every job order. Call _clear_job_dependencies() first."""
    jobs = JobOrder.query.all()
    job_count = len(jobs)
    for job in jobs:
        db.session.delete(job)
    db.session.commit()
    return job_count


def main():
    _assert_local_db()
    app = create_app()
    with app.app_context():
        notif_count, tool_count = _clear_job_dependencies()
        print(
            f"Cleared {notif_count} notification log(s) and unlinked {tool_count} tool event(s)."
        )

        job_count = wipe_all_job_orders()
        print(f"Removed {job_count} job order(s).")

        dts_n, cal_n, clients_n = _wipe_hist_artifacts(commit=True)
        print(
            f"Removed HIST-SEED extras: {dts_n} downtime(s), "
            f"{cal_n} calendar exception(s), {clients_n} client(s)."
        )
        print("Done. Demo clients, workers, and machines are unchanged.")


if __name__ == "__main__":
    main()
