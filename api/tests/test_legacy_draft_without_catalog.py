"""Legacy DRAFT PO lines without materialCatalogId still issue/print/receive;
editing the material requires a catalog pick."""

from datetime import date
from decimal import Decimal

from app.extensions import db
from app.models.material_purchase import MaterialPurchase
from app.models.supplier_order import SupplierOrder, SupplierOrderStatus
from tests.catalog_helpers import ensure_material
from tests.test_supplier_orders import (  # noqa: F401
    _headers,
    _issue,
    _print,
    _receive,
    shop,
)


def _legacy_draft(shop):
    """Build a DRAFT order with a job-material line that has no catalog id."""
    order = SupplierOrder(
        supplier_id=shop["steel"].id,
        status=SupplierOrderStatus.DRAFT,
        prepared_by_id=shop["office_id"],
    )
    db.session.add(order)
    db.session.flush()
    line = MaterialPurchase(
        job_order_id=shop["job_a"].id,
        supplier_id=shop["steel"].id,
        supplier_order_id=order.id,
        material_name="Legacy bar (pre-catalog)",
        material_catalog_id=None,
        quantity=Decimal("3"),
        unit="kg",
        unit_cost=Decimal("100"),
    )
    db.session.add(line)
    db.session.commit()
    return order, line


def test_legacy_draft_without_catalog_survives_issue_print_receive(client, shop):
    order, line = _legacy_draft(shop)
    assert line.material_catalog_id is None

    # Open (GET detail)
    res = client.get(
        f"/api/v1/supplier-orders/{order.id}", headers=_headers(shop["office"])
    )
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert body["status"] == "DRAFT"
    assert body["lines"][0]["materialCatalogId"] is None
    assert body["lines"][0]["materialName"] == "Legacy bar (pre-catalog)"

    # Editing material by free-text name is refused — must pick from catalog.
    patch = client.patch(
        f"/api/v1/supplier-orders/{order.id}/lines/{line.id}",
        json={"materialName": "Renamed free text"},
        headers=_headers(shop["office"]),
    )
    assert patch.status_code == 400
    assert patch.get_json()["error"]["code"] == "VALIDATION_ERROR"

    # Qty / cost still editable without a catalog id.
    patch_qty = client.patch(
        f"/api/v1/supplier-orders/{order.id}/lines/{line.id}",
        json={"quantity": 5, "unitCost": 120},
        headers=_headers(shop["office"]),
    )
    assert patch_qty.status_code == 200, patch_qty.get_json()

    # Same legacy draft (no catalog) can be issued / printed / received.
    issued = _issue(client, shop, order.id, when="2031-04-01")
    assert issued.status_code == 200, issued.get_json()
    assert issued.get_json()["status"] == "ISSUED"
    assert issued.get_json()["lines"][0]["materialName"] == "Legacy bar (pre-catalog)"
    assert issued.get_json()["lines"][0]["materialCatalogId"] is None

    printed = _print(client, shop, order.id)
    assert printed.status_code == 200, printed.get_json()

    received = _receive(client, shop, order.id, "2031-04-05")
    assert received.status_code == 200, received.get_json()
    assert received.get_json()["status"] == "RECEIVED"

    # After the draft slot is free: editing material requires a catalog pick.
    order2, line2 = _legacy_draft(shop)
    cat_id = ensure_material("Legacy bar (pre-catalog)")
    patch_cat = client.patch(
        f"/api/v1/supplier-orders/{order2.id}/lines/{line2.id}",
        json={"materialCatalogId": cat_id},
        headers=_headers(shop["office"]),
    )
    assert patch_cat.status_code == 200, patch_cat.get_json()
    assert patch_cat.get_json()["lines"][0]["materialCatalogId"] == cat_id
