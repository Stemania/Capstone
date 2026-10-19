"""flask export-people / import-people — fake fixture names only."""

from datetime import time
from pathlib import Path

import pytest

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.machine import MachineType, MachineUnit
from app.models.user import User, UserRole, UserStatus
from app.models.worker_profile import WorkerProfile
from app.models.worker_skill import WorkerSchedule, WorkerSkill
from app.services import people_sync_service as people
from app.services.seed_cleanup_service import REAL_CLIENTS
from app.services.worker_profile_service import is_assignable_worker, query_assignable_workers


def _user(email, role, name, *, status=UserStatus.ACTIVE):
    user = User(
        email=email,
        password_hash=bcrypt.generate_password_hash("Passw0rd!").decode("utf-8"),
        full_name=name,
        role=role,
        status=status,
        active=(status == UserStatus.ACTIVE),
    )
    db.session.add(user)
    db.session.flush()
    return user


def _worker(email, name, *, status=UserStatus.INVITED):
    u = _user(email, UserRole.PRODUCTION_WORKER, name, status=status)
    db.session.add(WorkerProfile(user_id=u.id))
    db.session.flush()
    return u


@pytest.fixture
def shop(app):
    mt = MachineType(code="LATHE-X", name="Fixture Lathe")
    db.session.add(mt)
    db.session.flush()
    unit = MachineUnit(machine_type_id=mt.id, label="Lathe Unit F1", active=True)
    db.session.add(unit)

    for name in REAL_CLIENTS:
        db.session.add(Client(name=name))

    admin = _user("people_admin@test.example", UserRole.ADMIN, "Admin User")
    office = _user("people_office@test.example", UserRole.OFFICE_STAFF, "Office Staff")
    existing = _worker(None, "Casey River")
    existing.email = None
    existing.status = UserStatus.ACTIVE
    existing.active = True

    new_w = _worker("rio.quinn@shop.test", "Rio Quinn", status=UserStatus.INVITED)
    new_w.active = False
    db.session.add(
        WorkerSkill(
            worker_id=new_w.id,
            machine_type_id=mt.id,
            proficiency=4,
            is_primary=True,
        )
    )
    db.session.add(
        WorkerSchedule(
            worker_id=new_w.id,
            day_of_week=0,
            start_time=time(8, 0),
            end_time=time(17, 0),
            is_working=True,
        )
    )
    unit.default_operator_id = new_w.id

    seed = _worker("seed.worker@bmsc.local", "Seed Worker One")
    cyber = Client.query.filter(db.func.lower(Client.name) == "cyberage").one()
    cyber.contact = "Pat Lee"
    cyber.email = "pat.lee@cyberage.test"
    cyber.mobile_number = "09170001111"
    cyber.notify_by_email = True

    sanitary = Client.query.filter(db.func.lower(Client.name) == "sanitary care").one()
    # leave contact empty for fill-if-empty tests on import target side

    db.session.commit()
    return {
        "admin": admin,
        "office": office,
        "existing": existing,
        "new_w": new_w,
        "seed": seed,
        "mt": mt,
        "unit": unit,
        "cyber": cyber,
        "sanitary": sanitary,
    }


def test_export_shape_excludes_seed_and_staff(shop, tmp_path):
    path, payload = people.export_people(tmp_path / "people.json")
    assert path.exists()
    assert payload["version"] == people.EXPORT_VERSION
    names = {w["fullName"] for w in payload["workers"]}
    assert "Rio Quinn" in names
    assert "Casey River" in names
    assert "Seed Worker One" not in names
    assert "Admin User" not in names
    assert "Office Staff" not in names

    rio = next(w for w in payload["workers"] if w["fullName"] == "Rio Quinn")
    assert rio["email"] == "rio.quinn@shop.test"
    assert rio["status"] == "INVITED"
    assert rio["role"] == "PRODUCTION_WORKER"
    assert rio["skills"][0]["machineTypeCode"] == "LATHE-X"
    assert rio["skills"][0]["proficiency"] == 4
    assert rio["schedule"][0]["dayOfWeek"] == 0
    assert rio["schedule"][0]["startTime"] == "08:00"
    assert rio["assignedUnits"][0]["unitLabel"] == "Lathe Unit F1"
    assert "photo" not in rio and "password" not in rio

    assert set(payload["clients"]) == set(REAL_CLIENTS)
    assert payload["clients"]["CyberAge"]["contact"] == "Pat Lee"
    assert payload["clients"]["CyberAge"]["notifyByEmail"] is True
    assert payload["clients"]["Sanitary Care"]["contact"] is None


