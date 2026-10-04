"""
Load, or remove, data for the test cases in
"Production Scheduling Test Cases and Test Case Log" (TC-01 to TC-30).

    cd api
    .\\.venv\\Scripts\\python.exe scripts\\seed_test_cases.py          # load
    .\\.venv\\Scripts\\python.exe scripts\\seed_test_cases.py --wipe   # remove
    .\\.venv\\Scripts\\python.exe scripts\\seed_test_cases.py --force  # remove, then load

LOCAL ONLY (same DATABASE_URL guard as seed_history.py). Adds to what is
already there and needs the base data from `flask seed` (accounts, machines,
operation types, suppliers, consumables, tools). Builds one job per test case
that needs a starting state, titled "TC-xx ...", through the same services the
screens use. TC-16, 17, 18 and 30 use the history from seed_history.py, which
this script never touches.

Everything it creates is labelled TC-SEED, separate from HIST-SEED: job PO
numbers start TC-SEED- and its clients' names start "TC-SEED". --wipe removes
those jobs (with their operations, time logs, alerts, notifications, schedule
moves and invoices), the supplier orders that only carry their materials, and
the TC-SEED clients that have no other jobs.
"""

from __future__ import annotations

import argparse
from datetime import date, datetime, time, timedelta

import seed_history as hist  # sets sys.path, cwd and .env for the api package

from app import create_app
from app.extensions import db
from app.models.client import Client
from app.models.job_order import JobOrder
from app.models.material_purchase import MaterialPurchase
from app.models.notification import NotificationLog
from app.models.operation import JobOperation
from app.models.operation_time import MachineDowntime, OperationTimeLog
from app.models.sales_invoice import SalesInvoice
from app.models.schedule_move import ScheduleMove
from app.models.staff_alert import StaffAlert
from app.models.supplier import Supplier
from app.models.supplier_order import SupplierOrder
from app.models.tool_event import ToolEvent
from app.models.user import User, UserRole
from app.models.worker_skill import OperationType, WorkerSkill
from app.services import operation_service
from app.services import supplier_order_service as so_service
from app.services.job_order_service import (
    _parse_datetime,
    confirm_job_schedule,
    create_job_order,
    propose_for_job,
)
from app.services.schedule_calendar import shop_local_to_utc, shop_now, utc_to_shop
from app.services.schedule_service import place_from_start

TAG = "TC-SEED"
PO_PREFIX = f"{TAG}-"
CLIENT_NAMES = (
    "Tosoh Polyvin Corporation",
    "SIDC",
    "Sanitary Care",
    "Revery Construction",
    "MMV Builders",
    "Aboitiz",
)
REQUIRED_USERS = (
    "admin@bmsc.local",
    "office@bmsc.local",
    "worker1@bmsc.local",
    "worker2@bmsc.local",
    "worker3@bmsc.local",
    "worker4@bmsc.local",
    "worker10@bmsc.local",
)
# Machine skills the fixtures assign each worker (all part of the base seed).
REQUIRED_SKILLS = {
    "worker1@bmsc.local": ("LATHE", "MILLING", "DRILLING"),
    "worker2@bmsc.local": ("MILLING",),
    "worker4@bmsc.local": ("LATHE",),
    "worker10@bmsc.local": ("DRILLING",),
}
# Unit cost (PHP) of each fixture material when it is ordered.
PRICES = {
    "AISI 1045 round bar": 95,
    "Hex bolt M10": 18,
    "Bronze round bar": 620,
    "A36 plate 12mm": 2850,
    "Anchor bolt M16": 45,
    "Mild steel plate 6mm": 850,
}
WORKER = UserRole.PRODUCTION_WORKER.value
ADMIN = UserRole.ADMIN.value


# --- Wipe --------------------------------------------------------------------


def _tc_jobs_query():
    return JobOrder.query.filter(JobOrder.client_po_number.like(f"{PO_PREFIX}%"))


