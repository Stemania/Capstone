"""Read-only: jobs whose material status is ORDERED/RECEIVED but have no purchase lines.

Usage (from api/):  .venv\\Scripts\\python.exe scripts\\report_material_status_gaps.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app import create_app  # noqa: E402
from app.config import Config  # noqa: E402
from app.extensions import db  # noqa: E402

GAP_SQL = text(
    """
    SELECT j.material_status::text AS material_status,
           j.job_type::text AS job_type,
           j.status::text AS job_status,
           EXISTS (
               SELECT 1 FROM operations o
               WHERE o.job_order_id = j.id AND o.actual_start IS NOT NULL
           ) AS started,
           COUNT(*) AS n
    FROM job_orders j
    WHERE j.material_status::text IN ('ORDERED', 'RECEIVED')
      AND NOT EXISTS (SELECT 1 FROM material_purchases m WHERE m.job_order_id = j.id)
    GROUP BY 1, 2, 3, 4
    ORDER BY 1, 4, 2, 3
    """
)


def main():
    app = create_app(Config)
    with app.app_context():
        rows = db.session.execute(GAP_SQL).all()
        totals = {}
        print("material_status | job_type | job_status | started | count")
        for r in rows:
            print(f"{r.material_status} | {r.job_type} | {r.job_status} | {r.started} | {r.n}")
            key = (r.material_status, "started" if r.started else "not started")
            totals[key] = totals.get(key, 0) + r.n
        print("\nTotals:")
        for status in ("ORDERED", "RECEIVED"):
            for s in ("started", "not started"):
                print(f"  {status:<8} {s:<12} {totals.get((status, s), 0)}")
        all_jobs = db.session.execute(text("SELECT COUNT(*) FROM job_orders")).scalar()
        print(f"\nAll jobs: {all_jobs}")
        db.session.rollback()


if __name__ == "__main__":
    main()
