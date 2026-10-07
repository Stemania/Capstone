"""Re-plan Scheduled jobs whose first operation's start has already passed.

Preview (changes nothing):
    .venv\\Scripts\\python.exe scripts\\replan_overdue_jobs.py
Apply, refusing unless the number of jobs to move equals --expect:
    .venv\\Scripts\\python.exe scripts\\replan_overdue_jobs.py --apply --expect N
Leave jobs as they are:
    ... --exclude JO-2026-XXXX JO-2026-YYYY

Released jobs whose unstarted operations were scheduled before the daily break
existed and now run through it (same preview / --apply --expect / --exclude):
    .venv\\Scripts\\python.exe scripts\\replan_overdue_jobs.py --break-crossing
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app  # noqa: E402
from app.config import Config  # noqa: E402
from app.services.overdue_replan_service import (  # noqa: E402
    replan_break_crossing,
    replan_overdue,
)
from app.services.schedule_calendar import utc_to_shop  # noqa: E402


def _when(iso):
    from datetime import datetime

    if not iso:
        return "—"
    return utc_to_shop(datetime.fromisoformat(iso)).strftime("%a %d %b %Y %H:%M")


def _workers(row):
    names = []
    for w in row["workers"]:
        name = w["workerName"] or "(no worker)"
        if name not in names:
            names.append(name)
    return ", ".join(names)


def _print(result):
    print(f"Now: {_when(result['now'])}")
    print(f"\nWould move ({len(result['moved'])}):" if not result["applied"] else f"\nMoved ({len(result['moved'])}):")
    for r in result["moved"]:
        print(f"\n  {r['jobNumber']}  {r['title']}  (due {r['dueDate']})")
        print(f"    Current first start:  {_when(r['currentFirstStart'])}")
        print(f"    Proposed first start: {_when(r['proposedFirstStart'])}")
        print(f"    Workers (unchanged):  {_workers(r)}")
        print(f"    Waiting for materials: {'Yes' if r['waitingForMaterials'] else 'No'}")
        print(f"    Reason type:          {r['delayKind']}")
        if r["startedByMaterials"]:
            print(f"    Start set by materials: {r['materialReason']}")
        if r.get("scheduleFlag") and r["scheduleFlag"] != "ON_TRACK":
            print(f"    Schedule flag: {r['scheduleFlag']} (projected finish {_when(r['projectedCompletion'])})")
    if result["excluded"]:
        print(f"\nLeft out on request ({len(result['excluded'])}): {', '.join(result['excluded'])}")
    print(f"\nCannot be placed ({len(result['notPlaced'])}):")
    for r in result["notPlaced"]:
        print(f"\n  {r['jobNumber']}  {r['title']}  (due {r['dueDate']})")
        print(f"    Current first start:  {_when(r['currentFirstStart'])}")
        print(f"    Workers:              {_workers(r)}")
        print(f"    Waiting for materials: {'Yes' if r['waitingForMaterials'] else 'No'}")
        print(f"    Reason: {r['reason']}")


def _print_break(result):
    print(f"Now: {_when(result['now'])}")
    label = "Moved" if result["applied"] else "Would re-plan"
    print(f"\n{label} ({len(result['moved'])}):")
    for r in result["moved"]:
        print(f"\n  {r['jobNumber']}  {r['title']}  ({r['status']}, due {r['dueDate']})")
        for o in r["operations"]:
            if o["started"]:
                print(f"    #{o['sequenceNo']} {o['operationName']}: started, unchanged")
                continue
            mark = "  <- crosses 12:00-13:00 on old rules" if o["crossesBreak"] else ""
            same = o.get("proposedStart") == o["currentStart"] and o.get("proposedEnd") == o["currentEnd"]
            print(
                f"    #{o['sequenceNo']} {o['operationName']} ({o['workerName'] or 'no worker'}, "
                f"{o['estimatedHours']}h){mark}"
            )
            print(f"        current:  {_when(o['currentStart'])} -> {_when(o['currentEnd'])}")
            print(
                f"        proposed: {_when(o.get('proposedStart'))} -> {_when(o.get('proposedEnd'))}"
                + ("  (no change)" if same else "")
            )
        if r.get("scheduleFlag") and r["scheduleFlag"] != "ON_TRACK":
            print(f"    Schedule flag: {r['scheduleFlag']} (projected finish {_when(r['projectedCompletion'])})")
    if result["excluded"]:
        print(f"\nLeft out on request ({len(result['excluded'])}): {', '.join(result['excluded'])}")
    print(f"\nCannot be placed ({len(result['notPlaced'])}):")
    for r in result["notPlaced"]:
        print(f"\n  {r['jobNumber']}  {r['title']}  ({r['status']}, due {r['dueDate']})")
        print(f"    Reason: {r['reason']}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expect", type=int)
    parser.add_argument("--exclude", nargs="*", default=[], metavar="JOB_NUMBER")
    parser.add_argument("--break-crossing", action="store_true")
    args = parser.parse_args()

    run, show = (
        (replan_break_crossing, _print_break) if args.break_crossing else (replan_overdue, _print)
    )
    app = create_app(Config)
    with app.app_context():
        preview = run(apply=False, exclude=args.exclude)
        if not args.apply:
            show(preview)
            print("\nDry run: nothing was changed.")
            return
        if args.expect is None or args.expect != len(preview["moved"]):
            show(preview)
            print(f"\nRefusing to apply: {len(preview['moved'])} jobs would move, --expect was {args.expect}.")
            sys.exit(1)
        show(run(apply=True, exclude=args.exclude))
        print("\nApplied.")


if __name__ == "__main__":
    main()