def _delete_jobs(jobs):
    """Delete jobs and every row that points at them."""
    job_ids = [j.id for j in jobs]
    if not job_ids:
        return
    op_ids = [
        oid
        for (oid,) in db.session.query(JobOperation.id).filter(
            JobOperation.job_order_id.in_(job_ids)
        )
    ]
    MachineDowntime.query.filter(
        (MachineDowntime.job_order_id.in_(job_ids)) | (MachineDowntime.operation_id.in_(op_ids))
    ).update({"job_order_id": None, "operation_id": None}, synchronize_session=False)
    ToolEvent.query.filter(ToolEvent.job_order_id.in_(job_ids)).update(
        {"job_order_id": None}, synchronize_session=False
    )
    for model in (StaffAlert, NotificationLog, ScheduleMove, SalesInvoice):
        model.query.filter(model.job_order_id.in_(job_ids)).delete(synchronize_session=False)
    if op_ids:
        OperationTimeLog.query.filter(OperationTimeLog.operation_id.in_(op_ids)).delete(
            synchronize_session=False
        )
    for job in jobs:
        db.session.delete(job)
    db.session.flush()


def wipe_test_cases():
    """Remove only TC-SEED data. History and everything else stay."""
    jobs = _tc_jobs_query().all()
    job_ids = {j.id for j in jobs}
    order_ids = {
        sid
        for (sid,) in db.session.query(MaterialPurchase.supplier_order_id).filter(
            MaterialPurchase.job_order_id.in_(job_ids),
            MaterialPurchase.supplier_order_id.isnot(None),
        )
    } if job_ids else set()
    shared = {
        sid
        for (sid,) in db.session.query(MaterialPurchase.supplier_order_id).filter(
            MaterialPurchase.supplier_order_id.in_(order_ids),
            MaterialPurchase.job_order_id.notin_(job_ids),
        )
    } if order_ids else set()
    order_ids -= shared

    _delete_jobs(jobs)
    if order_ids:
        JobOrder.query.filter(JobOrder.material_delay_supplier_order_id.in_(order_ids)).update(
            {"material_delay_supplier_order_id": None}, synchronize_session=False
        )
        for model in (StaffAlert, ScheduleMove):
            model.query.filter(model.supplier_order_id.in_(order_ids)).delete(
                synchronize_session=False
            )
        for order in SupplierOrder.query.filter(SupplierOrder.id.in_(order_ids)).all():
            db.session.delete(order)

    kept_clients = 0
    removed_clients = 0
    for client in Client.query.filter(Client.name.like(f"{TAG}%")).all():
        if JobOrder.query.filter_by(client_id=client.id).first():
            kept_clients += 1
            continue
        NotificationLog.query.filter_by(client_id=client.id).delete(synchronize_session=False)
        db.session.delete(client)
        removed_clients += 1
    db.session.commit()
    print(
        f"Wiped {TAG}: {len(jobs)} jobs, {len(order_ids)} supplier orders, "
        f"{removed_clients} clients."
    )
    if kept_clients:
        print(f"Kept {kept_clients} {TAG} clients that have jobs created during testing.")


def _ensure_clients() -> dict:
    """The six test clients, labelled TC-SEED, keyed by their plain name."""
    out = {}
    for name in CLIENT_NAMES:
        label = f"{TAG} {name}"
        client = Client.query.filter_by(name=label).first()
        if not client:
            client = Client(name=label)
            db.session.add(client)
        out[name] = client
    db.session.commit()
    return out


def _missing_skills() -> list[str]:
    """Base-seed skills the fixtures rely on that a worker no longer has."""
    users = {u.email: u for u in User.query.filter(User.email.in_(list(REQUIRED_SKILLS))).all()}
    out = []
    for email, codes in REQUIRED_SKILLS.items():
        user = users.get(email)
        have = {
            s.machine_type.code
            for s in WorkerSkill.query.filter_by(worker_id=user.id).all()
            if s.machine_type
        } if user else set()
        lack = [c for c in codes if c not in have]
        if lack:
            out.append(f"{user.full_name if user else email} needs {', '.join(lack)}")
    return out


# --- Fixture helpers ---------------------------------------------------------


