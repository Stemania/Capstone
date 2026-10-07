"""Attendance recorded by the Administrator (clock-in / clock-out per worker per day).

Uses the bmsc_test database from conftest (schema built from the models).
"""

from datetime import datetime, time, timedelta

import pytest
from flask_jwt_extended import create_access_token

from app.extensions import bcrypt, db
from app.models.attendance import AttendanceRecord
from app.models.audit_log import AuditLog
from app.models.user import User, UserRole, UserStatus
from app.models.worker_profile import WorkerProfile
from app.models.worker_skill import WorkerSchedule
from app.services.schedule_calendar import SHOP_TZ, shop_now


def _user(email, role, name=None, active=True):
    user = User(
        email=email,
        password_hash=bcrypt.generate_password_hash("Passw0rd!").decode("utf-8"),
        full_name=name or email.split("@")[0],
        role=role,
        status=UserStatus.ACTIVE if active else UserStatus.DISABLED,
        active=active,
    )
    db.session.add(user)
    db.session.flush()
    if role == UserRole.PRODUCTION_WORKER:
        db.session.add(WorkerProfile(user_id=user.id))
    return user


def _headers(user):
    token = create_access_token(identity=user.id, additional_claims={"role": user.role.value})
    return {"Authorization": f"Bearer {token}"}


def _local(day, hh, mm=0):
    return datetime.combine(day, time(hh, mm), tzinfo=SHOP_TZ).isoformat()


@pytest.fixture
def shop(app):
    admin = _user("att_admin@test.local", UserRole.ADMIN, "Att Admin")
    office = _user("att_office@test.local", UserRole.OFFICE_STAFF, "Att Office")
    worker = _user("att_worker@test.local", UserRole.PRODUCTION_WORKER, "Ana Worker")
    other = _user("att_other@test.local", UserRole.PRODUCTION_WORKER, "Ben Worker")
    for w in (worker, other):
        for dow in range(7):
            db.session.add(
                WorkerSchedule(
                    worker_id=w.id,
                    day_of_week=dow,
                    start_time=time(8, 0),
                    end_time=time(17, 0),
                    is_working=True,
                )
            )
    db.session.commit()
    yesterday = shop_now().date() - timedelta(days=1)
    return {
        "admin": admin,
        "office": office,
        "worker": worker,
        "other": other,
        "day": yesterday,
    }


def test_admin_records_clock_in_and_clock_out(client, shop):
    day, h = shop["day"], _headers(shop["admin"])
    res = client.post(
        "/api/v1/attendance/clock-in",
        json={"workerId": shop["worker"].id, "clockIn": _local(day, 8, 0)},
        headers=h,
    )
    assert res.status_code == 201, res.get_json()
    rec = res.get_json()
    assert rec["workDate"] == day.isoformat()
    assert rec["clockOut"] is None
    assert rec["recordedByName"] == "Att Admin"

    res = client.post(
        f"/api/v1/attendance/{rec['id']}/clock-out",
        json={"clockOut": _local(day, 17, 0)},
        headers=h,
    )
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["hoursPresent"] == 9.0
    # The 12:00-13:00 break is not worked time.
    assert res.get_json()["hoursWorked"] == 8.0

    assert AuditLog.query.filter_by(entity_type="AttendanceRecord", entity_id=rec["id"]).count() >= 2


def test_only_admin_can_record_attendance(client, shop):
    for user in (shop["office"], shop["worker"]):
        res = client.post(
            "/api/v1/attendance/clock-in",
            json={"workerId": shop["worker"].id},
            headers=_headers(user),
        )
        assert res.status_code == 403
        res = client.get("/api/v1/attendance/day", headers=_headers(user))
        assert res.status_code == 403


def test_clock_in_defaults_to_now(client, shop):
    res = client.post(
        "/api/v1/attendance/clock-in",
        json={"workerId": shop["worker"].id},
        headers=_headers(shop["admin"]),
    )
    assert res.status_code == 201
    assert res.get_json()["workDate"] == shop_now().date().isoformat()


