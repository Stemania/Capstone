"""Link unlinked purchase lines to the job's planned material with the same name.

Only non-cancelled lines with no planned material are considered, and only when
exactly one planned entry on the same job has the same name (case and spacing
ignored). On apply, material status is re-derived for the jobs touched.

Preview (changes nothing):
    .venv\\Scripts\\python.exe scripts\\relink_planned_materials.py
Apply, refusing unless the number of links equals --expect:
    .venv\\Scripts\\python.exe scripts\\relink_planned_materials.py --apply --expect N
"""

import argparse
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app  # noqa: E402
from app.config import Config  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models.job_order import JobOrder, JobOrderStatus  # noqa: E402
from app.services.material_purchase_service import (  # noqa: E402
    sync_job_material_from_purchases,
)


def _key(name):
    return " ".join((name or "").split()).lower()


def _stage(job):
    if job.status == JobOrderStatus.DRAFT:
        return "not released"
    if any(op.actual_start for op in job.operations or []):
        return "started"
    return "released, not started"


def find_links():
    links = []
    skipped = Counter()
    for job in JobOrder.query.order_by(JobOrder.created_at).all():
        planned = [
            m for m in (job.raw_materials or []) if isinstance(m, dict) and m.get("id")
        ]
        for line in job.material_purchases or []:
            if line.planned_material_id or line.cancelled_at is not None:
                continue
            matches = [m for m in planned if _key(m.get("name")) == _key(line.material_name)]
            if len(matches) == 1:
                links.append((job, line, matches[0]))
            else:
                skipped["no matching planned name" if not matches else "several matches"] += 1
    return links, skipped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expect", type=int)
    args = parser.parse_args()

    app = create_app(Config)
    with app.app_context():
        try:
            links, skipped = find_links()
            by_stage = Counter(_stage(job) for job, _, _ in links)
            for job, line, planned in links:
                print(
                    f"link: {job.job_number} ({_stage(job)}) | line '{line.material_name}' "
                    f"{line.quantity} {line.unit} -> planned '{planned.get('name')}' "
                    f"{planned.get('quantity')} {planned.get('unit') or ''}"
                )
            print(f"Lines to link: {len(links)} {dict(by_stage)}")
            print(f"Jobs touched: {len({job.id for job, _, _ in links})}")
            print(f"Unlinked lines left as they are: {dict(skipped)}")

            if not args.apply:
                print("Preview only. Nothing changed.")
                return
            if args.expect != len(links):
                raise SystemExit(
                    f"Found {len(links)} links, expected {args.expect}. Nothing changed."
                )
            for _job, line, planned in links:
                line.planned_material_id = planned["id"]
            touched = {job.id: job for job, _, _ in links}
            before = {jid: job.material_status for jid, job in touched.items()}
            db.session.flush()
            for job in touched.values():
                sync_job_material_from_purchases(job)
            db.session.commit()
            print(f"Linked {len(links)} line(s).")
            for jid, job in touched.items():
                print(
                    f"status: {job.job_number} ({_stage(job)}) "
                    f"{before[jid].value} -> {job.material_status.value}"
                )
        finally:
            db.session.rollback()


if __name__ == "__main__":
    main()