class Ctx:
    def __init__(self):
        by_email = {u.email: u for u in User.query.all()}
        self.admin = by_email["admin@bmsc.local"]
        self.office = by_email["office@bmsc.local"]
        self.juan = by_email["worker1@bmsc.local"]
        self.maria = by_email["worker2@bmsc.local"]
        self.pedro = by_email["worker3@bmsc.local"]
        self.ana = by_email["worker4@bmsc.local"]
        self.driller = by_email["worker10@bmsc.local"]
        self.ops = {ot.code: ot for ot in OperationType.query.all()}
        self.suppliers = {s.name: s for s in Supplier.query.all()}
        self.clients = _ensure_clients()
        self.today = shop_now().date()
        self.d1 = prev_workday(self.today)
        self.d2 = prev_workday(self.d1)
        self.rows = []
        self.po_count = 0

    def next_po(self):
        self.po_count += 1
        return f"{PO_PREFIX}{self.today:%Y%m%d}-T{self.po_count:02d}"

    def note(self, tc, job, how):
        self.rows.append((tc, job.job_number if job else "-", job.title if job else "", how))


def prev_workday(d: date) -> date:
    d -= timedelta(days=1)
    while d.weekday() == 6:
        d -= timedelta(days=1)
    return d


def at(d: date, hh: int, mm: int = 0) -> datetime:
    return shop_local_to_utc(d, time(hh, mm))


def shop_label(dt: datetime) -> str:
    return f"{utc_to_shop(dt):%a %d %b %Y %H:%M}"


def new_job(ctx, *, title, client, job_type, ops, due_in, amount, quantity, unit,
            materials=None, description=None):
    data = {
        "clientId": client.id,
        "title": title,
        "description": description,
        "dueDate": (ctx.today + timedelta(days=due_in)).isoformat(),
        "clientPoNumber": ctx.next_po(),
        "poDate": (ctx.today - timedelta(days=2)).isoformat(),
        "jobType": job_type,
        "quantity": quantity,
        "unitOfMeasure": unit,
        "amount": amount,
        "rawMaterials": materials or [],
        "operations": [
            {
                "operationTypeId": ctx.ops[code].id,
                "estimatedHours": hours,
                "assignedWorkerId": worker.id if worker else None,
                "notes": notes,
            }
            for code, hours, worker, notes in ops
        ],
    }
    return create_job_order(data, ctx.office.id, actor_role=ADMIN)


def ops_of(job):
    db.session.refresh(job)
    return sorted(job.operations, key=lambda o: o.sequence_no)


def schedule(job):
    """Propose and confirm, as the Admin does on the Schedule step."""
    result = propose_for_job(job, {})
    if result.get("problems"):
        raise SystemExit(f"{job.title}: proposal has problems {result['problems']}")
    by_id = {o.id: o for o in job.operations}
    for row in result["operations"]:
        if not row.get("scheduled"):
            raise SystemExit(f"{job.title}: {row.get('message')}")
        op = by_id[row["id"]]
        op.scheduled_start = _parse_datetime(row["scheduledStart"])
        op.scheduled_end = _parse_datetime(row["scheduledEnd"])
        op.machine_unit_id = row.get("machineUnitId")
    db.session.commit()
    confirm_job_schedule(job, {}, actor_role=ADMIN)
    return ops_of(job)


def work_in_past(op, start_utc):
    """Move a confirmed operation to a past window and record it as done."""
    start, end, _segments = place_from_start(
        op.assigned_worker_id, start_utc, float(op.estimated_hours)
    )
    op.scheduled_start, op.scheduled_end = start, end
    db.session.commit()
    worker = op.assigned_worker_id
    operation_service.start_operation(op, worker, WORKER, start.isoformat())
    operation_service.complete_operation(op, worker, WORKER, end.isoformat())


def order_materials(ctx, job, supplier_name, *, issued, received=None):
    """Order every planned material from one supplier on its own PO."""
    supplier = ctx.suppliers[supplier_name]
    lines = [
        {
            "jobOrderId": job.id,
            "plannedMaterialId": m["id"],
            "quantity": m["quantity"],
            "unitCost": PRICES[m["name"]],
        }
        for m in job.raw_materials
    ]
    order, _ = so_service.add_lines_to_draft(supplier.id, lines, ctx.office.id)
    so_service.issue_order(order, ctx.office.id, date_issued=issued.isoformat())
    if received:
        so_service.receive_order_lines(
            order, [ln.id for ln in order.active_lines], received.isoformat()
        )
    db.session.refresh(job)
    return order


# --- Fixtures ----------------------------------------------------------------


