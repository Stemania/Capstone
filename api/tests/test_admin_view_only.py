"""Admin has full Office write access (paper: Administrator holds full system access).

Production Worker still cannot change Office resources.
"""

from datetime import timedelta
from decimal import Decimal

import pytest

from app.extensions import db
from app.models.client import Client
from app.models.supplier import Supplier
from app.models.tool import Tool, ToolCategory
from app.models.tool_type import ToolType, ToolUnit
from tests.test_material_delay import _draft_order, _headers, _issue, _job, _local, shop  # noqa: F401

X = "00000000-0000-0000-0000-000000000000"

ADMIN_ALLOWED = [
    ("POST", "/api/v1/clients"),
    ("PATCH", f"/api/v1/clients/{X}"),
    ("POST", "/api/v1/suppliers"),
    ("PATCH", f"/api/v1/suppliers/{X}"),
    ("POST", "/api/v1/tools"),
    ("PATCH", f"/api/v1/tools/{X}"),
    ("POST", f"/api/v1/tools/{X}/adjust"),
    ("POST", f"/api/v1/tools/{X}/receive"),
    ("POST", "/api/v1/tools/types"),
    ("PATCH", f"/api/v1/tools/types/{X}"),
]


def _inventory(shop):
    consumable = Tool(
        name="Cutting disc",
        code="CD-001",
        category=ToolCategory.CONSUMABLE,
        unit="pcs",
        quantity_on_hand=Decimal("10"),
    )
    tool_type = ToolType(name="Torque wrench", code="TW")
    db.session.add_all([consumable, tool_type])
    db.session.flush()
    unit = ToolUnit(tool_type_id=tool_type.id, asset_code="TW-001")
    db.session.add(unit)
    db.session.commit()
    return consumable, tool_type, unit


def test_admin_can_create_and_update_clients_and_suppliers(client, shop):
    h = _headers(shop["admin"])
    res = client.post("/api/v1/clients", json={"name": "Admin Client"}, headers=h)
    assert res.status_code == 201, res.get_json()
    cid = res.get_json()["id"]
    assert (
        client.patch(f"/api/v1/clients/{cid}", json={"name": "Renamed by Admin"}, headers=h).status_code
        == 200
    )

    res = client.post(
        "/api/v1/suppliers", json={"name": "Admin Steel", "typicalLeadTimeDays": 2}, headers=h
    )
    assert res.status_code == 201, res.get_json()
    sid = res.get_json()["id"]
    assert client.patch(f"/api/v1/suppliers/{sid}", json={"phone": "0917"}, headers=h).status_code == 200


def test_admin_can_adjust_inventory_and_tool_types(client, shop):
    consumable, tool_type, unit = _inventory(shop)
    h = _headers(shop["admin"])
    assert (
        client.post(
            f"/api/v1/tools/{consumable.id}/adjust",
            json={"quantity": -2, "reason": "Damaged"},
            headers=h,
        ).status_code
        in (200, 201)
    )
    assert (
        client.post(
            f"/api/v1/tools/{consumable.id}/receive",
            json={"quantity": 5, "supplier": "Hardware"},
            headers=h,
        ).status_code
        in (200, 201)
    )
    res = client.post("/api/v1/tools/types", json={"name": "Admin Caliper"}, headers=h)
    assert res.status_code == 201, res.get_json()
    assert client.patch(f"/api/v1/tools/units/{unit.id}", json={"status": "UNDER_REPAIR"}, headers=h).status_code == 200


def test_admin_can_run_supplier_orders(client, shop):
    tomorrow = shop["today"] + timedelta(days=1)
    job, _ = _job(shop, _local(tomorrow, 9))
    h = _headers(shop["admin"])
    order = _draft_order(client, shop, job, shop["slow"])
    assert client.patch(f"/api/v1/supplier-orders/{order['id']}", json={"notes": "Rush"}, headers=h).status_code == 200
    assert client.post(f"/api/v1/supplier-orders/{order['id']}/issue", json={}, headers=h).status_code in (
        200,
        201,
    )


def test_admin_can_create_job_orders(client, shop):
    h = _headers(shop["admin"])
    res = client.post(
        "/api/v1/job-orders",
        json={
            "clientId": shop["client"].id,
            "title": "Admin-encoded job",
            "dueDate": (shop["today"] + timedelta(days=14)).isoformat(),
        },
        headers=h,
    )
    assert res.status_code == 201, res.get_json()


def test_worker_still_refused_office_writes(client, shop):
    h = _headers(shop["worker"])
    assert client.post("/api/v1/clients", json={"name": "Nope"}, headers=h).status_code == 403
    assert (
        client.post("/api/v1/suppliers", json={"name": "Nope", "typicalLeadTimeDays": 1}, headers=h).status_code
        == 403
    )
    assert client.post("/api/v1/tools", json={"name": "Nope", "unit": "pcs"}, headers=h).status_code == 403


def test_office_staff_can_still_change_everything(client, shop):
    consumable, tool_type, unit = _inventory(shop)
    h = _headers(shop["office"])
    res = client.post("/api/v1/clients", json={"name": "New Client"}, headers=h)
    assert res.status_code == 201, res.get_json()
    assert client.patch(f"/api/v1/tools/{consumable.id}", json={"minimumStock": 3}, headers=h).status_code == 200


def test_stocktake_endpoints_removed(client, shop):
    h = _headers(shop["office"])
    assert client.get("/api/v1/inventory/stocktakes", headers=h).status_code == 404
    assert client.get("/api/v1/inventory/stocktakes/form", headers=h).status_code == 404
    assert client.post("/api/v1/inventory/stocktakes", json={"lines": []}, headers=h).status_code == 404
