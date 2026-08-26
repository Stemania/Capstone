from datetime import date, time, timedelta
from decimal import Decimal

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
    OperationStatus,
    OperationType,
    PartCondition,
    ScoringWeight,
    Tool,
    ToolCategory,
    ToolEvent,
    ToolEventType,
    User,
    UserRole,
    UserStatus,
    WorkerProfile,
    WorkerSchedule,
    WorkerSkill,
)
from app.models.scoring_weight import DEFAULT_SCORING_WEIGHTS
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


def _ensure_scoring_weights():
    if ScoringWeight.query.first():
        return
    for key, value in DEFAULT_SCORING_WEIGHTS.items():
        db.session.add(ScoringWeight(key=key, value=value))
    db.session.flush()


def _inventory_catalog():
    """Client-named item types: one QR per type with stock behind it."""
    R = ToolCategory.RETURNABLE_TOOL
    C = ToolCategory.CONSUMABLE
    return [
        # Returnable cutting tools
        ("Drill bit", "INV-DRILL-06", R, "6mm", "pcs", 30, 10),
        ("Drill bit", "INV-DRILL-08", R, "8mm", "pcs", 28, 10),
        ("Drill bit", "INV-DRILL-10", R, "10mm", "pcs", 24, 8),
        ("Drill bit", "INV-DRILL-12", R, "12mm", "pcs", 18, 6),
        ("End mill", "INV-ENDMILL-10", R, "10mm", "pcs", 16, 5),
        ("End mill", "INV-ENDMILL-12", R, "12mm", "pcs", 14, 5),
        ("Tonga tip", "INV-TONGA-STD", R, None, "pcs", 40, 12),
        ("Center drill", "INV-CENTER-A", R, "A", "pcs", 20, 6),
        ("Center drill", "INV-CENTER-B", R, "B", "pcs", 16, 5),
        # Consumables
        ("Cutting oil", "INV-OIL-CUT", C, None, "litre", 20, 5),
        ("Lubricant", "INV-LUBE-GEN", C, None, "litre", 12, 4),
        ("Rugs", "INV-RUG-SHOP", C, None, "pcs", 80, 20),
        ("Grinding stone", "INV-GRIND-ST", C, None, "pcs", 10, 3),
        ("Flap disc", "INV-FLAP-115", C, "115mm", "pcs", 36, 12),
        ("Cutting disc", "INV-CUT-115", C, "115mm", "pcs", 40, 12),
    ]


def _ensure_inventory_catalog():
    """
    Replace seeded machine-as-tool rows (duplicates of MachineUnit) with
    real inventory item types. Safe to re-run: only wipes when legacy codes
    are present or the catalog is empty.
    """
    legacy_codes = {
        "TOOL-MILL-001",
        "TOOL-LATH-002",
        "TOOL-WELD-003",
        "TOOL-GRND-004",
        "TOOL-DRL-005",
        "TOOL-CNC-006",
        "TOOL-ANGL-007",
        "TOOL-VISE-008",
    }
    has_legacy = Tool.query.filter(Tool.code.in_(legacy_codes)).first() is not None
    empty = Tool.query.count() == 0
    if not has_legacy and not empty:
        return

    ToolEvent.query.delete()
    Tool.query.delete()
    db.session.flush()

    tools = []
    for name, code, category, size, unit, qty, minimum in _inventory_catalog():
        tools.append(
            Tool(
                name=name,
                code=code,
                category=category,
                size_spec=size,
                unit=unit,
                quantity_on_hand=Decimal(str(qty)),
                minimum_stock=Decimal(str(minimum)),
            )
        )
    db.session.add_all(tools)
    db.session.flush()
    print(f"Inventory catalog: {len(tools)} item types seeded.")
    return tools


def seed_database():
    _ensure_scoring_weights()
    inventory_tools = _ensure_inventory_catalog()
    if User.query.first():
        print("Database already seeded, skipping.")
        db.session.commit()
        return

    machines = _seed_machines()
    op_types = _seed_operation_types(machines)

    admin = User(
        email="admin@bmsc.local",
        mobile_number="+639171000001",
        password_hash=bcrypt.generate_password_hash("Admin123!").decode("utf-8"),
        full_name="Admin User",
        role=UserRole.ADMIN,
        status=UserStatus.ACTIVE,
        active=True,
    )
    office = User(
        email="office@bmsc.local",
        mobile_number="+639171000002",
        password_hash=bcrypt.generate_password_hash("Office123!").decode("utf-8"),
        full_name="Office Staff",
        role=UserRole.OFFICE_STAFF,
        status=UserStatus.ACTIVE,
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
    for idx, (email, name, skill_tokens) in enumerate(workers_data, start=1):
        w = User(
            email=email,
            mobile_number=f"+63917{100000 + idx:06d}",
            password_hash=bcrypt.generate_password_hash("Worker123!").decode("utf-8"),
            full_name=name,
            role=UserRole.PRODUCTION_WORKER,
            status=UserStatus.ACTIVE,
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

    tools = inventory_tools or _ensure_inventory_catalog()

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
        tool_id=tools[2].id,  # 10mm drill bit
        worker_id=workers[0][0].id,
        type=ToolEventType.BORROW,
        quantity=Decimal("1"),
        job_order_id=job1.id,
    )
    tools[2].quantity_on_hand = Decimal(str(tools[2].quantity_on_hand)) - Decimal("1")
    db.session.add(event)

    db.session.commit()
