"""Machine type names end in "Machine" ("Lathe Machine"); unit names stay short
("Lathe #1") and the old names are still accepted wherever a type is matched
by name."""

import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.constants.machines import machine_type_name_aliases, machine_unit_prefix
from app.extensions import db
from app.models.machine import MachineType, MachineUnit
from app.models.user import User
from app.models.worker_skill import WorkerSkill
from app.services.employee_import_service import import_employees
from app.services.operation_service import create_machine_unit
from app.services.reference_data_service import load_reference_data

MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "versions" / "048_machine_type_names.py"
HEADER = "full_name,nickname,role,machine_skills,default_units\n"


def _run_migration(direction):
    spec = importlib.util.spec_from_file_location("m048", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    ctx = MigrationContext.configure(db.session.connection())
    with Operations.context(ctx):
        getattr(module, direction)()
    db.session.expire_all()


def _types(*pairs):
    rows = [MachineType(code=code, name=name, units=1) for code, name in pairs]
    db.session.add_all(rows)
    db.session.flush()
    return {mt.code: mt for mt in rows}


def test_migration_renames_only_exact_old_names(app):
    _types(
        ("LATHE", "Lathe"),
        ("MILLING", "Milling"),
        ("SHAPER", "Shaper"),
        ("GRINDING", "Grinding"),
        ("DRILLING", "Drilling"),
        ("BENDING", "Bending Machine"),
        ("LASER", "Laser"),
        ("CNC", "CNC Lathe"),
        ("OLD", "lathe"),
    )

    _run_migration("upgrade")

    names = {mt.code: mt.name for mt in MachineType.query.all()}
    assert names == {
        "LATHE": "Lathe Machine",
        "MILLING": "Milling Machine",
        "SHAPER": "Shaper Machine",
        "GRINDING": "Grinding Machine",
        "DRILLING": "Drilling Machine",
        "BENDING": "Bending Machine",
        "LASER": "Laser Machine",
        "CNC": "CNC Lathe",
        "OLD": "lathe",
    }

    _run_migration("downgrade")
    names = {mt.code: mt.name for mt in MachineType.query.all()}
    assert names["LATHE"] == "Lathe" and names["DRILLING"] == "Drilling"
    assert names["BENDING"] == "Bending Machine" and names["LASER"] == "Laser Machine"


def test_reference_loader_renames_old_names_and_keeps_short_unit_labels(app):
    lathe = _types(("LATHE", "Lathe"))["LATHE"]
    for n in range(1, 8):
        db.session.add(MachineUnit(machine_type_id=lathe.id, label=f"Lathe #{n}", active=True))
    db.session.commit()

    report = load_reference_data()

    names = {mt.code: mt.name for mt in MachineType.query.all()}
    assert names["LATHE"] == "Lathe Machine"
    assert names["MILLING"] == "Milling Machine"
    assert names["SHAPER"] == "Shaper Machine"
    assert names["GRINDING"] == "Grinding Machine"
    assert names["DRILLING"] == "Drilling Machine"
    assert "Machine type LATHE: name 'Lathe' -> 'Lathe Machine'" in report.changes
    lathe_labels = {
        u.label for u in MachineUnit.query.filter_by(machine_type_id=lathe.id).all()
    }
    assert lathe_labels == {f"Lathe #{n}" for n in range(1, 9)}
    assert not MachineUnit.query.filter(MachineUnit.label.like("%Machine #%")).count()
    assert load_reference_data().changes == []


def test_reference_loader_keeps_a_name_the_shop_chose(app):
    _types(("LATHE", "Big Lathe"))
    db.session.commit()
    load_reference_data()
    assert MachineType.query.filter_by(code="LATHE").one().name == "Big Lathe"


def test_reference_loader_matches_an_old_name_without_the_code(app):
    legacy = _types(("LTH", "Lathe"))["LTH"]
    db.session.commit()

    load_reference_data()

    assert MachineType.query.filter(MachineType.name.ilike("lathe%")).count() == 1
    assert db.session.get(MachineType, legacy.id).name == "Lathe Machine"


def test_import_accepts_old_and_new_type_names(app, tmp_path):
    _types(
        ("LATHE", "Lathe Machine"),
        ("MILLING", "Milling Machine"),
        ("LASER", "Laser Machine"),
        ("BENDING", "Bending Machine"),
        ("GRINDING", "Grinding Machine"),
    )
    db.session.commit()
    path = tmp_path / "employees.local.csv"
    path.write_text(
        HEADER
        + "Ana Old,,WORKER,Lathe;Milling;laser,\n"
        + "Ben New,,WORKER,Lathe Machine;BENDING;grinding machine,\n",
        encoding="utf-8",
    )

    report = import_employees(path)

    assert report.problems == []

    def skills(name):
        user = User.query.filter_by(full_name=name).one()
        return {s.machine_type.code for s in WorkerSkill.query.filter_by(worker_id=user.id)}

    assert skills("Ana Old") == {"LATHE", "MILLING", "LASER"}
    assert skills("Ben New") == {"LATHE", "BENDING", "GRINDING"}


def test_import_still_works_before_the_rename(app, tmp_path):
    _types(("LATHE", "Lathe"), ("MILLING", "Milling"))
    db.session.commit()
    path = tmp_path / "employees.local.csv"
    path.write_text(HEADER + "Cy Old,,WORKER,Lathe Machine;Milling,\n", encoding="utf-8")
    assert import_employees(path).problems == []


def test_aliases_and_short_prefix(app):
    t = _types(("LATHE", "Lathe Machine"), ("CNC", "CNC Router Machine"), ("SAW", "Band Saw"))
    assert machine_unit_prefix(t["LATHE"]) == "Lathe"
    assert machine_unit_prefix(t["CNC"]) == "CNC Router"
    assert machine_unit_prefix(t["SAW"]) == "Band Saw"
    assert {"Lathe", "Lathe Machine", "LATHE"} <= machine_type_name_aliases(t["LATHE"])
    assert {"Band Saw", "Band Saw Machine", "SAW"} <= machine_type_name_aliases(t["SAW"])


def test_new_unit_gets_a_short_label(app):
    milling = _types(("MILLING", "Milling Machine"))["MILLING"]
    for n in range(1, 9):
        db.session.add(MachineUnit(machine_type_id=milling.id, label=f"Milling #{n}", active=True))
    db.session.commit()
    unit = create_machine_unit(milling.id)
    assert unit.label == "Milling #9"