def test_import_create_skip_existing_idempotent(shop, tmp_path):
    path, _ = people.export_people(tmp_path / "people.json")

    # Wipe exportable workers + clear sanitary so import has work to do.
    for u in User.query.filter(User.role == UserRole.PRODUCTION_WORKER).all():
        if u.full_name == "Casey River":
            continue
        db.session.delete(u)
    sanitary = Client.query.filter(db.func.lower(Client.name) == "sanitary care").one()
    sanitary.contact = None
    sanitary.email = None
    sanitary.mobile_number = None
    sanitary.notify_by_email = False
    # Put contact into export for Sanitary via rewriting file after local fill
    db.session.commit()

    # Rebuild export from a payload that includes a missing worker + sanitary contact
    payload = people.build_export_payload()
    # Casey remains → skip; add a brand-new fixture worker into the JSON
    payload["workers"].append(
        {
            "fullName": "Morgan Vale",
            "role": "PRODUCTION_WORKER",
            "email": "morgan.vale@shop.test",
            "status": "INVITED",
            "schedule": [
                {
                    "dayOfWeek": 1,
                    "startTime": "09:00",
                    "endTime": "18:00",
                    "isWorking": True,
                }
            ],
            "skills": [
                {
                    "machineTypeCode": "LATHE-X",
                    "machineTypeName": "Fixture Lathe",
                    "proficiency": 3,
                    "isPrimary": True,
                },
                {
                    "machineTypeCode": "NOPE",
                    "machineTypeName": "Missing Mill",
                    "proficiency": 2,
                    "isPrimary": False,
                },
            ],
            "assignedUnits": [
                {
                    "machineTypeCode": "LATHE-X",
                    "machineTypeName": "Fixture Lathe",
                    "unitLabel": "Lathe Unit F1",
                },
                {
                    "machineTypeCode": "LATHE-X",
                    "machineTypeName": "Fixture Lathe",
                    "unitLabel": "Ghost Unit",
                },
            ],
        }
    )
    payload["clients"]["Sanitary Care"] = {
        "contact": "Sam Frost",
        "email": "sam.frost@sanitary.test",
        "mobileNumber": "09170002222",
        "notifyByEmail": True,
    }
    # CyberAge already has contact on target — must not overwrite
    payload["clients"]["CyberAge"] = {
        "contact": "SHOULD NOT APPLY",
        "email": "nope@cyberage.test",
        "mobileNumber": "000",
        "notifyByEmail": False,
    }
    path.write_text(__import__("json").dumps(payload), encoding="utf-8")

    from app.services.seed_cleanup_service import database_label

    host = database_label()[1]
    before_users = User.query.count()
    before_cyber_contact = (
        Client.query.filter(db.func.lower(Client.name) == "cyberage").one().contact
    )

    dry = people.import_people(path, apply=False)
    assert dry.has_work()
    assert User.query.count() == before_users
    assert Client.query.filter(db.func.lower(Client.name) == "sanitary care").one().contact is None

    first = people.import_people(path, apply=True, confirm_host=host)
    assert "Morgan Vale" in first.workers_created
    assert "Casey River" in first.workers_skipped_existing
    assert first.skills_added >= 1
    assert any("Missing Mill" in s or "NOPE" in s for s in first.skills_skipped_missing_type)
    assert any("Ghost Unit" in s for s in first.units_skipped_missing)
    assert User.query.filter_by(full_name="Morgan Vale").count() == 1
    morgan = User.query.filter_by(full_name="Morgan Vale").one()
    assert morgan.status == UserStatus.INVITED
    assert morgan.password_hash is None
    assert morgan.active is False
    assert WorkerSkill.query.filter_by(worker_id=morgan.id).count() == 1
    assert WorkerSchedule.query.filter_by(worker_id=morgan.id).count() == 1

    sanitary = Client.query.filter(db.func.lower(Client.name) == "sanitary care").one()
    assert sanitary.contact == "Sam Frost"
    assert sanitary.email == "sam.frost@sanitary.test"
    assert sanitary.notify_by_email is True
    cyber = Client.query.filter(db.func.lower(Client.name) == "cyberage").one()
    assert cyber.contact == before_cyber_contact

    second = people.import_people(path, apply=True, confirm_host=host)
    assert second.nothing_to_do
    assert second.workers_created == []
    assert not second.clients_filled


def test_import_dry_run_leaves_db_unchanged(shop, tmp_path):
    path, payload = people.export_people(tmp_path / "out.json")
    payload["workers"].append(
        {
            "fullName": "Drew North",
            "role": "PRODUCTION_WORKER",
            "email": None,
            "status": "INVITED",
            "schedule": [],
            "skills": [],
            "assignedUnits": [],
        }
    )
    path.write_text(__import__("json").dumps(payload), encoding="utf-8")
    before = {u.full_name for u in User.query.all()}
    report = people.import_people(path, apply=False)
    assert "Drew North" in report.workers_created
    assert {u.full_name for u in User.query.all()} == before
    assert User.query.filter_by(full_name="Drew North").count() == 0


def test_invited_inactive_workers_remain_assignable(shop):
    """INVITED + active=False (imported employees) are still assignable.

    Only DISABLED is excluded from recommendations / operation assignment.
    """
    rio = User.query.filter_by(full_name="Rio Quinn").one()
    assert rio.status == UserStatus.INVITED
    assert rio.active is False
    assert is_assignable_worker(rio) is True
    ids = {u.id for u in query_assignable_workers().all()}
    assert rio.id in ids

    rio.status = UserStatus.DISABLED
    rio.sync_active_flag()
    db.session.commit()
    assert is_assignable_worker(rio) is False
