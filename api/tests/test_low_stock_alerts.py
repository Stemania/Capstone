"""Low-stock bell alerts for the Office Staff (FR-045)."""

from decimal import Decimal

import pytest

from app.extensions import db
from app.models.staff_alert import StaffAlert, StaffAlertKind
from app.models.tool import Tool, ToolCategory
from app.models.user import UserRole
from app.services import forecast_service, low_stock_service
from tests.test_material_delay import _user


@pytest.fixture
def stock(app, monkeypatch):
    with app.app_context():
        office = _user("ls_office@test.local", UserRole.OFFICE_STAFF)
        admin = _user("ls_admin@test.local", UserRole.ADMIN)
        disc = Tool(code="LS-DISC", name="Cutting disc 4in", category=ToolCategory.CONSUMABLE,
                    unit="pcs", quantity_on_hand=Decimal("3"))
        rod = Tool(code="LS-ROD", name="Welding rod", category=ToolCategory.CONSUMABLE,
                   unit="kg", quantity_on_hand=Decimal("9"))
        db.session.add_all([disc, rod])
        db.session.commit()
        status = {disc.id: forecast_service.STOCK_REORDER, rod.id: forecast_service.STOCK_REORDER_SOON}

        def fake_snapshot(tools, today=None):
            return {
                t.id: {"status": status[t.id], "reorderPoint": 5.0, "suggestedOrderQty": 20}
                for t in tools if t.id in status
            }

        monkeypatch.setattr(forecast_service, "stock_snapshot_for_tools", fake_snapshot)
        yield {"office": office, "admin": admin, "disc": disc, "rod": rod, "status": status}


def _low(user):
    return StaffAlert.query.filter_by(recipient_id=user.id, kind=StaffAlertKind.LOW_STOCK).all()


def test_item_at_reorder_level_alerts_office_staff_once(stock):
    assert low_stock_service.check_low_stock() == 1
    alerts = _low(stock["office"])
    assert len(alerts) == 1
    assert alerts[0].title == "Cutting disc 4in has reached its reorder level"
    assert "3 pcs on hand, reorder level 5 pcs" in alerts[0].message
    assert "Suggested order: 20 pcs" in alerts[0].message
    # Reorder soon is not yet an alert, and the Admin is not told.
    assert _low(stock["admin"]) == []
    # Running again does not repeat it.
    assert low_stock_service.check_low_stock() == 0
    assert len(_low(stock["office"])) == 1


def test_alerts_again_after_the_item_was_restocked(stock):
    low_stock_service.check_low_stock()
    stock["status"][stock["disc"].id] = "OK"
    assert low_stock_service.check_low_stock() == 0
    stock["status"][stock["disc"].id] = forecast_service.STOCK_REORDER
    assert low_stock_service.check_low_stock() == 1
    assert len(_low(stock["office"])) == 2


def test_runs_on_the_real_reorder_calculation(app):
    with app.app_context():
        _user("ls_office2@test.local", UserRole.OFFICE_STAFF)
        db.session.add(Tool(code="LS-NEW", name="New grinding wheel", category=ToolCategory.CONSUMABLE,
                            unit="pcs", quantity_on_hand=Decimal("0")))
        db.session.commit()
        # No usage history yet: no reorder level, so no alert and no error.
        assert low_stock_service.check_low_stock() == 0
