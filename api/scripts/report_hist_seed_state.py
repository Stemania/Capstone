"""Read-only: HIST-SEED counts in the local database and signs of a wipe.

Usage (from api/):  .venv\\Scripts\\python.exe scripts\\report_hist_seed_state.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app import create_app  # noqa: E402
from app.config import Config  # noqa: E402
from app.extensions import db  # noqa: E402

QUERIES = [
    ("database", "SELECT current_database() || ' on port ' || inet_server_port()"),
    ("alembic version", "SELECT string_agg(version_num, ',') FROM alembic_version"),
    ("all jobs", "SELECT COUNT(*) FROM job_orders"),
    ("HIST-SEED jobs", "SELECT COUNT(*) FROM job_orders WHERE client_po_number LIKE 'HIST-SEED-%'"),
    ("HIST-SEED clients", "SELECT COUNT(*) FROM clients WHERE name LIKE 'HIST-SEED%'"),
    ("HIST-SEED operations", "SELECT COUNT(*) FROM operations WHERE notes LIKE 'HIST-SEED%'"),
    ("HIST-SEED downtimes", "SELECT COUNT(*) FROM machine_downtimes WHERE note LIKE '%HIST-SEED%'"),
    ("HIST-SEED calendar rows", "SELECT COUNT(*) FROM work_calendar_exceptions WHERE note LIKE '%HIST-SEED%'"),
    ("all operations", "SELECT COUNT(*) FROM operations"),
    ("all time logs", "SELECT COUNT(*) FROM operation_time_logs"),
    ("users", "SELECT COUNT(*) FROM users"),
    ("clients", "SELECT COUNT(*) FROM clients"),
    ("material purchases", "SELECT COUNT(*) FROM material_purchases"),
    ("suppliers", "SELECT COUNT(*) FROM suppliers"),
    ("tool events", "SELECT COUNT(*) FROM tool_events"),
    ("oldest user created", "SELECT MIN(created_at)::text FROM users"),
    ("oldest job created", "SELECT MIN(created_at)::text FROM job_orders"),
    ("newest job created", "SELECT MAX(created_at)::text FROM job_orders"),
    ("oldest tool event", "SELECT MIN(created_at)::text FROM tool_events"),
]

JOBS_SQL = text(
    """
    SELECT j.created_at::text AS created, j.status::text AS status,
           j.job_type::text AS job_type, COALESCE(j.client_po_number, '') AS po,
           j.title
    FROM job_orders j ORDER BY j.created_at
    """
)


def main():
    app = create_app(Config)
    with app.app_context():
        for label, sql in QUERIES:
            try:
                val = db.session.execute(text(sql)).scalar()
            except Exception as exc:  # noqa: BLE001
                db.session.rollback()
                val = f"(error: {exc.__class__.__name__})"
            print(f"{label:<24} {val}")
        print("\nJobs:")
        for r in db.session.execute(JOBS_SQL).all():
            print(f"  {r.created} | {r.status} | {r.job_type} | {r.po} | {r.title}")
        db.session.rollback()


if __name__ == "__main__":
    main()
