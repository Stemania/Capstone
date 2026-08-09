from datetime import date, time, timedelta

from app.constants.machines import MACHINE_CATALOG
from app.extensions import bcrypt, db
from app.models import (
    Client,
    JobOperation,
    JobOrder,
    JobOrderStatus,
    JobPriority,
    JobType,
    MachineType,
    MachineUnit,
    MaterialSource,
    OperationStatus,
    OperationType,
    PartCondition,
    Tool,
    ToolEvent,
    ToolEventType,
    User,
    UserRole,
    WorkerProfile,
    WorkerSchedule,
    WorkerSkill,
)
from app.models.worker_skill import OPERATION_TYPE_SEED, SKILL_TOKEN_TO_MACHINE


def _seed_machines():
    if MachineType.query.first():
        return {mt.code: mt for mt in MachineType.query.all()}
    by_code = {}
    for m in MACHINE_CATALOG:
        mt = MachineType(code=m["code"], name=m["name"], units=m["units"])
        db.session.add(mt)
        db.session.flush()
        by_code[m["code"]] = mt
        for i in range(1, m["units"] + 1):
            db.session.add(
                MachineUnit(
                    machine_type_id=mt.id,
                    label=f"{m['name']} #{i}",
                    active=True,
                )
            )
    return by_code


def _seed_operation_types(machines):
    if OperationType.query.first():
        return {ot.code: ot for ot in OperationType.query.all()}
    by_code = {}
    for item in OPERATION_TYPE_SEED:
        mid = machines[item["machine"]].id if item["machine"] and item["machine"] in machines else None
        ot = OperationType(
            code=item["code"],
            name=item["name"],
            default_machine_type_id=mid,
            active=True,
        )
        db.session.add(ot)
        by_code[item["code"]] = ot
    db.session.flush()
    return by_code


def _default_schedule(worker_id):
    """Mon–Sat 08:00–17:00; Sunday off. day_of_week: 0=Mon … 6=Sun."""
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


def _skills_from_tokens(worker_id, tokens, machines):
    mapped = []
    for token in tokens:
        code = SKILL_TOKEN_TO_MACHINE.get(str(token).strip().lower())
        if code and code in machines and code not in mapped:
            mapped.append(code)
    rows = []
    for i, code in enumerate(mapped):
        rows.append(
            WorkerSkill(
                worker_id=worker_id,
                machine_type_id=machines[code].id,
                proficiency=3,
                is_primary=(i == 0),
            )
        )
    return rows