def test_one_record_per_worker_per_day(client, shop):
    day, h = shop["day"], _headers(shop["admin"])
    body = {"workerId": shop["worker"].id, "clockIn": _local(day, 8)}
    assert client.post("/api/v1/attendance/clock-in", json=body, headers=h).status_code == 201
    body["clockIn"] = _local(day, 13)
    res = client.post("/api/v1/attendance/clock-in", json=body, headers=h)
    assert res.status_code == 409
    assert "already has attendance" in res.get_json()["error"]["message"]


def test_rejects_future_and_inverted_times(client, shop):
    h = _headers(shop["admin"])
    future = (shop_now() + timedelta(hours=2)).isoformat()
    res = client.post(
        "/api/v1/attendance/clock-in",
        json={"workerId": shop["worker"].id, "clockIn": future},
        headers=h,
    )
    assert res.status_code == 400

    day = shop["day"]
    rec = client.post(
        "/api/v1/attendance/clock-in",
        json={"workerId": shop["worker"].id, "clockIn": _local(day, 8)},
        headers=h,
    ).get_json()
    res = client.post(
        f"/api/v1/attendance/{rec['id']}/clock-out",
        json={"clockOut": _local(day, 7)},
        headers=h,
    )
    assert res.status_code == 400
    assert "after clock-in" in res.get_json()["error"]["message"]


def test_cannot_record_for_non_worker_or_disabled_worker(client, shop):
    h = _headers(shop["admin"])
    res = client.post(
        "/api/v1/attendance/clock-in", json={"workerId": shop["office"].id}, headers=h
    )
    assert res.status_code == 404
    disabled = _user("att_off@test.local", UserRole.PRODUCTION_WORKER, active=False)
    db.session.commit()
    res = client.post("/api/v1/attendance/clock-in", json={"workerId": disabled.id}, headers=h)
    assert res.status_code == 400


def test_edit_and_delete_record(client, shop):
    day, h = shop["day"], _headers(shop["admin"])
    rec = client.post(
        "/api/v1/attendance/clock-in",
        json={"workerId": shop["worker"].id, "clockIn": _local(day, 8)},
        headers=h,
    ).get_json()
    res = client.patch(
        f"/api/v1/attendance/{rec['id']}",
        json={"clockIn": _local(day, 8, 30), "clockOut": _local(day, 16, 30), "note": "Fixed"},
        headers=h,
    )
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert body["hoursPresent"] == 8.0
    assert body["hoursWorked"] == 7.0
    assert body["note"] == "Fixed"
    assert body["updatedByName"] == "Att Admin"

    assert client.delete(f"/api/v1/attendance/{rec['id']}", headers=h).status_code == 204
    assert AttendanceRecord.query.get(rec["id"]) is None


def test_day_sheet_statuses_and_late(client, shop):
    day, h = shop["day"], _headers(shop["admin"])
    rec = client.post(
        "/api/v1/attendance/clock-in",
        json={"workerId": shop["worker"].id, "clockIn": _local(day, 8, 20)},
        headers=h,
    ).get_json()
    client.post(
        f"/api/v1/attendance/{rec['id']}/clock-out",
        json={"clockOut": _local(day, 17)},
        headers=h,
    )
    res = client.get(f"/api/v1/attendance/day?date={day.isoformat()}", headers=h)
    assert res.status_code == 200
    sheet = res.get_json()
    rows = {r["workerName"]: r for r in sheet["rows"]}
    assert rows["Ana Worker"]["status"] == "PRESENT"
    assert rows["Ana Worker"]["lateMinutes"] == 20
    assert rows["Ana Worker"]["scheduledStart"] == "08:00"
    assert rows["Ben Worker"]["status"] == "ABSENT"
    assert "Att Office" not in rows
    assert sheet["lateCount"] == 1