def build_fixtures(ctx):
    c = ctx.clients
    tosoh, sidc, sanitary = c["Tosoh Polyvin Corporation"], c["SIDC"], c["Sanitary Care"]
    revery, mmv, aboitiz = c["Revery Construction"], c["MMV Builders"], c["Aboitiz"]

    # TC-02 first, so Maria's first free morning is the booking to clash with.
    booked = new_job(
        ctx, title="TC-02 Booked: Idler gear teeth", client=sidc, job_type="REPAIR",
        ops=[("TEETH_CUTTING", 4, ctx.maria, "Re-cut worn idler gear teeth to drawing IG-07.")],
        due_in=14, amount=9800, quantity=2, unit="pcs",
        description="Existing booking for Maria Santos used by TC-02.",
    )
    clash_at = schedule(booked)[0].scheduled_start
    ctx.note("TC-02", booked, f"Maria Santos is booked {shop_label(clash_at)} for 4h.")

    # TC-12: materials received and on hand; starting op 1 consumes them.
    tc12 = new_job(
        ctx, title="TC-12 Sprocket batch (materials on hand)", client=tosoh,
        job_type="FABRICATION",
        ops=[
            ("TEETH_CUTTING", 3, ctx.juan, "Cut 24T sprocket teeth, 3 pcs per setup."),
            ("DRILLING", 2, ctx.juan, "Drill 4 x 10mm mounting holes on PCD 90."),
        ],
        materials=[
            {"name": "AISI 1045 round bar", "quantity": 15, "unit": "kg"},
            {"name": "Hex bolt M10", "quantity": 12, "unit": "pcs"},
        ],
        due_in=12, amount=24500, quantity=6, unit="pcs",
    )
    order_materials(ctx, tc12, "Seno Metals", issued=ctx.d2, received=ctx.d1)
    schedule(tc12)
    ctx.note("TC-12", tc12, "Juan: Start op 1; materials go On hand -> Consumed.")

    # TC-11: three stages with instructions, all assigned to Juan.
    tc11 = new_job(
        ctx, title="TC-11 Gear blank set (stage instructions)", client=sanitary,
        job_type="REPAIR",
        ops=[
            ("FACING", 2, ctx.juan, "Face both sides to 25.0 mm thickness, Ra 3.2."),
            ("TEETH_CUTTING", 3, ctx.juan, "Cut 32 teeth, module 2. Check with gear tooth vernier."),
            ("DRILLING", 1, ctx.juan, "Drill and ream center bore to 20H7."),
        ],
        due_in=15, amount=18600, quantity=4, unit="pcs",
    )
    schedule(tc11)
    ctx.note("TC-11", tc11, "Juan sees three stages in order, each with instructions.")

    tc13 = new_job(
        ctx, title="TC-13 Pump shaft turning (offline test)", client=revery,
        job_type="REPAIR",
        ops=[("TURNING", 2, ctx.juan, "Turn bearing seat to 35 k6.")],
        due_in=10, amount=6500, quantity=1, unit="pc",
    )
    schedule(tc13)
    ctx.note("TC-13", tc13, "Juan: go offline, start/complete, reconnect.")

    tc26 = new_job(
        ctx, title="TC-26 Flange facing (pause and resume)", client=mmv,
        job_type="REPAIR",
        ops=[("FACING", 2, ctx.juan, "Face flange to remove 0.5 mm, keep parallel within 0.02.")],
        due_in=10, amount=5200, quantity=2, unit="pcs",
    )
    schedule(tc26)
    ctx.note("TC-26", tc26, "Juan: start, pause, resume, complete; check time worked.")

    # TC-14: in progress (op 1 done yesterday); op 2 is ready to start, then pause/breakdown.
    tc14 = new_job(
        ctx, title="TC-14 Coupling modification (log delays)", client=aboitiz,
        job_type="MODIFICATION",
        ops=[
            ("TURNING", 3, ctx.juan, "Turn coupling OD to 80 h7."),
            ("TEETH_CUTTING", 4, ctx.juan, "Cut external spline teeth per sketch C-14."),
        ],
        due_in=9, amount=15800, quantity=2, unit="pcs",
    )
    first = schedule(tc14)[0]
    work_in_past(first, at(ctx.d1, 8))
    ctx.note("TC-14", tc14, "Juan: start op 2, then Pause or Report breakdown.")

    # TC-27: op 1 completed, ready to be sent for redo.
    tc27 = new_job(
        ctx, title="TC-27 Threaded rod repair (send for redo)", client=sidc,
        job_type="REPAIR",
        ops=[
            ("THREADING", 2, ctx.juan, "Re-cut M24 x 2 thread, 60 mm length."),
            ("CHECKING", 1, ctx.pedro, "Check thread with M24 ring gauge."),
        ],
        due_in=8, amount=4800, quantity=4, unit="pcs",
    )
    first = schedule(tc27)[0]
    work_in_past(first, at(ctx.d1, 13))
    ctx.note("TC-27", tc27, "Admin: Send op 1 (Threading) for redo.")

    # TC-28: every operation completed, no invoice yet.
    tc28 = new_job(
        ctx, title="TC-28 Roller shaft repair (invoice before delivery)", client=tosoh,
        job_type="REPAIR",
        ops=[
            ("TURNING", 3, ctx.ana, "Build up and re-turn roller journal to 50 h6."),
            ("CHECKING", 1, ctx.pedro, "Check runout under 0.03 mm."),
        ],
        due_in=4, amount=12750, quantity=1, unit="pc",
    )
    turning, checking = schedule(tc28)
    work_in_past(turning, at(ctx.d2, 8))
    work_in_past(checking, at(ctx.d2, 13))
    ctx.note("TC-28", tc28, "Office: Deliver is refused until the invoice is issued.")

    # TC-23 / TC-24: scheduled behind an issued PO; push its expected date later.
    tc23 = new_job(
        ctx, title="TC-23 Bushing fabrication (material delay)", client=sanitary,
        job_type="FABRICATION",
        ops=[
            ("TURNING", 4, ctx.ana, "Turn bronze bushing OD 60, ID 40, length 50."),
            ("DRILLING", 2, ctx.driller, "Drill 6 mm grease hole."),
        ],
        materials=[{"name": "Bronze round bar", "quantity": 8, "unit": "kg"}],
        due_in=21, amount=21400, quantity=8, unit="pcs",
    )
    po23 = order_materials(ctx, tc23, "STP", issued=ctx.today)
    first = schedule(tc23)[0]
    ctx.note(
        "TC-23/24", tc23,
        f"{po23.po_number} expected {po23.expected_delivery_date:%d %b}; op 1 starts "
        f"{shop_label(first.scheduled_start)}. Change the PO's expected date to later.",
    )

    # TC-22: an issued supplier order to print.
    tc22 = new_job(
        ctx, title="TC-22 Base plate fabrication (issued PO)", client=revery,
        job_type="FABRICATION", ops=[],
        materials=[
            {"name": "A36 plate 12mm", "quantity": 4, "unit": "pcs"},
            {"name": "Anchor bolt M16", "quantity": 16, "unit": "pcs"},
        ],
        due_in=20, amount=32000, quantity=4, unit="pcs",
    )
    po22 = order_materials(ctx, tc22, "Railim", issued=ctx.today)
    ctx.note("TC-22", tc22, f"Print supplier order {po22.po_number} (Railim).")

    # TC-08 / TC-09: materials planned, nothing ordered yet.
    tc08 = new_job(
        ctx, title="TC-08 Spacer ring fabrication (order materials)", client=mmv,
        job_type="FABRICATION", ops=[],
        materials=[
            {"name": "AISI 1045 round bar", "quantity": 10, "unit": "kg"},
            {"name": "Mild steel plate 6mm", "quantity": 2, "unit": "pcs"},
        ],
        due_in=18, amount=14200, quantity=10, unit="pcs",
    )
    ctx.note("TC-08/09", tc08, "Office: Order materials, Issue, then Receive selected.")

    # TC-01 / TC-19: pending, operations without workers.
    tc01 = new_job(
        ctx, title="TC-01 Conveyor shaft repair (plan and confirm)", client=tosoh,
        job_type="REPAIR",
        ops=[
            ("TURNING", 3, None, "Turn journals to 45 h6."),
            ("KEYWAY", 2, None, "Cut 14 mm keyway, 60 mm long."),
            ("CHECKING", 1, None, "Check journal size and keyway width."),
        ],
        due_in=14, amount=16500, quantity=1, unit="pc",
    )
    ctx.note("TC-01", tc01, "Admin: To plan > Plan, assign workers, confirm.")

    tc19 = new_job(
        ctx, title="TC-19 Hub bore modification (suggest workers)", client=aboitiz,
        job_type="MODIFICATION",
        ops=[
            ("FACING", 2, None, "Face hub to 40 mm."),
            ("DRILLING", 2, None, "Open bore from 30 to 35 mm."),
            ("SURFACE_GRINDING", 2, None, "Grind mating face flat within 0.02."),
        ],
        due_in=16, amount=11900, quantity=2, unit="pcs",
    )
    ctx.note("TC-19", tc19, "Admin: Suggest worker on each operation.")

    tc02 = new_job(
        ctx, title="TC-02 Gear rework (double-booking check)", client=sidc,
        job_type="REPAIR",
        ops=[("TEETH_CUTTING", 3, None, "Re-cut damaged teeth on spur gear.")],
        due_in=14, amount=7400, quantity=1, unit="pc",
        description=(
            f"For TC-02: assign Maria Santos and set Start to "
            f"{shop_label(clash_at + timedelta(hours=1))}, which overlaps her booking on "
            f"{booked.job_number}. Confirm must be refused."
        ),
    )
    ctx.note("TC-02", tc02, f"Assign Maria at {shop_label(clash_at + timedelta(hours=1))}.")

    # TC-29: client with notifications on; run the job from Received to Delivered.
    client29 = Client(
        name=f"{TAG} Notification Client (TC-29)",
        contact="Replace with a real contact before TC-29",
        email="tc29.client@example.com",
        notify_by_email=True,
        notify_by_sms=False,
    )
    db.session.add(client29)
    db.session.commit()
    tc29 = new_job(
        ctx, title="TC-29 Bearing housing repair (client notifications)", client=client29,
        job_type="REPAIR",
        ops=[("FACING", 1, ctx.juan, "Face housing seat flat.")],
        due_in=10, amount=5600, quantity=1, unit="pc",
    )
    ctx.note("TC-29", tc29, "Set the client's real email/mobile first, then confirm, start, complete, invoice, deliver.")


