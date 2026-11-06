"""Restock reminders for the Office Staff: a consumable due to be bought again."""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.extensions import db
from app.models.consumable_purchase import ConsumablePurchase
from app.models.staff_alert import StaffAlert, StaffAlertKind
from app.models.tool import Tool, ToolCategory
from app.models.user import UserRole
from app.services import low_stock_service
from tests.test_material_delay import _user

TODAY = date(2031, 3, 20)


def _buy(tool, office, days_ago, qty=10):
    db.session.add(
        ConsumablePurchase(
            tool_id=tool.id,
            purchased_on=TODAY - timedelta(days=days_ago),
            quantity=Decimal(qty),
            unit=tool.unit,
            unit_cost=Decimal("40"),
            recorded_by_id=office.id,
        )
    )


@pytest.fixture
def shop(app):
    office = _user("rs_office@test.local", UserRole.OFFICE_STAFF)
    admin = _user("rs_admin@test.local", UserRole.ADMIN)
    disc = Tool(code="RS-DISC", name="Cutting disc 4in", category=ToolCategory.CONSUMABLE, unit="pcs")
    oil = Tool(code="RS-OIL", name="Cutting oil", category=ToolCategory.CONSUMABLE, unit="can")
    db.session.add_all([disc, oil])
    db.session.flush()
    # Disc: every 10 days, last 12 days ago -> overdue. Oil: every 30 days, last 5 days ago -> OK.
    for days_ago in (42, 32, 22, 12):
        _buy(disc, office, days_ago)
    for days_ago in (65, 35, 5):
        _buy(oil, office, days_ago, qty=1)
    db.session.commit()
    return {"office": office, "admin": admin, "disc": disc, "oil": oil}


def _alerts(user):
    return StaffAlert.query.filter_by(recipient_id=user.id, kind=StaffAlertKind.LOW_STOCK).all()


def test_due_item_reminds_office_staff_once(shop):
    assert low_stock_service.check_restock_due(TODAY) == 1
    alerts = _alerts(shop["office"])
    assert len(alerts) == 1
    assert "Cutting disc 4in" in alerts[0].title
    assert "every 10 days" in alerts[0].message
    assert _alerts(shop["admin"]) == []
    # The same expected date does not alert twice.
    assert low_stock_service.check_restock_due(TODAY) == 0


def test_buying_it_moves_the_date_and_the_next_cycle_alerts_again(shop):
    low_stock_service.check_restock_due(TODAY)
    _buy(shop["disc"], shop["office"], 0)
    db.session.commit()
    assert low_stock_service.check_restock_due(TODAY) == 0
    later = TODAY + timedelta(days=12)
    assert low_stock_service.check_restock_due(later) == 1
    assert len(_alerts(shop["office"])) == 2