def test_worker_history_summary(client, shop):
    day, h = shop["day"], _headers(shop["admin"])
    earlier = day - timedelta(days=1)
    for d, start in ((day, (8, 0)), (earlier, (8, 30))):
        rec = client.post(
            "/api/v1/attendance/clock-in",
            json={"workerId": shop["worker"].id, "clockIn": _local(d, *start)},
            headers=h,
        ).get_json()
        client.post(
            f"/api/v1/attendance/{rec['id']}/clock-out",
            json={"clockOut": _local(d, 17)},
            headers=h,
        )
    from_d = earlier - timedelta(days=1)
    res = client.get(
        f"/api/v1/attendance/workers/{shop['worker'].id}"
        f"?from={from_d.isoformat()}&to={day.isoformat()}",
        headers=h,
    )
    assert res.status_code == 200
    data = res.get_json()
    assert data["summary"] == {
        "daysPresent": 2,
        "daysAbsent": 1,
        "daysLate": 1,
        "hoursPresent": 17.5,
        "hoursWorked": 15.5,
    }
    assert [r["date"] for r in data["rows"]] == [
        day.isoformat(),
        earlier.isoformat(),
        from_d.isoformat(),
    ]


def _clock_in_only(client, h, worker, day, hh=8):
    return client.post(
        "/api/v1/attendance/clock-in",
        json={"workerId": worker.id, "clockIn": _local(day, hh)},
        headers=h,
    ).get_json()


def test_past_day_without_clock_out_is_incomplete(client, shop):
    day, h = shop["day"], _headers(shop["admin"])
    _clock_in_only(client, h, shop["worker"], day)

    sheet = client.get(f"/api/v1/attendance/day?date={day.isoformat()}", headers=h).get_json()
    rows = {r["workerName"]: r for r in sheet["rows"]}
    assert rows["Ana Worker"]["status"] == "INCOMPLETE"
    assert sheet["counts"].get("CLOCKED_IN", 0) == 0

    history = client.get(
        f"/api/v1/attendance/workers/{shop['worker'].id}"
        f"?from={day.isoformat()}&to={day.isoformat()}",
        headers=h,
    ).get_json()
    assert [r["status"] for r in history["rows"]] == ["INCOMPLETE"]


def test_today_without_clock_out_is_still_clocked_in(client, shop):
    today = shop_now().date()
    db.session.add(
        AttendanceRecord(
            worker_id=shop["worker"].id,
            work_date=today,
            clock_in=shop_now(),
            recorded_by_id=shop["admin"].id,
        )
    )
    db.session.commit()
    sheet = client.get(
        f"/api/v1/attendance/day?date={today.isoformat()}", headers=_headers(shop["admin"])
    ).get_json()
    rows = {r["workerName"]: r for r in sheet["rows"]}
    assert rows["Ana Worker"]["status"] == "CLOCKED_IN"


def _csv_rows(res):
    import csv
    import io

    assert res.status_code == 200
    assert res.mimetype == "text/csv"
    assert "attachment" in res.headers["Content-Disposition"]
    return list(csv.reader(io.StringIO(res.get_data(as_text=True))))


def test_day_csv_matches_screen_rows(client, shop):
    day, h = shop["day"], _headers(shop["admin"])
    rec = _clock_in_only(client, h, shop["worker"], day, 8)
    client.post(
        f"/api/v1/attendance/{rec['id']}/clock-out",
        json={"clockOut": _local(day, 16, 30)},
        headers=h,
    )
    _clock_in_only(client, h, shop["other"], day, 9)

    screen = client.get(f"/api/v1/attendance/day?date={day.isoformat()}", headers=h).get_json()
    lines = _csv_rows(client.get(f"/api/v1/attendance/day.csv?date={day.isoformat()}", headers=h))
    header, body = lines[0], lines[1:]
    assert "Hours present" in header
    assert len(body) == len(screen["rows"])
    assert [(r[0], r[1]) for r in body] == [
        (r["date"], r["workerName"]) for r in screen["rows"]
    ]
    by_name = {r[1]: dict(zip(header, r)) for r in body}
    assert by_name["Ana Worker"]["Status"] == "Present"
    assert by_name["Ana Worker"]["Clock in"] == "08:00"
    assert by_name["Ana Worker"]["Clock out"] == "16:30"
    assert by_name["Ana Worker"]["Hours present"] == "8.50"
    assert by_name["Ana Worker"]["Hours worked"] == "7.50"
    assert by_name["Ben Worker"]["Status"] == "Incomplete"
    assert by_name["Ben Worker"]["Late (minutes)"] == "60"