def seed_database():
    if User.query.first():
        print("Database already seeded, skipping.")
        return

    machines = _seed_machines()
    op_types = _seed_operation_types(machines)

    admin = User(
        email="admin@bmsc.local",
        password_hash=bcrypt.generate_password_hash("Admin123!").decode("utf-8"),
        full_name="Admin User",
        role=UserRole.ADMIN,
        active=True,
    )
    office = User(
        email="office@bmsc.local",
        password_hash=bcrypt.generate_password_hash("Office123!").decode("utf-8"),
        full_name="Office Staff",
        role=UserRole.OFFICE_STAFF,
        active=True,
    )

    # Seed: 19 production workers (1–4 real demo names; 5–19 placeholders)
    workers_data = [
        ("worker1@bmsc.local", "Juan Dela Cruz", ["milling", "lathe", "drilling"]),
        ("worker2@bmsc.local", "Maria Santos", ["grinding", "milling"]),
        ("worker3@bmsc.local", "Pedro Reyes", ["milling", "grinding"]),
        ("worker4@bmsc.local", "Ana Lopez", ["lathe", "drilling"]),
        # --- seed placeholders (flagged) ---
        ("worker5@bmsc.local", "Seed Worker 05", ["lathe", "milling"]),
        ("worker6@bmsc.local", "Seed Worker 06", ["milling", "drilling"]),
        ("worker7@bmsc.local", "Seed Worker 07", ["grinding", "shaper"]),
        ("worker8@bmsc.local", "Seed Worker 08", ["lathe", "grinding"]),
        ("worker9@bmsc.local", "Seed Worker 09", ["milling", "shaper"]),
        ("worker10@bmsc.local", "Seed Worker 10", ["drilling", "lathe"]),
        ("worker11@bmsc.local", "Seed Worker 11", ["milling"]),
        ("worker12@bmsc.local", "Seed Worker 12", ["lathe"]),
        ("worker13@bmsc.local", "Seed Worker 13", ["grinding"]),
        ("worker14@bmsc.local", "Seed Worker 14", ["shaper", "milling"]),
        ("worker15@bmsc.local", "Seed Worker 15", ["lathe", "drilling", "milling"]),
        ("worker16@bmsc.local", "Seed Worker 16", ["milling", "grinding"]),
        ("worker17@bmsc.local", "Seed Worker 17", ["drilling", "grinding"]),
        ("worker18@bmsc.local", "Seed Worker 18", ["lathe", "shaper"]),
        ("worker19@bmsc.local", "Seed Worker 19", ["milling", "lathe", "grinding"]),
    ]

    workers = []
    for email, name, skill_tokens in workers_data:
        w = User(
            email=email,
            password_hash=bcrypt.generate_password_hash("Worker123!").decode("utf-8"),
            full_name=name,
            role=UserRole.PRODUCTION_WORKER,
            active=True,
        )
        workers.append((w, skill_tokens))

    db.session.add_all([admin, office] + [w for w, _ in workers])
    db.session.flush()

    for w, skill_tokens in workers:
        db.session.add(WorkerProfile(user_id=w.id))
        db.session.add_all(_skills_from_tokens(w.id, skill_tokens, machines))
        db.session.add_all(_default_schedule(w.id))

    clients = [
        Client(name="ABC Manufacturing", contact="09171234567"),
        Client(name="Metro Steel Corp", contact="09181234567"),
        Client(name="Pacific Engineering", contact="09191234567"),
    ]
    db.session.add_all(clients)
    db.session.flush()

    tools = [
        Tool(name="Milling Machine A", code="TOOL-MILL-001"),
        Tool(name="Lathe Machine B", code="TOOL-LATH-002"),
        Tool(name="Welding Set C", code="TOOL-WELD-003"),
        Tool(name="Grinder D", code="TOOL-GRND-004"),
        Tool(name="Drill Press E", code="TOOL-DRL-005"),
        Tool(name="CNC Router F", code="TOOL-CNC-006"),
        Tool(name="Angle Grinder G", code="TOOL-ANGL-007"),
        Tool(name="Bench Vise H", code="TOOL-VISE-008"),
    ]
    db.session.add_all(tools)
    db.session.flush()

    job1 = JobOrder(
        client_id=clients[0].id,
        title="Shaft Repair - Line 3",
        description="Repair and re-machine drive shaft for conveyor line 3.",
        due_date=date.today() + timedelta(days=7),
        client_po_number="PO-ABC-1042",
        po_date=date.today() - timedelta(days=3),
        status=JobOrderStatus.ASSIGNED,
        priority=JobPriority.HIGH,
        job_type=JobType.REPAIR,
        material_source=MaterialSource.CLIENT_SUPPLIED,
        part_condition=PartCondition.CLIENT_SUPPLIED_ITEM,
        quantity=1,
        unit_of_measure="lot",
        amount=31360.00,
        raw_materials=[
            {"name": "Drive shaft blank", "quantity": 1, "unit": "pc"},
            {"name": "Bearing grease", "quantity": 1, "unit": "tube"},
        ],
        created_by_id=office.id,
    )
    job2 = JobOrder(
        client_id=clients[1].id,
        title="Custom Bracket Fabrication",
        description="Fabricate 12 custom steel brackets per drawing BR-2024-15.",
        due_date=date.today() + timedelta(days=14),
        client_po_number="PO-MSC-778",
        po_date=date.today() - timedelta(days=5),
        status=JobOrderStatus.IN_PROGRESS,
        priority=JobPriority.MODERATE,
        job_type=JobType.FABRICATION,
        material_source=MaterialSource.SHOP_PROCURED,
        part_condition=PartCondition.WORK_IN_PROCESS,
        quantity=12,
        unit_of_measure="pcs",
        amount=26880.00,
        raw_materials=[
            {"name": "Mild steel plate 6mm", "quantity": 12, "unit": "pcs"},
            {"name": "Welding rod E6013", "quantity": 2, "unit": "kg"},
        ],
        created_by_id=office.id,
    )
    job3 = JobOrder(
        client_id=clients[2].id,
        title="Pump Housing Refurbishment",
        description="Refurbish pump housing units - milling and finishing required.",
        due_date=date.today() + timedelta(days=21),
        client_po_number="PO-PE-331",
        po_date=date.today() - timedelta(days=1),
        status=JobOrderStatus.ASSIGNED,
        priority=JobPriority.LOW,
        job_type=JobType.MODIFICATION,
        material_source=MaterialSource.CLIENT_SUPPLIED,
        part_condition=PartCondition.CLIENT_SUPPLIED_ITEM,
        quantity=2,
        unit_of_measure="pcs",
        amount=15400.00,
        raw_materials=[
            {"name": "Cast housing blank", "quantity": 2, "unit": "pcs"},
        ],
        created_by_id=admin.id,
    )

    db.session.add_all([job1, job2, job3])
    db.session.flush()

    def mt(code):
        return machines[code].id if code in machines else None

    def ot(code):
        return op_types[code].id if code in op_types else None

    ops = [
        JobOperation(
            job_order_id=job1.id,
            sequence_no=1,
            operation_name="Teeth Cutting",
            operation_type_id=ot("TEETH_CUTTING"),
            machine_type_id=mt("MILLING"),
            assigned_worker_id=workers[0][0].id,
            estimated_hours=4,
            status=OperationStatus.PENDING,
        ),
        JobOperation(
            job_order_id=job1.id,
            sequence_no=2,
            operation_name="Surface Grinding",
            operation_type_id=ot("SURFACE_GRINDING"),
            machine_type_id=mt("GRINDING"),
            assigned_worker_id=workers[0][0].id,
            estimated_hours=2,
            status=OperationStatus.PENDING,
        ),
        JobOperation(
            job_order_id=job2.id,
            sequence_no=1,
            operation_name="Welding",
            operation_type_id=ot("WELDING"),
            machine_type_id=None,
            assigned_worker_id=workers[1][0].id,
            estimated_hours=6,
            status=OperationStatus.COMPLETED,
        ),
        JobOperation(
            job_order_id=job2.id,
            sequence_no=2,
            operation_name="Surface Grinding",
            operation_type_id=ot("SURFACE_GRINDING"),
            machine_type_id=mt("GRINDING"),
            assigned_worker_id=workers[1][0].id,
            estimated_hours=3,
            status=OperationStatus.IN_PROGRESS,
        ),
        JobOperation(
            job_order_id=job2.id,
            sequence_no=3,
            operation_name="Drilling",
            operation_type_id=ot("DRILLING"),
            machine_type_id=mt("DRILLING"),
            assigned_worker_id=workers[1][0].id,
            estimated_hours=2,
            status=OperationStatus.PENDING,
        ),
        JobOperation(
            job_order_id=job3.id,
            sequence_no=1,
            operation_name="Teeth Cutting",
            operation_type_id=ot("TEETH_CUTTING"),
            machine_type_id=mt("MILLING"),
            assigned_worker_id=workers[2][0].id,
            estimated_hours=5,
            status=OperationStatus.PENDING,
        ),
        JobOperation(
            job_order_id=job3.id,
            sequence_no=2,
            operation_name="Turning",
            operation_type_id=ot("TURNING"),
            machine_type_id=mt("LATHE"),
            assigned_worker_id=workers[2][0].id,
            estimated_hours=4,
            status=OperationStatus.PENDING,
        ),
    ]
    db.session.add_all(ops)

    event = ToolEvent(
        tool_id=tools[0].id,
        worker_id=workers[0][0].id,
        type=ToolEventType.BORROW,
        job_order_id=job1.id,
    )
    db.session.add(event)

    db.session.commit()
