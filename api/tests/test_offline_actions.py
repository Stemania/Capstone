"""Worker actions recorded on the phone and sent later by the sync queue."""

import uuid
from datetime import datetime, timedelta, timezone

from app.extensions import db
from app.models.audit_log import AuditLog
from app.models.job_order import JobOrder, JobOrderStatus
from app.models.machine import MachineType, MachineUnit
from app.models.operation import JobOperation, OperationStatus
from app.models.operation_time import MachineDowntime, OperationTimeEvent, OperationTimeLog
from app.services.operation_service import CLOCK_WRONG_MESSAGE
from tests.test_process_trace_fixes import _headers, _job, _op, shop  # noqa: F401

# A morning of work three hours ago, so every phone time is in the past.
BASE = (datetime.now(timezone.utc) - timedelta(hours=3)).replace(microsecond=0)


def _at(minutes):
    return (BASE + timedelta(minutes=minutes)).isoformat().replace("+00:00", "Z")


def _send(client, user, op_id, action, at, action_id=None, **extra):
    return client.post(
        f"/api/v1/operations/{op_id}/{action}",
        json={"timestamp": at, "clientActionId": action_id or str(uuid.uuid4()), **extra},
        headers=_headers(user),
    )


def _events(op_id):
    return [
        (log.event, log.event_at.astimezone(timezone.utc).isoformat())
        for log in OperationTimeLog.query.filter_by(operation_id=op_id)
        .order_by(OperationTimeLog.event_at)
        .all()
    ]


def _utc(minutes):
    return (BASE + timedelta(minutes=minutes)).isoformat()


def _assert_clock_refused(res):
    assert res.status_code == 422, res.get_json()
    assert res.get_json()["error"] == {"code": "CLOCK_WRONG", "message": CLOCK_WRONG_MESSAGE}


def _unit_and_op(shop, code):
    mtype = MachineType(code=code, name=f"Lathe {code}")
    db.session.add(mtype)
    db.session.flush()
    unit = MachineUnit(machine_type_id=mtype.id, label=f"Lathe {code}", active=True)
    db.session.add(unit)
    job = _job(shop, status=JobOrderStatus.IN_PROGRESS)
    op = _op(job, 1, "Turning", worker=shop["worker"], machine_type_id=mtype.id, machine_unit_id=unit.id)
    db.session.commit()
    return unit, op


def test_actions_keep_the_time_they_happened_on_the_phone(client, shop):
    job = _job(shop, status=JobOrderStatus.IN_PROGRESS)
    op = _op(job, 1, "Turning", worker=shop["worker"])
    db.session.commit()
    w = shop["worker"]
    assert _send(client, w, op.id, "start", _at(10)).status_code == 200
    assert _send(client, w, op.id, "pause", _at(60), reason="BREAK").status_code == 200
    assert _send(client, w, op.id, "resume", _at(75)).status_code == 200
    assert _send(client, w, op.id, "complete", _at(120)).status_code == 200

    assert _events(op.id) == [
        (OperationTimeEvent.START, _utc(10)),
        (OperationTimeEvent.PAUSE, _utc(60)),
        (OperationTimeEvent.RESUME, _utc(75)),
        (OperationTimeEvent.COMPLETE, _utc(120)),
    ]


def test_both_phone_and_server_times_are_stored_and_audited(client, shop):
    job = _job(shop, status=JobOrderStatus.IN_PROGRESS)
    op = _op(job, 1, "Turning", worker=shop["worker"])
    db.session.commit()
    before = datetime.now(timezone.utc)
    assert _send(client, shop["worker"], op.id, "start", _at(10)).status_code == 200
    after = datetime.now(timezone.utc)

    log = OperationTimeLog.query.filter_by(operation_id=op.id).one()
    assert log.event_at.astimezone(timezone.utc).isoformat() == _utc(10)
    assert before <= log.received_at <= after

    audit = AuditLog.query.filter_by(
        entity_type="OperationTimeLog", entity_id=log.id, action="CREATE"
    ).one()
    assert datetime.fromisoformat(audit.after_json["eventAt"]) == log.event_at
    assert datetime.fromisoformat(audit.after_json["receivedAt"]) == log.received_at


def test_resent_action_is_recorded_once(client, shop):
    job = _job(shop, status=JobOrderStatus.IN_PROGRESS)
    op = _op(job, 1, "Turning", worker=shop["worker"])
    db.session.commit()
    w = shop["worker"]
    _send(client, w, op.id, "start", _at(10))
    _send(client, w, op.id, "pause", _at(60), reason="BREAK")
    resume_id = str(uuid.uuid4())
    assert _send(client, w, op.id, "resume", _at(75), resume_id).status_code == 200
    # The reply was lost; the phone sends the same resume again.
    again = _send(client, w, op.id, "resume", _at(75), resume_id)
    assert again.status_code == 200, again.get_json()
    resumes = [e for e, _ in _events(op.id) if e == OperationTimeEvent.RESUME]
    assert len(resumes) == 1


