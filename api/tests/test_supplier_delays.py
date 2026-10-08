"""Supplier delays: overdue deliveries, material delay in the Pareto, Pareto
accuracy, and supplier reliability."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.extensions import db
from app.models.job_order import JobOrder
from app.models.machine import MachineType, MachineUnit
from app.models.material_purchase import MaterialPurchase
from app.models.operation import OperationStatus
from app.models.operation_time import (
    DowntimeCategory,
    MachineDowntime,
    OperationPauseReason,
    OperationTimeEvent,
    OperationTimeLog,
)
from app.models.schedule_move import DelayKind, MaterialCause, ScheduleMove
from app.models.staff_alert import StaffAlert, StaffAlertKind
from app.models.supplier import Supplier
from app.models.supplier_order import SupplierOrder, SupplierOrderStatus
from app.services import analytics_service
from app.services.delay_analysis_service import material_delays
from app.services.overdue_delivery_service import check_overdue_deliveries
from app.services.schedule_calendar import (
    ensure_utc,
    next_shop_working_day,
    shop_working_hours,
    utc_to_shop,
)
from app.services.supplier_reliability_service import NOT_ENOUGH, supplier_reliability
from tests.test_material_delay import (  # noqa: F401  (fixture)
    _draft_order,
    _headers,
    _issue,
    _job,
    _local,
    shop,
)


def _weekday_on_or_after(day, weekday):
    while day.weekday() != weekday:
        day += timedelta(days=1)
    return day


def _first_start(job_id):
    db.session.expire_all()
    job = db.session.get(JobOrder, job_id)
    first = min(job.operations, key=lambda o: o.sequence_no)
    return job, ensure_utc(first.scheduled_start)


# 1. Overdue deliveries


def test_line_past_expected_date_becomes_overdue_and_moves_job_without_edit(client, shop):
    today = shop["today"]
    job, ops = _job(shop, _local(today + timedelta(days=30), 9))
    order = _draft_order(client, shop, job, shop["slow"])
    _issue(client, shop, order["id"], today - timedelta(days=3))

    # Time passes: the expected date goes by, nobody touches the order, and the
    # job is still planned for today.
    so = db.session.get(SupplierOrder, order["id"])
    so.expected_delivery_date = today - timedelta(days=2)
    so.original_expected_delivery_date = today - timedelta(days=2)
    for op, hour in zip(sorted(job.operations, key=lambda o: o.sequence_no), (8, 13)):
        op.scheduled_start = _local(today, hour)
        op.scheduled_end = _local(today, hour + 2)
    db.session.commit()
    line = MaterialPurchase.query.filter_by(supplier_order_id=so.id).one()
    assert line.days_overdue(today) == 2
    assert db.session.get(SupplierOrder, so.id).to_dict()["daysOverdue"] == 2

    result = check_overdue_deliveries()
    assert result["overdueLines"] == 1 and result["overdueOrders"] == 1

    job, first = _first_start(job.id)
    assert utc_to_shop(first).date() >= today + timedelta(days=1)
    assert job.delay_kind == DelayKind.MATERIAL
    moves = ScheduleMove.query.filter_by(job_order_id=job.id).all()
    assert [m.kind for m in moves] == [DelayKind.MATERIAL]
    assert moves[0].supplier_id == shop["slow"].id
    assert moves[0].material_cause == MaterialCause.SUPPLIER_LATE
    assert "overdue" in moves[0].reason.lower()

    alerts = StaffAlert.query.filter_by(kind=StaffAlertKind.DELIVERY_OVERDUE).all()
    office_alerts = [a for a in alerts if a.recipient_id == shop["office"].id]
    assert len(office_alerts) == 1
    assert not [a for a in alerts if a.recipient_id == shop["admin"].id]

    # The daily check runs again: no second alert, no second move.
    check_overdue_deliveries()
    assert StaffAlert.query.filter_by(kind=StaffAlertKind.DELIVERY_OVERDUE).count() == len(alerts)
    assert ScheduleMove.query.filter_by(job_order_id=job.id).count() == 1


def test_overdue_filter_lists_only_late_orders(client, shop):
    today = shop["today"]
    late_job, _ = _job(shop, _local(today + timedelta(days=30), 9))
    order = _draft_order(client, shop, late_job, shop["slow"])
    _issue(client, shop, order["id"], today - timedelta(days=12))

    res = client.get(
        "/api/v1/supplier-orders", query_string={"status": "OVERDUE"}, headers=_headers(shop["office"])
    )
    assert res.status_code == 200
    rows = res.get_json()
    assert [r["id"] for r in rows] == [order["id"]]
    assert rows[0]["daysOverdue"] == 2


# 2. Material delay counts MATERIAL moves only


def _move(job, kind, previous, new, cause=None, supplier=None):
    db.session.add(
        ScheduleMove(
            job_order_id=job.id,
            kind=kind,
            previous_start=previous,
            new_start=new,
            material_cause=cause,
            supplier_id=supplier.id if supplier else None,
        )
    )


def _started_at(ops, at):
    first = ops[0]
    first.actual_start = at
    first.status = OperationStatus.IN_PROGRESS


def test_rescheduled_moves_never_count_as_material_delay(app, shop):
    monday = _weekday_on_or_after(shop["today"] - timedelta(days=21), 0)
    tuesday = monday + timedelta(days=1)
    material_job, m_ops = _job(shop, _local(tuesday, 8))
    rescheduled_job, r_ops = _job(shop, _local(tuesday, 8))
    _started_at(m_ops, _local(tuesday, 8))
    _started_at(r_ops, _local(tuesday, 8))
    _move(material_job, DelayKind.MATERIAL, _local(monday, 8), _local(tuesday, 8),
          MaterialCause.SUPPLIER_LATE, shop["slow"])
    _move(rescheduled_job, DelayKind.RESCHEDULED, _local(monday, 8), _local(tuesday, 8))
    db.session.commit()

    rows = material_delays()
    assert [r["jobOrderId"] for r in rows] == [material_job.id]
    assert rows[0]["hours"] == pytest.approx(8.0)  # Monday 08:00-17:00 less the break
    assert rows[0]["supplierNames"] == "Slow Steel"

    data = analytics_service.delays(monday.isoformat(), tuesday.isoformat())
    causes = {c["cause"]: c for c in data["causes"]}
    assert causes["MATERIAL_DELAY_SUPPLIER_LATE"]["hours"] == pytest.approx(8.0)
    assert causes["MATERIAL_DELAY_SUPPLIER_LATE"]["label"] == "Material delay: supplier late"
    assert causes["MATERIAL_DELAY_SUPPLIER_LATE"]["occurrenceCount"] == 1
    assert "MATERIAL_DELAY_NOT_ORDERED" not in causes
    assert [r["jobNumber"] for r in data["materialDelays"]] == [material_job.job_number]
    assert data["materialDelays"][0]["suppliers"][0]["supplierName"] == "Slow Steel"


def test_material_delay_splits_supplier_late_and_not_ordered(app, shop):
    monday = _weekday_on_or_after(shop["today"] - timedelta(days=21), 0)
    wednesday = monday + timedelta(days=2)
    # Not ordered: Monday -> Tuesday; then the supplier was late: Tuesday -> Wednesday.
    job, ops = _job(shop, _local(wednesday, 8))
    _started_at(ops, _local(wednesday, 8))
    _move(job, DelayKind.MATERIAL, _local(monday, 8), _local(monday + timedelta(days=1), 8),
          MaterialCause.NOT_ORDERED, shop["slow"])
    _move(job, DelayKind.MATERIAL, _local(monday + timedelta(days=1), 8), _local(wednesday, 8),
          MaterialCause.SUPPLIER_LATE, shop["quick"])
    db.session.commit()

    by_cause = {r["cause"]: r for r in material_delays()}
    assert by_cause[MaterialCause.NOT_ORDERED]["hours"] == pytest.approx(8.0)
    assert by_cause[MaterialCause.NOT_ORDERED]["suppliers"] == []
    assert by_cause[MaterialCause.SUPPLIER_LATE]["hours"] == pytest.approx(8.0)
    assert by_cause[MaterialCause.SUPPLIER_LATE]["supplierNames"] == "Quick Steel"

    data = analytics_service.delays(monday.isoformat(), wednesday.isoformat())
    causes = {c["cause"]: c for c in data["causes"]}
    assert causes["MATERIAL_DELAY_NOT_ORDERED"]["label"] == "Material delay: not ordered"
    assert causes["MATERIAL_DELAY_NOT_ORDERED"]["hours"] == pytest.approx(8.0)
    assert causes["MATERIAL_DELAY_SUPPLIER_LATE"]["hours"] == pytest.approx(8.0)


def test_unstarted_job_counts_only_time_already_lost(app, shop):
    monday = _weekday_on_or_after(shop["today"] - timedelta(days=14), 0)
    job, _ = _job(shop, _local(shop["today"] + timedelta(days=20), 8))
    _move(job, DelayKind.MATERIAL, _local(monday, 8), _local(shop["today"] + timedelta(days=20), 8),
          MaterialCause.NOT_ORDERED)
    db.session.commit()

    [row] = material_delays()
    now = datetime.now(timezone.utc)
    assert abs(ensure_utc(datetime.fromisoformat(row["countedUntil"])) - now) < timedelta(minutes=5)
    assert row["hours"] == pytest.approx(shop_working_hours([(_local(monday, 8), now)]), abs=0.2)
    assert row["hours"] < shop_working_hours(
        [(_local(monday, 8), _local(shop["today"] + timedelta(days=20), 8))]
    )


# 3. Pareto accuracy


@pytest.fixture
def lathe(app, shop):
    mtype = MachineType(code="LATHE_SD", name="Lathe")
    db.session.add(mtype)
    db.session.flush()
    unit = MachineUnit(machine_type_id=mtype.id, label="Lathe SD-1")
    db.session.add(unit)
    db.session.commit()
    return unit


def _log(op, worker, event, at, reason=None):
    db.session.add(
        OperationTimeLog(operation_id=op.id, worker_id=worker.id, event=event, event_at=at, reason=reason)
    )


def test_breakdown_hours_are_not_counted_twice(app, shop, lathe):
    monday = _weekday_on_or_after(shop["today"] - timedelta(days=21), 0)
    job, ops = _job(shop, _local(monday, 8))
    op = ops[0]
    op.machine_unit_id = lathe.id
    op.status = OperationStatus.COMPLETED
    op.actual_start = _local(monday, 8)
    op.actual_end = _local(monday, 16)
    worker = shop["worker"]
    _log(op, worker, OperationTimeEvent.START, _local(monday, 8))
    _log(op, worker, OperationTimeEvent.PAUSE, _local(monday, 10), OperationPauseReason.MACHINE_DOWN)
    _log(op, worker, OperationTimeEvent.RESUME, _local(monday, 12))
    _log(op, worker, OperationTimeEvent.COMPLETE, _local(monday, 16))
    # Downtime 11:00-20:00 clock time; less the 12:00-13:00 break and after the
    # 17:00 close, 5 working hours.
    db.session.add(
        MachineDowntime(
            machine_unit_id=lathe.id,
            started_at=_local(monday, 11),
            ended_at=_local(monday, 20),
            category=DowntimeCategory.MECHANICAL_FAILURE,
            reason="Spindle",
            reported_by_id=shop["office"].id,
        )
    )
    db.session.commit()

    data = analytics_service.delays(monday.isoformat(), monday.isoformat())
    causes = {c["cause"]: c for c in data["causes"]}
    assert causes["MACHINE_DOWNTIME"]["hours"] == pytest.approx(5.0)
    # 2 h "Machine down" pause, 1 h of it already inside the downtime record.
    assert causes["MACHINE_DOWN"]["hours"] == pytest.approx(1.0)
    assert data["breakdownOverlapHours"] == pytest.approx(1.0)
    assert causes["MACHINE_DOWNTIME"]["hours"] + causes["MACHINE_DOWN"]["hours"] == pytest.approx(6.0)


def test_pause_of_unfinished_operation_is_counted(app, shop):
    monday = _weekday_on_or_after(shop["today"] - timedelta(days=21), 0)
    job, ops = _job(shop, _local(monday, 8))
    op = ops[0]
    op.status = OperationStatus.IN_PROGRESS
    op.actual_start = _local(monday, 8)
    worker = shop["worker"]
    _log(op, worker, OperationTimeEvent.START, _local(monday, 8))
    _log(op, worker, OperationTimeEvent.PAUSE, _local(monday, 9), OperationPauseReason.WAITING_MATERIAL)
    _log(op, worker, OperationTimeEvent.RESUME, _local(monday, 10, 30))
    db.session.commit()

    data = analytics_service.delays(monday.isoformat(), monday.isoformat())
    causes = {c["cause"]: c for c in data["causes"]}
    assert causes["WAITING_MATERIAL"]["hours"] == pytest.approx(1.5)


# 4. Supplier reliability


def _delivery(shop, supplier, promised, received=None, edited=None):
    order = SupplierOrder(
        supplier_id=supplier.id,
        status=SupplierOrderStatus.RECEIVED if received else SupplierOrderStatus.ISSUED,
        date_issued=promised - timedelta(days=supplier.typical_lead_time_days or 1),
        expected_delivery_date=edited or promised,
        original_expected_delivery_date=promised,
        received_date=received,
        prepared_by_id=shop["office"].id,
    )
    db.session.add(order)
    db.session.flush()
    job, _ = _job(shop, _local(shop["today"] + timedelta(days=40), 9))
    db.session.add(
        MaterialPurchase(
            job_order_id=job.id,
            material_name="Plate",
            quantity=Decimal("1"),
            unit="pcs",
            unit_cost=Decimal("10"),
            supplier_id=supplier.id,
            supplier_order_id=order.id,
            date_ordered=order.date_issued,
            date_received=received,
        )
    )
    db.session.commit()
    return order


def _row(supplier):
    return next(r for r in supplier_reliability() if r["supplierId"] == supplier.id)


def test_reliability_uses_original_expected_date_not_the_edited_one(app, shop):
    sup = shop["quick"]
    base = shop["today"] - timedelta(days=30)
    # Warned of a delay, the date was moved, and it arrived on the new date: still late.
    _delivery(shop, sup, base, received=base + timedelta(days=5), edited=base + timedelta(days=5))
    _delivery(shop, sup, base + timedelta(days=1), received=base + timedelta(days=1))
    _delivery(shop, sup, base + timedelta(days=2), received=base)

    row = _row(sup)
    assert row["dueDeliveries"] == 3
    assert row["onTimeDeliveries"] == 2 and row["lateDeliveries"] == 1
    assert row["reliabilityPct"] == pytest.approx(66.7)
    assert row["avgDaysLate"] == pytest.approx(5.0)


def test_overdue_undelivered_order_lowers_reliability(app, shop):
    sup = shop["quick"]
    base = shop["today"] - timedelta(days=30)
    for i in range(3):
        _delivery(shop, sup, base + timedelta(days=i), received=base + timedelta(days=i))
    assert _row(sup)["reliabilityPct"] == pytest.approx(100.0)

    # A promise falling on a Sunday or holiday counts from the next working day.
    overdue_promise = next_shop_working_day(shop["today"] - timedelta(days=4))
    _delivery(shop, sup, shop["today"] - timedelta(days=4))
    # Not due yet: does not count either way.
    _delivery(shop, sup, shop["today"] + timedelta(days=3))

    row = _row(sup)
    assert row["dueDeliveries"] == 4
    assert row["overdueDeliveries"] == 1
    assert row["reliabilityPct"] == pytest.approx(75.0)
    assert row["avgDaysLate"] == pytest.approx((shop["today"] - overdue_promise).days)


def test_fewer_than_three_deliveries_shows_not_enough(client, shop):
    sup = shop["quick"]
    base = shop["today"] - timedelta(days=30)
    _delivery(shop, sup, base, received=base)
    _delivery(shop, sup, base + timedelta(days=1), received=base + timedelta(days=4))

    reliable = Supplier(name="Reliable Co", typical_lead_time_days=2)
    db.session.add(reliable)
    db.session.commit()
    for i in range(3):
        _delivery(shop, reliable, base + timedelta(days=i), received=base + timedelta(days=i))

    res = client.get("/api/v1/suppliers/reliability", headers=_headers(shop["office"]))
    assert res.status_code == 200
    rows = {r["supplierId"]: r for r in res.get_json()}
    few = rows[sup.id]
    assert few["dueDeliveries"] == 2
    assert few["reliabilityPct"] is None and few["rank"] is None
    assert few["label"] == NOT_ENOUGH == "Not enough deliveries"
    assert rows[reliable.id]["rank"] == 1
    assert rows[reliable.id]["label"] == "100% on time"
    # Ranked suppliers come before those without enough deliveries.
    order = [r["supplierId"] for r in res.get_json()]
    assert order.index(reliable.id) < order.index(sup.id)


def test_reliability_follows_date_range_with_minimum_inside_it(client, shop):
    sup = shop["quick"]
    old = shop["today"] - timedelta(days=90)
    recent = shop["today"] - timedelta(days=20)
    recent -= timedelta(days=recent.weekday())  # Monday: no promised date falls on a Sunday
    for i in range(3):
        _delivery(shop, sup, old + timedelta(days=i), received=old + timedelta(days=i + 3))
    for i in range(3):
        _delivery(shop, sup, recent + timedelta(days=i), received=recent + timedelta(days=i))

    assert _row(sup)["reliabilityPct"] == pytest.approx(50.0)  # all history
    res = client.get(
        "/api/v1/suppliers/reliability",
        query_string={"from": (recent - timedelta(days=1)).isoformat(), "to": shop["today"].isoformat()},
        headers=_headers(shop["office"]),
    )
    row = next(r for r in res.get_json() if r["supplierId"] == sup.id)
    assert row["dueDeliveries"] == 3 and row["reliabilityPct"] == pytest.approx(100.0)

    res = client.get(
        "/api/v1/suppliers/reliability",
        query_string={"from": recent.isoformat(), "to": (recent + timedelta(days=1)).isoformat()},
        headers=_headers(shop["office"]),
    )
    row = next(r for r in res.get_json() if r["supplierId"] == sup.id)
    assert row["dueDeliveries"] == 2 and row["label"] == NOT_ENOUGH


def test_reliability_ranks_by_score_then_average_days_late(app, shop):
    base = shop["today"] - timedelta(days=40)
    a = Supplier(name="A Metals", typical_lead_time_days=2)
    b = Supplier(name="B Metals", typical_lead_time_days=2)
    db.session.add_all([a, b])
    db.session.commit()
    # Both 2 of 3 on time; A's late one was 1 day late, B's 6 days.
    for sup, late_by in ((a, 1), (b, 6)):
        _delivery(shop, sup, base, received=base)
        _delivery(shop, sup, base + timedelta(days=1), received=base + timedelta(days=1))
        _delivery(shop, sup, base + timedelta(days=2), received=base + timedelta(days=2 + late_by))
    ranked = [r["supplierId"] for r in supplier_reliability() if r["enoughData"]]
    assert ranked.index(a.id) < ranked.index(b.id)
