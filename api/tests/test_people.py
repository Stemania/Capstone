"""Real people: employee import, nicknames, photos, machine-only skills, and
Admins who can be assigned work.

Uses the bmsc_test database from conftest (schema built from the models).
"""

import io
import shutil
import subprocess
from datetime import date, time
from decimal import Decimal
from pathlib import Path

import pytest
from flask_jwt_extended import create_access_token
from PIL import Image

from app.extensions import bcrypt, db
from app.models.client import Client
from app.models.job_order import JobOrder, JobOrderStatus, JobType, MaterialStatus, PartCondition
from app.models.machine import MachineType, MachineUnit
from app.models.operation import JobOperation, OperationStatus
from app.models.user import User, UserPhoto, UserRole, UserStatus
from app.models.worker_profile import WorkerProfile
from app.models.worker_skill import OperationType, WorkerSchedule, WorkerSkill
from app.services.employee_import_service import IMPORTED_SKILL_LEVEL, import_employees
from app.services.user_photo_service import MAX_PHOTO_BYTES, resize_photo
from app.utils.errors import AppError

REPO_ROOT = Path(__file__).resolve().parents[2]
HEADER = "full_name,nickname,role,machine_skills,default_units\n"


def _user(email, role, name, *, schedule=True):
    user = User(
        email=email,
        password_hash=bcrypt.generate_password_hash("Passw0rd!").decode("utf-8"),
        full_name=name,
        role=role,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    db.session.flush()
    if role in (UserRole.PRODUCTION_WORKER, UserRole.ADMIN):
        db.session.add(WorkerProfile(user_id=user.id))
    if schedule and role in (UserRole.PRODUCTION_WORKER, UserRole.ADMIN):
        for dow in range(7):
            db.session.add(
                WorkerSchedule(
                    worker_id=user.id,
                    day_of_week=dow,
                    is_working=True,
                    start_time=time(0, 0),
                    end_time=time(23, 59),
                )
            )
    return user


def _headers(user):
    token = create_access_token(identity=user.id, additional_claims={"role": user.role.value})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def shop(app):
    admin = _user("pp_admin@test.local", UserRole.ADMIN, "Pia Admin")
    office = _user("pp_office@test.local", UserRole.OFFICE_STAFF, "Otto Office")
    ana = _user("pp_ana@test.local", UserRole.PRODUCTION_WORKER, "Ana Turner")
    ben = _user("pp_ben@test.local", UserRole.PRODUCTION_WORKER, "Ben Helper")
    lathe = MachineType(code="LATHE", name="Lathe", units=2)
    laser = MachineType(code="LASER", name="Laser", units=1)
    bending = MachineType(code="BENDING", name="Bending", units=1)
    db.session.add_all([lathe, laser, bending])
    db.session.flush()
    units = {
        "Lathe A-1": MachineUnit(machine_type_id=lathe.id, label="Lathe A-1"),
        "Lathe A-2": MachineUnit(machine_type_id=lathe.id, label="Lathe A-2"),
        "Laser L-1": MachineUnit(machine_type_id=laser.id, label="Laser L-1"),
    }
    types = {
        "TURNING": OperationType(code="TURNING", name="Turning", default_machine_type_id=lathe.id),
        "LASER_CUT": OperationType(code="LASER_CUT", name="Laser cutting", default_machine_type_id=laser.id),
        "BEND": OperationType(code="BEND", name="Bending", default_machine_type_id=bending.id),
        "LAYOUT": OperationType(code="LAYOUT", name="Layout"),
        "CHECKING": OperationType(code="CHECKING", name="Checking"),
    }
    client_row = Client(name="PP Client")
    db.session.add_all([*units.values(), *types.values(), client_row])
    db.session.add(WorkerSkill(worker_id=ana.id, machine_type_id=lathe.id, proficiency=4))
    db.session.commit()
    return {
        "admin": admin,
        "office": office,
        "ana": ana,
        "ben": ben,
        "lathe": lathe,
        "laser": laser,
        "bending": bending,
        "units": units,
        "types": types,
        "client": client_row,
    }


def _job(shop, status=JobOrderStatus.SCHEDULED):
    job = JobOrder(
        client_id=shop["client"].id,
        title="PP Job",
        due_date=date(2031, 6, 1),
        status=status,
        job_type=JobType.FABRICATION,
        part_condition=PartCondition.RAW_MATERIAL,
        material_status=MaterialStatus.NOT_REQUIRED,
        created_by_id=shop["office"].id,
    )
    db.session.add(job)
    db.session.flush()
    return job


def _op(job, seq, op_type, *, worker=None, status=OperationStatus.SCHEDULED):
    op = JobOperation(
        job_order_id=job.id,
        sequence_no=seq,
        operation_name=op_type.name,
        operation_type_id=op_type.id,
        machine_type_id=op_type.default_machine_type_id,
        assigned_worker_id=worker.id if worker else None,
        estimated_hours=Decimal("2"),
        status=status,
    )
    db.session.add(op)
    db.session.commit()
    return op


def _assign(client, shop, op, worker):
    return client.patch(
        f"/api/v1/operations/{op.id}/assign",
        json={"assignedWorkerId": worker.id},
        headers=_headers(shop["admin"]),
    )


def _csv(tmp_path, body, name="employees.local.csv"):
    path = tmp_path / name
    path.write_text(HEADER + body, encoding="utf-8")
    return path


# 1. Employee import


def test_employee_file_is_ignored_by_git():
    if not shutil.which("git") or not (REPO_ROOT / ".git").exists():
        pytest.skip("git is not available here")
    for rel in ("api/data/employees.local.csv", "api/data/anything.local.csv"):
        res = subprocess.run(
            ["git", "check-ignore", "-q", rel], cwd=REPO_ROOT, capture_output=True
        )
        assert res.returncode == 0, f"{rel} is not ignored by git"
    tracked = subprocess.run(
        ["git", "ls-files", "api/data"], cwd=REPO_ROOT, capture_output=True, text=True
    ).stdout
    assert ".local.csv" not in tracked


SAMPLE = (
    "Carla Cruz,CC,WORKER,Lathe;Laser,Lathe A-2\n"
    "Dan Diaz,,WORKER,ALL,\n"
    "Pia Admin,PIA,ADMIN,Laser,Laser L-1\n"
    "Olga Ortiz,OO,OFFICE,,\n"
)


def test_dry_run_saves_nothing(shop, tmp_path):
    users_before = User.query.count()
    skills_before = WorkerSkill.query.count()

    report = import_employees(_csv(tmp_path, SAMPLE), dry_run=True)

    assert report.created == [
        "Carla Cruz (CC), WORKER, not activated",
        "Dan Diaz, WORKER, not activated",
        "Olga Ortiz (OO), OFFICE, not activated",
    ]
    assert any(c.startswith("Pia Admin:") for c in report.changes)
    assert report.problems == []
    db.session.expire_all()
    assert User.query.count() == users_before
    assert WorkerSkill.query.count() == skills_before
    assert db.session.get(MachineUnit, shop["units"]["Lathe A-2"].id).default_operator_id is None


def test_import_creates_unactivated_accounts_and_is_idempotent(shop, tmp_path):
    path = _csv(tmp_path, SAMPLE)
    import_employees(path)

    carla = User.query.filter_by(full_name="Carla Cruz").one()
    assert carla.role == UserRole.PRODUCTION_WORKER
    assert carla.status == UserStatus.INVITED
    assert carla.email is None and carla.password_hash is None
    assert carla.nickname == "CC"
    levels = {s.machine_type_id: s.proficiency for s in WorkerSkill.query.filter_by(worker_id=carla.id)}
    assert levels == {
        shop["lathe"].id: IMPORTED_SKILL_LEVEL,
        shop["laser"].id: IMPORTED_SKILL_LEVEL,
    }
    assert WorkerSchedule.query.filter_by(worker_id=carla.id, is_working=True).count() == 6
    assert db.session.get(MachineUnit, shop["units"]["Lathe A-2"].id).default_operator_id == carla.id

    dan = User.query.filter_by(full_name="Dan Diaz").one()
    assert WorkerSkill.query.filter_by(worker_id=dan.id).count() == 3

    admin = shop["admin"]
    assert admin.nickname == "PIA"
    assert WorkerSkill.query.filter_by(worker_id=admin.id, machine_type_id=shop["laser"].id).count() == 1
    assert db.session.get(MachineUnit, shop["units"]["Laser L-1"].id).default_operator_id == admin.id

    olga = User.query.filter_by(full_name="Olga Ortiz").one()
    assert olga.role == UserRole.OFFICE_STAFF
    assert WorkerSkill.query.filter_by(worker_id=olga.id).count() == 0

    # The Admin adjusts a level; running the file again keeps it and changes nothing.
    skill = WorkerSkill.query.filter_by(worker_id=carla.id, machine_type_id=shop["lathe"].id).one()
    skill.proficiency = 5
    db.session.commit()
    users_before = User.query.count()

    again = import_employees(path)
    assert again.created == [] and again.changes == [] and again.problems == []
    assert again.unchanged == 4
    assert User.query.count() == users_before
    db.session.expire_all()
    assert db.session.get(WorkerSkill, skill.id).proficiency == 5


def test_unknown_names_are_reported_not_guessed(shop, tmp_path):
    body = "Eve Estrada,,WORKER,Lathe;Plasma Cutter,Lathe Z-9\n"
    report = import_employees(_csv(tmp_path, body))

    assert "line 2 (Eve Estrada): machine type 'Plasma Cutter' not found" in report.problems
    assert "line 2 (Eve Estrada): unit 'Lathe Z-9' not found" in report.problems
    eve = User.query.filter_by(full_name="Eve Estrada").one()
    skills = WorkerSkill.query.filter_by(worker_id=eve.id).all()
    assert [s.machine_type_id for s in skills] == [shop["lathe"].id]
    assert MachineUnit.query.filter_by(default_operator_id=eve.id).count() == 0


def test_import_keeps_an_existing_default_operator(shop, tmp_path):
    unit = shop["units"]["Lathe A-1"]
    unit.default_operator_id = shop["ana"].id
    db.session.commit()

    report = import_employees(_csv(tmp_path, "Ben Helper,BH,WORKER,Lathe,Lathe A-1\n"))

    assert any("Lathe A-1 already has Ana Turner" in p for p in report.problems)
    assert db.session.get(MachineUnit, unit.id).default_operator_id == shop["ana"].id


def test_import_command_dry_run(app, shop, tmp_path):
    path = _csv(tmp_path, SAMPLE)
    result = app.test_cli_runner().invoke(args=["import-employees", "--file", str(path), "--dry-run"])
    assert result.exit_code == 0, result.output
    assert "Would create (3):" in result.output
    assert "Dry run: nothing was saved." in result.output
    assert User.query.filter_by(full_name="Carla Cruz").count() == 0


def test_imported_worker_can_be_assigned_before_activating(client, shop, tmp_path):
    import_employees(_csv(tmp_path, "Gus Garcia,GG,WORKER,,\n"))
    gus = User.query.filter_by(full_name="Gus Garcia").one()
    op = _op(_job(shop), 1, shop["types"]["LAYOUT"])

    res = _assign(client, shop, op, gus)
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["assignedWorkerNickname"] == "GG"

    listed = client.get("/api/v1/workers", headers=_headers(shop["admin"])).get_json()
    assert "Gus Garcia" in {w["fullName"] for w in listed}

    # No password yet: they must activate before signing in to record work.
    res = client.post("/api/v1/auth/login", json={"email": "Gus Garcia", "password": "x"})
    assert res.status_code in (400, 401, 403)


def test_imported_people_get_no_seeded_history(shop, tmp_path):
    import_employees(_csv(tmp_path, "Hana Ho,,WORKER,Lathe,\n"))
    hana = User.query.filter_by(full_name="Hana Ho").one()
    assert JobOperation.query.filter_by(assigned_worker_id=hana.id).count() == 0
    assert not (hana.email or "").endswith("@bmsc.local")


# 2. Nicknames


def test_nickname_is_saved_and_returned(client, shop):
    res = client.patch(
        f"/api/v1/users/{shop['ben'].id}",
        json={"nickname": "  BH  "},
        headers=_headers(shop["admin"]),
    )
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["nickname"] == "BH"

    res = client.patch(
        f"/api/v1/users/{shop['ben'].id}", json={"nickname": ""}, headers=_headers(shop["admin"])
    )
    assert res.get_json()["nickname"] is None


# 3. Photos


def _image_bytes(fmt, size=(640, 400), mode="RGB", color=(200, 30, 30)):
    buf = io.BytesIO()
    Image.new(mode, size, color).save(buf, format=fmt)
    return buf.getvalue()


def test_photo_is_resized_to_a_128px_jpeg():
    out = Image.open(io.BytesIO(resize_photo(_image_bytes("JPEG"))))
    assert out.format == "JPEG"
    assert out.size == (128, 128)


def test_transparent_png_is_flattened_onto_white():
    raw = _image_bytes("PNG", size=(300, 300), mode="RGBA", color=(0, 0, 0, 0))
    out = Image.open(io.BytesIO(resize_photo(raw)))
    assert out.format == "JPEG" and out.size == (128, 128)
    r, g, b = out.convert("RGB").getpixel((64, 64))
    assert min(r, g, b) > 245


def test_photo_size_limit_and_format():
    with pytest.raises(AppError) as too_big:
        resize_photo(b"\xff" * (MAX_PHOTO_BYTES + 1))
    assert too_big.value.status_code == 413
    for raw in (b"not an image", _image_bytes("GIF")):
        with pytest.raises(AppError) as bad:
            resize_photo(raw)
        assert bad.value.status_code == 400


def _upload(client, shop, user, raw, filename="me.jpg"):
    return client.post(
        f"/api/v1/users/{user.id}/photo",
        data={"file": (io.BytesIO(raw), filename)},
        content_type="multipart/form-data",
        headers=_headers(shop["admin"]),
    )


def test_admin_uploads_a_photo_stored_in_the_database(client, shop):
    ana = shop["ana"]
    res = _upload(client, shop, ana, _image_bytes("PNG"), "ana.png")
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["photoVersion"]
    row = db.session.get(UserPhoto, ana.id)
    assert Image.open(io.BytesIO(row.data)).size == (128, 128)

    res = client.get(f"/api/v1/users/{ana.id}/photo", headers=_headers(shop["office"]))
    assert res.status_code == 200
    assert res.headers["Content-Type"] == "image/jpeg"

    assert _upload(client, shop, ana, b"\xff" * (MAX_PHOTO_BYTES + 1)).status_code == 413
    assert _upload(client, shop, ana, b"plain text", "notes.jpg").status_code == 400

    other = client.post(
        f"/api/v1/users/{ana.id}/photo",
        data={"file": (io.BytesIO(_image_bytes("JPEG")), "x.jpg")},
        content_type="multipart/form-data",
        headers=_headers(shop["office"]),
    )
    assert other.status_code == 403

    res = client.delete(f"/api/v1/users/{ana.id}/photo", headers=_headers(shop["admin"]))
    assert res.status_code == 200 and res.get_json()["photoVersion"] is None
    assert db.session.get(UserPhoto, ana.id) is None


def test_workers_only_see_photos_of_people_on_their_jobs(client, shop):
    ana, ben, admin = shop["ana"], shop["ben"], shop["admin"]
    for person in (ana, ben, admin):
        assert _upload(client, shop, person, _image_bytes("JPEG")).status_code == 200

    def can_see(viewer, target):
        res = client.get(f"/api/v1/users/{target.id}/photo", headers=_headers(viewer))
        return res.status_code == 200

    assert can_see(ben, ben)
    assert not can_see(ben, ana)
    assert not can_see(ben, admin)

    job = _job(shop)
    _op(job, 1, shop["types"]["LAYOUT"], worker=ben)
    _op(job, 2, shop["types"]["CHECKING"], worker=admin)
    assert can_see(ben, admin)
    assert not can_see(ben, ana)


# 4. Skills are for machines only


def test_admins_count_in_the_machine_skill_fallback(client, shop):
    job = _job(shop)
    # Nobody has Laser or Bending yet: open to everyone.
    assert _assign(client, shop, _op(job, 1, shop["types"]["LASER_CUT"]), shop["ben"]).status_code == 200
    assert _assign(client, shop, _op(job, 2, shop["types"]["BEND"]), shop["ben"]).status_code == 200

    # An Admin's Laser skill counts like a worker's: Laser is now limited to them.
    db.session.add(WorkerSkill(worker_id=shop["admin"].id, machine_type_id=shop["laser"].id, proficiency=3))
    db.session.commit()
    laser_op = _op(job, 3, shop["types"]["LASER_CUT"])
    res = _assign(client, shop, laser_op, shop["ben"])
    assert res.status_code == 400
    assert res.get_json()["error"]["code"] == "WORKER_NOT_QUALIFIED"
    assert _assign(client, shop, laser_op, shop["admin"]).status_code == 200

    body = {"operationTypeId": shop["types"]["LASER_CUT"].id, "machineTypeId": shop["laser"].id}
    res = client.post("/api/v1/workers/suggest", json=body, headers=_headers(shop["admin"]))
    assert [s["fullName"] for s in res.get_json()["suggestions"]] == ["Pia Admin"]

    # Bending is still open to all.
    assert _assign(client, shop, _op(job, 4, shop["types"]["BEND"]), shop["ana"]).status_code == 200


def test_operation_type_skills_are_rejected(client, shop):
    res = client.put(
        f"/api/v1/workers/{shop['ben'].id}/skills",
        json={"skills": [{"operationTypeId": shop["types"]["LAYOUT"].id, "proficiency": 3}]},
        headers=_headers(shop["admin"]),
    )
    assert res.status_code == 400
    assert "machine" in res.get_json()["error"]["message"].lower()


# 5. Admins can be assigned


def test_checking_stays_with_admins(client, shop):
    checking = shop["types"]["CHECKING"]
    admin_headers = _headers(shop["admin"])
    op = _op(_job(shop), 1, checking)

    res = _assign(client, shop, op, shop["ben"])
    assert res.status_code == 400
    assert res.get_json()["error"]["code"] == "CHECKING_ADMIN_ONLY"
    assert _assign(client, shop, op, shop["admin"]).status_code == 200

    body = {"operationTypeId": checking.id, "operationName": "Checking"}
    res = client.post("/api/v1/workers/suggest", json=body, headers=admin_headers)
    assert {s["fullName"] for s in res.get_json()["suggestions"]} == {"Pia Admin"}

    listed = client.get(
        f"/api/v1/workers?operationTypeId={checking.id}", headers=admin_headers
    ).get_json()
    assert {w["role"] for w in listed} == {"ADMIN"}
    listed = client.get("/api/v1/workers?operationName=Checking", headers=admin_headers).get_json()
    assert {w["role"] for w in listed} == {"ADMIN"}

    # Saving a draft with a worker on Checking is refused too.
    draft = _job(shop, status=JobOrderStatus.DRAFT)
    res = client.patch(
        f"/api/v1/job-orders/{draft.id}",
        json={
            "operations": [
                {
                    "operationTypeId": checking.id,
                    "operationName": "Checking",
                    "assignedWorkerId": shop["ana"].id,
                    "estimatedHours": 1,
                }
            ]
        },
        headers=admin_headers,
    )
    assert res.status_code == 400
    assert res.get_json()["error"]["code"] == "CHECKING_ADMIN_ONLY"


def test_imported_admin_can_do_checking(client, shop, tmp_path):
    import_employees(_csv(tmp_path, "Ivy Inspector,II,ADMIN,,\n"))
    ivy = User.query.filter_by(full_name="Ivy Inspector").one()
    op = _op(_job(shop), 1, shop["types"]["CHECKING"])
    assert _assign(client, shop, op, ivy).status_code == 200


def test_admin_is_suggested_and_on_the_board(client, shop):
    body = {"operationTypeId": shop["types"]["LAYOUT"].id, "operationName": "Layout"}
    res = client.post("/api/v1/workers/suggest", json=body, headers=_headers(shop["admin"]))
    by_name = {s["fullName"]: s for s in res.get_json()["suggestions"]}
    assert by_name["Pia Admin"]["role"] == "ADMIN"

    res = client.get(
        "/api/v1/schedule/board?from=2031-03-10&to=2031-03-16", headers=_headers(shop["office"])
    )
    assert res.status_code == 200, res.get_json()
    assert "Pia Admin" in {w["fullName"] for w in res.get_json()["workers"]}


def test_admin_records_their_own_assignment(client, shop):
    admin = shop["admin"]
    db.session.add(WorkerSkill(worker_id=admin.id, machine_type_id=shop["lathe"].id, proficiency=3))
    db.session.commit()
    job = _job(shop)
    op = _op(job, 1, shop["types"]["TURNING"])
    assert _assign(client, shop, op, admin).status_code == 200

    headers = _headers(admin)
    mine = client.get("/api/v1/operations/mine", headers=headers)
    assert mine.status_code == 200
    assert [o["id"] for o in mine.get_json()] == [op.id]
    assert client.get("/api/v1/operations/mine", headers=_headers(shop["office"])).status_code == 403

    url = f"/api/v1/operations/{op.id}"
    res = client.post(f"{url}/start", json={}, headers=headers)
    assert res.status_code == 200, res.get_json()
    res = client.post(f"{url}/pause", json={"reason": "BREAK"}, headers=headers)
    assert res.status_code == 200, res.get_json()
    res = client.post(f"{url}/resume", json={}, headers=headers)
    assert res.status_code == 200, res.get_json()
    res = client.post(f"{url}/complete", json={}, headers=headers)
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["status"] == "COMPLETED"

    # Someone else's operation stays theirs.
    other = _op(job, 2, shop["types"]["LAYOUT"], worker=shop["ben"])
    assert client.post(f"/api/v1/operations/{other.id}/start", json={}, headers=headers).status_code == 403


def test_disabled_admin_cannot_be_assigned(client, shop):
    second = _user("pp_admin2@test.local", UserRole.ADMIN, "Second Admin")
    second.status = UserStatus.DISABLED
    second.active = False
    db.session.commit()
    op = _op(_job(shop), 1, shop["types"]["LAYOUT"])
    assert _assign(client, shop, op, second).status_code == 400