def test_history_csv_matches_screen_rows(client, shop):
    day, h = shop["day"], _headers(shop["admin"])
    earlier = day - timedelta(days=1)
    _clock_in_only(client, h, shop["worker"], day)
    from_d = earlier - timedelta(days=1)
    qs = f"?from={from_d.isoformat()}&to={day.isoformat()}"
    wid = shop["worker"].id

    screen = client.get(f"/api/v1/attendance/workers/{wid}{qs}", headers=h).get_json()
    lines = _csv_rows(client.get(f"/api/v1/attendance/workers/{wid}.csv{qs}", headers=h))
    body = lines[1:]
    assert [(r[0], r[8]) for r in body] == [
        (r["date"], {"INCOMPLETE": "Incomplete", "ABSENT": "Absent"}[r["status"]])
        for r in screen["rows"]
    ]
    assert len(body) == 3


def test_csv_export_is_admin_only(client, shop):
    h = _headers(shop["office"])
    assert client.get("/api/v1/attendance/day.csv", headers=h).status_code == 403
    res = client.get(f"/api/v1/attendance/workers/{shop['worker'].id}.csv", headers=h)
    assert res.status_code == 403


@pytest.fixture
def ten_am(monkeypatch):
    """Pin the shop clock to 10:00 today so 08:00 starts have passed."""
    import app.services.attendance_service as att
    import app.services.schedule_calendar as cal

    fixed = datetime.combine(shop_now().date(), time(10, 0), tzinfo=SHOP_TZ)
    monkeypatch.setattr(cal, "shop_now", lambda: fixed)
    monkeypatch.setattr(att, "shop_now", lambda: fixed)
    return fixed


def _suggest(client, shop, start):
    res = client.post(
        "/api/v1/workers/suggest",
        json={
            "operationName": "Attendance check op",
            "scheduledStart": start.isoformat(),
            "scheduledEnd": (start + timedelta(hours=1)).isoformat(),
        },
        headers=_headers(shop["admin"]),
    )
    assert res.status_code == 200, res.get_json()
    return {s["workerId"]: s for s in res.get_json()["suggestions"]}


def test_suggestion_warns_only_for_workers_not_clocked_in_today(client, shop, ten_am):
    db.session.add(
        AttendanceRecord(
            worker_id=shop["other"].id,
            work_date=ten_am.date(),
            clock_in=datetime.combine(ten_am.date(), time(8, 0), tzinfo=SHOP_TZ),
            recorded_by_id=shop["admin"].id,
        )
    )
    db.session.commit()

    today = _suggest(client, shop, ten_am)
    assert today[shop["worker"].id]["attendanceWarning"] == "Not clocked in today"
    assert today[shop["other"].id]["attendanceWarning"] is None

    tomorrow = _suggest(client, shop, ten_am + timedelta(days=1))
    assert shop["worker"].id in tomorrow
    assert tomorrow[shop["worker"].id]["attendanceWarning"] is None


def test_worker_off_today_gets_no_attendance_warning(app, shop, ten_am):
    from app.services.attendance_service import not_clocked_in_today

    WorkerSchedule.query.filter_by(
        worker_id=shop["other"].id, day_of_week=ten_am.weekday()
    ).update({"is_working": False})
    db.session.commit()
    assert not_clocked_in_today([shop["worker"].id, shop["other"].id]) == {shop["worker"].id}
