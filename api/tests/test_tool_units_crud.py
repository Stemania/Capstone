"""Tools: units are added (one, or several numbered), edited, and removed.
A unit or tool that was borrowed keeps its history: it is retired, not deleted.
Stock never comes in through a direct receive."""

import pytest
from flask_jwt_extended import create_access_token

from app.extensions import db
from app.models.tool_event import ToolEvent, ToolEventType
from app.models.tool_type import ToolType, ToolUnit, ToolUnitStatus
from app.models.user import User, UserRole, UserStatus


def _user(email, role):
    u = User(email=email, password_hash="x", full_name=email.split("@")[0], role=role,
             status=UserStatus.ACTIVE, active=True)
    db.session.add(u)
    db.session.commit()
    return u


def _h(user):
    tok = create_access_token(identity=user.id, additional_claims={"role": user.role.value})
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture
def office(app):
    return _user("tu_office@test.local", UserRole.OFFICE_STAFF)


@pytest.fixture
def worker(app):
    return _user("tu_worker@test.local", UserRole.PRODUCTION_WORKER)


def _type(code="VC"):
    t = ToolType(name="Vernier caliper", code=code)
    db.session.add(t)
    db.session.commit()
    return t


def test_add_several_units_numbers_them_after_the_highest(client, office):
    t = _type()
    db.session.add(ToolUnit(tool_type_id=t.id, asset_code="VC-007"))
    db.session.commit()
    res = client.post(f"/api/v1/tools/types/{t.id}/units", json={"quantity": 3}, headers=_h(office))
    assert res.status_code == 201, res.get_json()
    assert [u["assetCode"] for u in res.get_json()["created"]] == ["VC-008", "VC-009", "VC-010"]
    bad = client.post(f"/api/v1/tools/types/{t.id}/units", json={"quantity": 2, "assetCode": "X"},
                      headers=_h(office))
    assert bad.status_code == 400


def test_edit_type_and_unit(client, office):
    t = _type()
    unit = ToolUnit(tool_type_id=t.id, asset_code="VC-001")
    db.session.add(unit)
    db.session.commit()
    assert client.patch(f"/api/v1/tools/types/{t.id}", json={"name": "Digital caliper"},
                        headers=_h(office)).status_code == 200
    res = client.patch(f"/api/v1/tools/units/{unit.id}", json={"assetCode": "VC-101", "notes": "Shelf B"},
                       headers=_h(office))
    assert res.status_code == 200 and res.get_json()["assetCode"] == "VC-101"


def test_remove_unit_deletes_or_retires(client, office, worker):
    t = _type()
    fresh = ToolUnit(tool_type_id=t.id, asset_code="VC-001")
    used = ToolUnit(tool_type_id=t.id, asset_code="VC-002")
    out = ToolUnit(tool_type_id=t.id, asset_code="VC-003", status=ToolUnitStatus.OUT,
                   current_holder_id=worker.id)
    db.session.add_all([fresh, used, out])
    db.session.flush()
    db.session.add(ToolEvent(tool_unit_id=used.id, worker_id=worker.id, type=ToolEventType.BORROW))
    db.session.add(ToolEvent(tool_unit_id=used.id, worker_id=worker.id, type=ToolEventType.RETURN))
    db.session.commit()
    fresh_id, used_id = fresh.id, used.id

    assert client.delete(f"/api/v1/tools/units/{fresh_id}", headers=_h(office)).get_json()["result"] == "DELETED"
    assert db.session.get(ToolUnit, fresh_id) is None

    res = client.delete(f"/api/v1/tools/units/{used_id}", headers=_h(office)).get_json()
    assert res["result"] == "RETIRED"
    assert ToolEvent.query.filter_by(tool_unit_id=used_id).count() == 2

    assert client.delete(f"/api/v1/tools/units/{out.id}", headers=_h(office)).status_code == 409


def test_remove_type_only_without_borrow_history(client, office, worker):
    clean = _type("CL")
    db.session.add(ToolUnit(tool_type_id=clean.id, asset_code="CL-001"))
    used = _type("US")
    u = ToolUnit(tool_type_id=used.id, asset_code="US-001")
    db.session.add(u)
    db.session.flush()
    db.session.add(ToolEvent(tool_unit_id=u.id, worker_id=worker.id, type=ToolEventType.BORROW))
    db.session.commit()
    clean_id = clean.id

    assert client.delete(f"/api/v1/tools/types/{clean_id}", headers=_h(office)).status_code == 200
    assert db.session.get(ToolType, clean_id) is None
    res = client.delete(f"/api/v1/tools/types/{used.id}", headers=_h(office))
    assert res.status_code == 409
    assert "Retire its units" in res.get_json()["error"]["message"]


def test_no_direct_receive(client, office):
    t = _type()
    assert client.post(f"/api/v1/tools/types/{t.id}/receive", json={"quantity": 1, "supplier": "X"},
                       headers=_h(office)).status_code in (404, 405)
