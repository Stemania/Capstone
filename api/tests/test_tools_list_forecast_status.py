"""GET /tools consumable list status matches consumable_run_out for the same item."""

from datetime import date, time, timedelta
from decimal import Decimal

from flask_jwt_extended import create_access_token

from app.extensions import bcrypt, db
from app.models.tool import Tool, ToolCategory
from app.models.tool_event import ToolEvent, ToolEventType
from app.models.user import User, UserRole, UserStatus
from app.services import forecast_service as fs
from app.services.schedule_calendar import shop_local_to_utc


def _office():
    user = User(
        email="list_fc@test.local",
        password_hash=bcrypt.generate_password_hash("Passw0rd!").decode("utf-8"),
        full_name="List FC",
        role=UserRole.OFFICE_STAFF,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    db.session.commit()
    return user


def _headers(user):
    token = create_access_token(identity=user.id, additional_claims={"role": user.role.value})
    return {"Authorization": f"Bearer {token}"}


def _add_scans(tool, worker, days, qty_each=2):
    for d in days:
        db.session.add(
            ToolEvent(
                tool_id=tool.id,
                worker_id=worker.id,
                type=ToolEventType.SCAN,
                quantity=qty_each,
                created_at=shop_local_to_utc(d, time(10, 0)),
            )
        )
    db.session.commit()


def test_tools_list_status_matches_forecast_detail(client, app):
    """List enrichment uses the same snapshot as consumable_run_out for one item."""
    office = _office()
    tool = Tool(
        name="List FC Insert",
        code="LIST-FC-INS",
        category=ToolCategory.CONSUMABLE,
        unit="pcs",
        quantity_on_hand=Decimal("10"),
        active=True,
    )
    db.session.add(tool)
    db.session.commit()

    days = []
    d = date(2031, 3, 3)
    while len(days) < 18:
        if d.weekday() < 6:
            days.append(d)
        d += timedelta(days=1)
    _add_scans(tool, office, days, qty_each=2)
    tool.quantity_on_hand = Decimal("10")
    db.session.commit()
    today = days[-1]

    detail = next(
        r for r in fs.consumable_run_out(today=today)["items"] if r["code"] == "LIST-FC-INS"
    )
    snap = fs.stock_snapshot_for_tools([tool], today=today)[tool.id]
    assert snap["status"] == detail["status"]
    assert snap["label"] == detail["label"]
    assert snap["reorderPoint"] == detail["reorderPoint"]

    # Route attaches the same fields the snapshot would (for live today).
    res = client.get("/api/v1/tools?category=CONSUMABLE", headers=_headers(office))
    assert res.status_code == 200
    row = next(r for r in res.get_json() if r["code"] == "LIST-FC-INS")
    live = fs.stock_snapshot_for_tools([tool])[tool.id]
    assert row["status"] == live["status"]
    assert row["label"] == live["label"]
    assert row.get("reorderPoint") == live["reorderPoint"]
