from datetime import date, timedelta

from app.extensions import bcrypt, db
from app.models import (
    Client,
    JobOrder,
    JobOrderStatus,
    JobPriority,
    Operation,
    OperationStatus,
    Tool,
    ToolEvent,
    ToolEventType,
    User,
    UserRole,
    WorkerProfile,
)


def seed_database():
    if User.query.first():
        print("Database already seeded, skipping.")
        return

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

    workers_data = [
        ("worker1@bmsc.local", "Juan Dela Cruz", ["milling", "lathe", "drilling"]),
        ("worker2@bmsc.local", "Maria Santos", ["welding", "grinding", "finishing"]),
        ("worker3@bmsc.local", "Pedro Reyes", ["milling", "grinding", "cnc"]),
        ("worker4@bmsc.local", "Ana Lopez", ["lathe", "welding", "assembly"]),
    ]

    workers = []
    for email, name, skills in workers_data:
        w = User(
            email=email,
            password_hash=bcrypt.generate_password_hash("Worker123!").decode("utf-8"),
            full_name=name,
            role=UserRole.PRODUCTION_WORKER,
            active=True,
        )
        workers.append((w, skills))

    db.session.add_all([admin, office] + [w for w, _ in workers])
    db.session.flush()

    for w, skills in workers:
        db.session.add(WorkerProfile(user_id=w.id, skills=skills))

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
        status=JobOrderStatus.ASSIGNED,
        priority=JobPriority.HIGH,
        quantity=1,
        unit_of_measure="lot",
        amount=31360.00,
        raw_materials=[
            {"name": "Drive shaft blank", "quantity": 1, "unit": "pc"},
            {"name": "Bearing grease", "quantity": 1, "unit": "tube"},
        ],
        assigned_worker_id=workers[0][0].id,
        created_by_id=office.id,
    )
    job2 = JobOrder(
        client_id=clients[1].id,
        title="Custom Bracket Fabrication",
        description="Fabricate 12 custom steel brackets per drawing BR-2024-15.",
        due_date=date.today() + timedelta(days=14),
        status=JobOrderStatus.IN_PROGRESS,
        priority=JobPriority.MODERATE,
        quantity=12,
        unit_of_measure="pcs",
        amount=26880.00,
        raw_materials=[
            {"name": "Mild steel plate 6mm", "quantity": 12, "unit": "pcs"},
            {"name": "Welding rod E6013", "quantity": 2, "unit": "kg"},
        ],
        assigned_worker_id=workers[1][0].id,
        created_by_id=office.id,
    )
    job3 = JobOrder(
        client_id=clients[2].id,
        title="Pump Housing Refurbishment",
        description="Refurbish pump housing units - milling and finishing required.",
        due_date=date.today() + timedelta(days=21),
        status=JobOrderStatus.ASSIGNED,
        priority=JobPriority.LOW,
        quantity=2,
        unit_of_measure="pcs",
        amount=15400.00,
        raw_materials=[
            {"name": "Cast housing blank", "quantity": 2, "unit": "pcs"},
        ],
        assigned_worker_id=workers[2][0].id,
        created_by_id=admin.id,
    )

    db.session.add_all([job1, job2, job3])
    db.session.flush()

    ops = [
        Operation(
            job_order_id=job1.id, seq=1, name="Milling",
            machines_needed=["MILLING"], status=OperationStatus.PENDING,
        ),
        Operation(
            job_order_id=job1.id, seq=2, name="Grinding",
            machines_needed=["GRINDING"], status=OperationStatus.PENDING,
        ),
        Operation(
            job_order_id=job2.id, seq=1, name="Welding",
            machines_needed=[], status=OperationStatus.COMPLETED,
        ),
        Operation(
            job_order_id=job2.id, seq=2, name="Grinding",
            machines_needed=["GRINDING"], status=OperationStatus.IN_PROGRESS,
        ),
        Operation(
            job_order_id=job2.id, seq=3, name="Finishing",
            machines_needed=["DRILLING"], status=OperationStatus.PENDING,
        ),
        Operation(
            job_order_id=job3.id, seq=1, name="Milling",
            machines_needed=["MILLING"], status=OperationStatus.PENDING,
        ),
        Operation(
            job_order_id=job3.id, seq=2, name="Lathe work",
            machines_needed=["LATHE"], status=OperationStatus.PENDING,
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