def print_summary(ctx):
    print("\n=== Test-case data ===")
    print(f"Today {ctx.today}; past work recorded on {ctx.d2} and {ctx.d1}.")
    for tc, number, title, how in ctx.rows:
        print(f"{tc:<9} {number:<13} {title}")
        print(f"{'':<23} {how}")
    print(
        "\nNo fixture needed: TC-03, 04, 05, 06, 07, 10, 15, 20, 21, 25 use the base "
        "accounts, clients, consumables and tools; TC-16, 17, 18, 30 use the history "
        "from seed_history.py."
    )
    print("Remove after testing: scripts\\seed_test_cases.py --wipe (history is left alone).")
    print(
        "Logins: admin@bmsc.local / Admin123!, office@bmsc.local / Office123!, "
        "worker1@bmsc.local (Juan Dela Cruz) / Worker123!"
    )


def main():
    parser = argparse.ArgumentParser(description=f"Load or remove {TAG} test-case data (local only).")
    parser.add_argument("--wipe", action="store_true", help=f"Remove {TAG} data and exit.")
    parser.add_argument("--force", action="store_true", help=f"Remove {TAG} data, then load it again.")
    args = parser.parse_args()

    hist._assert_local_db()
    app = create_app()
    with app.app_context():
        if args.wipe:
            wipe_test_cases()
            return
        existing = _tc_jobs_query().count()
        if existing and not args.force:
            raise SystemExit(
                f"Already loaded ({existing} {TAG} jobs). Use --wipe to remove, or --force to reload."
            )
        if existing:
            wipe_test_cases()
        emails = {u.email for u in User.query.filter(User.email.in_(REQUIRED_USERS)).all()}
        missing = sorted(set(REQUIRED_USERS) - emails)
        if missing:
            raise SystemExit(f"Base data missing ({', '.join(missing)}). Run `flask seed` first.")
        lacking = _missing_skills()
        if lacking:
            raise SystemExit(
                "Fixture workers are missing base skills: " + "; ".join(lacking)
                + ". Add them under Worker setup, or run `flask seed` on a fresh database."
            )
        ctx = Ctx()
        build_fixtures(ctx)
        print_summary(ctx)


if __name__ == "__main__":
    main()