def test_resent_breakdown_is_recorded_once(client, shop):
    unit, op = _unit_and_op(shop, "LATHE_OFF")
    body = {
        "category": "MECHANICAL_FAILURE",
        "operationId": op.id,
        "startedAt": _at(60),
        "clientActionId": str(uuid.uuid4()),
    }
    url = f"/api/v1/operations/machine-units/{unit.id}/downtime"
    first = client.post(url, json=body, headers=_headers(shop["worker"]))
    assert first.status_code == 201, first.get_json()
    assert first.get_json()["receivedAt"]
    again = client.post(url, json=body, headers=_headers(shop["worker"]))
    assert again.status_code == 200, again.get_json()
    assert again.get_json()["id"] == first.get_json()["id"]
    assert MachineDowntime.query.filter_by(machine_unit_id=unit.id).count() == 1


def test_action_on_reassigned_operation_is_refused(client, shop):
    job = _job(shop, status=JobOrderStatus.IN_PROGRESS)
    op = _op(job, 1, "Turning", worker=shop["worker"])
    db.session.commit()
    # Reassigned to someone else while the phone was offline.
    db.session.get(JobOperation, op.id).assigned_worker_id = shop["other"].id
    db.session.commit()
    res = _send(client, shop["worker"], op.id, "start", _at(10))
    assert res.status_code == 403
    error = res.get_json()["error"]
    assert error["code"] == "OPERATION_REASSIGNED"
    assert error["message"].startswith(f"Turning is now assigned to {shop['other'].full_name}")
    assert db.session.get(JobOperation, op.id).status == OperationStatus.SCHEDULED


def test_action_id_cannot_be_reused_for_another_action(client, shop):
    job = _job(shop, status=JobOrderStatus.IN_PROGRESS)
    op = _op(job, 1, "Turning", worker=shop["worker"])
    db.session.commit()
    action_id = str(uuid.uuid4())
    _send(client, shop["worker"], op.id, "start", _at(10), action_id)
    res = _send(client, shop["worker"], op.id, "complete", _at(120), action_id)
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "ACTION_ID_CONFLICT"


# --- Phone clock sanity checks -------------------------------------------------


def _in_future(minutes):
    at = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    return at.isoformat().replace("+00:00", "Z")


def test_action_more_than_two_minutes_in_the_future_is_refused(client, shop):
    job = _job(shop, status=JobOrderStatus.IN_PROGRESS)
    op = _op(job, 1, "Turning", worker=shop["worker"])
    db.session.commit()
    _assert_clock_refused(_send(client, shop["worker"], op.id, "start", _in_future(5)))
    assert _events(op.id) == []
    assert db.session.get(JobOperation, op.id).status == OperationStatus.SCHEDULED


def test_phone_slightly_ahead_of_the_server_is_accepted(client, shop):
    job = _job(shop, status=JobOrderStatus.IN_PROGRESS)
    op = _op(job, 1, "Turning", worker=shop["worker"])
    db.session.commit()
    res = _send(client, shop["worker"], op.id, "start", _in_future(1))
    assert res.status_code == 200, res.get_json()


def test_action_before_the_operations_previous_action_is_refused(client, shop):
    job = _job(shop, status=JobOrderStatus.IN_PROGRESS)
    op = _op(job, 1, "Turning", worker=shop["worker"])
    db.session.commit()
    w = shop["worker"]
    assert _send(client, w, op.id, "start", _at(60)).status_code == 200
    _assert_clock_refused(_send(client, w, op.id, "pause", _at(30), reason="BREAK"))
    assert _send(client, w, op.id, "pause", _at(90), reason="BREAK").status_code == 200
    _assert_clock_refused(_send(client, w, op.id, "resume", _at(80)))
    assert _send(client, w, op.id, "resume", _at(100)).status_code == 200
    _assert_clock_refused(_send(client, w, op.id, "complete", _at(95)))
    assert [e for e, _ in _events(op.id)] == [
        OperationTimeEvent.START,
        OperationTimeEvent.PAUSE,
        OperationTimeEvent.RESUME,
    ]


def test_action_before_the_job_was_released_is_refused(client, shop):
    job = _job(shop, status=JobOrderStatus.SCHEDULED)
    op = _op(job, 1, "Turning", worker=shop["worker"])
    job.released_at = BASE + timedelta(minutes=30)
    db.session.commit()
    _assert_clock_refused(_send(client, shop["worker"], op.id, "start", _at(20)))
    assert _events(op.id) == []
    assert _send(client, shop["worker"], op.id, "start", _at(40)).status_code == 200


def test_breakdown_with_wrong_phone_clock_is_refused(client, shop):
    unit, op = _unit_and_op(shop, "LATHE_CLK")
    url = f"/api/v1/operations/machine-units/{unit.id}/downtime"

    def report(at):
        body = {
            "category": "MECHANICAL_FAILURE",
            "operationId": op.id,
            "startedAt": at,
            "clientActionId": str(uuid.uuid4()),
        }
        return client.post(url, json=body, headers=_headers(shop["worker"]))

    _assert_clock_refused(report(_in_future(10)))
    db.session.get(JobOrder, op.job_order_id).released_at = BASE + timedelta(minutes=30)
    db.session.commit()
    _assert_clock_refused(report(_at(20)))
    assert MachineDowntime.query.filter_by(machine_unit_id=unit.id).count() == 0
    assert report(_at(40)).status_code == 201
