"""
Expand local shop to 19 production workers with realistic skill coverage.

Keeps the existing 4 demo workers and their skills untouched.
New workers: worker5@bmsc.local … worker19@bmsc.local (Seed Worker 05–19).

LOCAL ONLY (localhost:5433). Idempotent — skips emails that already exist.
"""

from __future__ import annotations

import os
import sys
from datetime import time
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))
os.chdir(API_ROOT)

from dotenv import load_dotenv

load_dotenv(API_ROOT / ".env")

from app import create_app
from app.extensions import bcrypt, db
from app.models.machine import MachineType
from app.models.user import User, UserRole
from app.models.worker_profile import WorkerProfile
from app.models.worker_skill import WorkerSchedule, WorkerSkill

ALL_FIVE = ["LATHE", "MILLING", "DRILLING", "GRINDING", "SHAPER"]

# (email, full_name, [(machine_code, proficiency, is_primary), ...])
# First 4 new workers: every machine. Rest: 1–3 skills, Lathe/Milling heavy.
NEW_WORKERS = [
    # All-rounders
    (
        "worker5@bmsc.local",
        "Seed Worker 05",
        [
            ("LATHE", 5, True),
            ("MILLING", 4, False),
            ("DRILLING", 3, False),
            ("GRINDING", 3, False),
            ("SHAPER", 2, False),
        ],
    ),
    (
        "worker6@bmsc.local",
        "Seed Worker 06",
        [
            ("MILLING", 5, True),
            ("LATHE", 4, False),
            ("DRILLING", 4, False),
            ("GRINDING", 2, False),
            ("SHAPER", 3, False),
        ],
    ),
    (
        "worker7@bmsc.local",
        "Seed Worker 07",
        [
            ("GRINDING", 5, True),
            ("SHAPER", 4, False),
            ("LATHE", 3, False),
            ("MILLING", 3, False),
            ("DRILLING", 2, False),
        ],
    ),
    (
        "worker8@bmsc.local",
        "Seed Worker 08",
        [
            ("SHAPER", 5, True),
            ("LATHE", 4, False),
            ("MILLING", 4, False),
            ("DRILLING", 3, False),
            ("GRINDING", 3, False),
        ],
    ),
    # 1–3 skills, Lathe/Milling weighted
    (
        "worker9@bmsc.local",
        "Seed Worker 09",
        [("MILLING", 5, True), ("SHAPER", 3, False)],
    ),
    (
        "worker10@bmsc.local",
        "Seed Worker 10",
        [("DRILLING", 5, True), ("LATHE", 4, False)],
    ),
    (
        "worker11@bmsc.local",
        "Seed Worker 11",
        [("MILLING", 4, True)],
    ),
    (
        "worker12@bmsc.local",
        "Seed Worker 12",
        [("LATHE", 5, True)],
    ),
    (
        "worker13@bmsc.local",
        "Seed Worker 13",
        [("GRINDING", 4, True)],
    ),
    (
        "worker14@bmsc.local",
        "Seed Worker 14",
        [("SHAPER", 4, True), ("MILLING", 3, False)],
    ),
    (
        "worker15@bmsc.local",
        "Seed Worker 15",
        [("LATHE", 4, True), ("DRILLING", 3, False), ("MILLING", 5, False)],
    ),
    (
        "worker16@bmsc.local",
        "Seed Worker 16",
        [("MILLING", 3, True), ("GRINDING", 5, False)],
    ),
    (
        "worker17@bmsc.local",
        "Seed Worker 17",
        [("DRILLING", 4, True), ("GRINDING", 2, False)],
    ),
    (
        "worker18@bmsc.local",
        "Seed Worker 18",
        [("LATHE", 3, True), ("SHAPER", 2, False)],
    ),
    (
        "worker19@bmsc.local",
        "Seed Worker 19",
        [("MILLING", 4, True), ("LATHE", 2, False), ("GRINDING", 3, False)],
    ),
]


def _assert_local_db():
    url = os.getenv("DATABASE_URL", "")
    if "localhost" not in url and "127.0.0.1" not in url:
        raise SystemExit(f"Refusing: DATABASE_URL not local: {url or '(unset)'}")
    if ":5433/" not in url and ":5433?" not in url:
        raise SystemExit(f"Refusing: expected port 5433: {url}")
    print(f"Using {url}")


def _default_schedule(worker_id):
    rows = []
    for dow in range(7):
        working = dow < 6
        rows.append(
            WorkerSchedule(
                worker_id=worker_id,
                day_of_week=dow,
                start_time=time(8, 0) if working else None,
                end_time=time(17, 0) if working else None,
                is_working=working,
            )
        )
    return rows


def _coverage_report():
    machines = {mt.code: mt for mt in MachineType.query.order_by(MachineType.code)}
    workers = (
        User.query.filter_by(role=UserRole.PRODUCTION_WORKER, active=True)
        .order_by(User.email)
        .all()
    )
    skills = WorkerSkill.query.all()
    by_code = {code: [] for code in machines}
    for sk in skills:
        mt = next((m for m in machines.values() if m.id == sk.machine_type_id), None)
        if not mt:
            continue
        w = next((u for u in workers if u.id == sk.worker_id), None)
        if not w:
            continue
        by_code[mt.code].append((w.full_name, sk.proficiency))

    print(f"\nActive production workers: {len(workers)}")
    print("Coverage per machine type:")
    for code, rows in by_code.items():
        profs = ", ".join(f"{n}({p})" for n, p in sorted(rows))
        print(f"  {code}: {len(rows)} skilled — {profs}")
    short = [c for c, rows in by_code.items() if len(rows) < 4]
    if short:
        print(f"WARNING: below 4 skilled: {', '.join(short)}")
    else:
        print("All machine types have >= 4 skilled workers.")


def main():
    _assert_local_db()
    app = create_app()
    with app.app_context():
        machines = {mt.code: mt for mt in MachineType.query.all()}
        for code in ALL_FIVE:
            if code not in machines:
                raise SystemExit(f"Missing MachineType {code}. Run flask seed first.")

        existing = User.query.filter_by(role=UserRole.PRODUCTION_WORKER).count()
        print(f"Existing production workers: {existing}")

        created = 0
        skipped = 0
        password_hash = bcrypt.generate_password_hash("Worker123!").decode("utf-8")

        for email, name, skill_rows in NEW_WORKERS:
            if User.query.filter_by(email=email).first():
                skipped += 1
                continue

            w = User(
                email=email,
                password_hash=password_hash,
                full_name=name,
                role=UserRole.PRODUCTION_WORKER,
                active=True,
            )
            db.session.add(w)
            db.session.flush()
            db.session.add(WorkerProfile(user_id=w.id))
            db.session.add_all(_default_schedule(w.id))
            for code, proficiency, is_primary in skill_rows:
                db.session.add(
                    WorkerSkill(
                        worker_id=w.id,
                        machine_type_id=machines[code].id,
                        proficiency=proficiency,
                        is_primary=is_primary,
                    )
                )
            created += 1
            print(f"  + {email} ({name}) — {len(skill_rows)} skills")

        db.session.commit()
        print(f"Created {created}, skipped existing {skipped}.")

        # Never modify worker1–4 skills; only report final coverage
        total = User.query.filter_by(role=UserRole.PRODUCTION_WORKER, active=True).count()
        if total < 19:
            print(f"WARNING: expected 19 active workers, have {total}")
        _coverage_report()


if __name__ == "__main__":
    main()
