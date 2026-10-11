"""Read-only data behind the worker dashboard: own week figures, own profile, break time."""

from datetime import date, datetime, time, timedelta
from decimal import Decimal

import pytest

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.machine import MachineType, MachineUnit
from app.models.operation import JobOperation, OperationStatus
from app.models.operation_time import OperationTimeEvent, OperationTimeLog
from app.models.user import User, UserRole, UserStatus
from app.models.worker_profile import WorkerProfile
from app.models.worker_skill import WorkerSchedule, WorkerSkill
from app.services import analytics_service
from app.services.schedule_calendar import SHOP_TZ

PASSWORD = "Passw0rd!"
# A Wednesday afternoon, shop time.
NOW = datetime(2026, 3, 11, 15, 0, tzinfo=SHOP_TZ)


def _at(days_from_now, hh, mm=0):
    d = (NOW + timedelta(days=days_from_now)).date()
    return datetime.combine(d, time(hh, mm), tzinfo=SHOP_TZ)


def _user(email, role, name):
    user = User(
        email=email,
        password_hash=bcrypt.generate_password_hash(PASSWORD).decode("utf-8"),
        full_name=name,
        role=role,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    db.session.flush()
    if role == UserRole.PRODUCTION_WORKER:
        db.session.add(WorkerProfile(user_id=user.id))
    return user


def _headers(client, email):
    res = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert res.status_code == 200, res.get_json()
    return {"Authorization": f"Bearer {res.get_json()['accessToken']}"}


@pytest.fixture
def shop(app, monkeypatch):
    monkeypatch.setattr(analytics_service, "shop_now", lambda: NOW)
    with app.app_context():
        office = _user("office@home.test", UserRole.OFFICE_STAFF, "Office Person")
        ana = _user("ana@home.test", UserRole.PRODUCTION_WORKER, "Ana Worker")
        ben = _user("ben@home.test", UserRole.PRODUCTION_WORKER, "Ben Worker")
        lathe = MachineType(code="LATHE", name="Lathe", units=2)
        db.session.add(lathe)
        db.session.flush()
        db.session.add_all(
            [
                MachineUnit(machine_type_id=lathe.id, label="Lathe 2", default_operator_id=ana.id),
                MachineUnit(machine_type_id=lathe.id, label="Lathe 1", default_operator_id=ben.id),
                WorkerSkill(worker_id=ana.id, machine_type_id=lathe.id, proficiency=4, is_primary=True),
                WorkerSchedule(
                    worker_id=ana.id, day_of_week=0, start_time=time(8), end_time=time(17), is_working=True
                ),
            ]
        )
        cust = Client(name="Home Client")
        db.session.add(cust)
        db.session.flush()
        job = JobOrder(
            client_id=cust.id,
            title="Home job",
            due_date=date(2026, 4, 30),
            status=JobOrderStatus.IN_PROGRESS,
            job_type=JobType.REPAIR,
            part_condition=PartCondition.CLIENT_SUPPLIED_ITEM,
            material_status=MaterialStatus.NOT_REQUIRED,
            raw_materials=[],
            amount=Decimal("1000"),
            created_by_id=office.id,
        )
        db.session.add(job)
        db.session.flush()

        def op(worker, seq, events, status=OperationStatus.IN_PROGRESS):
            row = JobOperation(
                job_order_id=job.id,
                sequence_no=seq,
                operation_name=f"Op {seq}",
                assigned_worker_id=worker.id,
                status=status,
            )
            db.session.add(row)
            db.session.flush()
            for event, at in events:
                db.session.add(
                    OperationTimeLog(operation_id=row.id, worker_id=worker.id, event=event, event_at=at)
                )

        # This week: 2h, then running since 14:00 (1h by NOW).
        op(
            ana,
            1,
            [
                (OperationTimeEvent.START, _at(0, 8)),
                (OperationTimeEvent.PAUSE, _at(0, 10)),
                (OperationTimeEvent.RESUME, _at(0, 14)),
            ],
        )
        # Last Wednesday: 1.5h, inside the comparison window.
        op(
            ana,
            2,
            [(OperationTimeEvent.START, _at(-7, 8)), (OperationTimeEvent.COMPLETE, _at(-7, 9, 30))],
            OperationStatus.COMPLETED,
        )
        # Last Friday: after the same point last week, so not compared.
        op(
            ana,
            3,
            [(OperationTimeEvent.START, _at(-5, 8)), (OperationTimeEvent.COMPLETE, _at(-5, 9))],
            OperationStatus.COMPLETED,
        )
        # Someone else's work.
        op(ben, 4, [(OperationTimeEvent.START, _at(0, 8)), (OperationTimeEvent.PAUSE, _at(0, 12))])
        db.session.commit()
        db.session.expunge_all()


def test_week_figures_compare_the_same_days_of_last_week(client, shop):
    body = client.get("/api/v1/analytics/me", headers=_headers(client, "ana@home.test")).get_json()
    assert body["thisWeek"]["loggedHours"] == 3.0
    assert body["lastWeek"]["loggedHours"] == 1.5
    assert body["lastWeek"]["from"] == "2026-03-02"
    assert body["lastWeek"]["to"] == "2026-03-04"
    assert "thisMonth" in body


def test_me_gives_a_worker_their_own_machines_and_hours(client, shop):
    me = client.get("/api/v1/auth/me", headers=_headers(client, "ana@home.test")).get_json()
    assert [m["label"] for m in me["assignedMachines"]] == ["Lathe 2"]
    assert me["schedules"][0]["startTime"] == "08:00"
    skill = me["workerProfile"]["skills"][0]
    assert skill["machineTypeName"] == "Lathe" and skill["proficiency"] == 4

    office = client.get("/api/v1/auth/me", headers=_headers(client, "office@home.test")).get_json()
    assert "assignedMachines" not in office and "schedules" not in office


def test_board_includes_the_daily_break(client, shop):
    res = client.get(
        "/api/v1/schedule/board?from=2026-03-09&to=2026-03-15",
        headers=_headers(client, "ana@home.test"),
    )
    assert res.status_code == 200
    assert res.get_json()["shopBreak"] == {"start": "12:00", "end": "13:00"}
