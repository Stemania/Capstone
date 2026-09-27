"""Set ORDERED jobs that have no purchase lines back to TO_ORDER.

Refuses to write unless the number of matching jobs equals --expect.

Usage (from api/):
    .venv\\Scripts\\python.exe scripts\\fix_ordered_without_lines.py --expect 1
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app import create_app  # noqa: E402
from app.config import Config  # noqa: E402
from app.extensions import db  # noqa: E402

MATCH_SQL = """
    FROM job_orders j
    WHERE j.material_status::text = 'ORDERED'
      AND NOT EXISTS (SELECT 1 FROM material_purchases m WHERE m.job_order_id = j.id)
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--expect", type=int, required=True)
    args = parser.parse_args()

    app = create_app(Config)
    with app.app_context():
        rows = db.session.execute(
            text(f"SELECT j.id, j.title, j.status::text AS status {MATCH_SQL}")
        ).all()
        for r in rows:
            print(f"match: {r.id} | {r.status} | {r.title}")
        if len(rows) != args.expect:
            db.session.rollback()
            raise SystemExit(f"Found {len(rows)} jobs, expected {args.expect}. Nothing changed.")
        n = db.session.execute(
            text(
                "UPDATE job_orders SET material_status = 'TO_ORDER' "
                f"WHERE id IN (SELECT j.id {MATCH_SQL})"
            )
        ).rowcount
        db.session.commit()
        print(f"Updated {n} job(s) to TO_ORDER.")


if __name__ == "__main__":
    main()
