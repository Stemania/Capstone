"""Earliest-fit scheduling — propose windows without persisting."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from app.constants.scheduling import DEFAULT_ESTIMATED_HOURS, SCHEDULE_HORIZON_DAYS
from app.models.machine import MachineUnit
from app.models.operation import JobOperation, OperationStatus
from app.services.schedule_calendar import (
    build_worker_working_windows,
    derive_working_segments,
    effective_hours_for_date,
    ensure_utc,
    full_horizon_interval,
    horizon_end_utc,
    intersect_intervals,
    load_calendar_exceptions,
    load_worker_schedule_maps,
    merge_intervals,
    place_duration,
    serialize_segments,
    shop_now,
    subtract_intervals,
    utc_to_shop,
)

MISSING_WORKER_MESSAGE = "assign a worker to schedule this operation"

ACTIVE_BOOKING_STATUSES = (
    OperationStatus.PENDING,
    OperationStatus.SCHEDULED,
    OperationStatus.IN_PROGRESS,
    OperationStatus.REWORK,
)

FROZEN_STATUSES = (OperationStatus.COMPLETED, OperationStatus.IN_PROGRESS)


def compute_schedule_flag(projected_completion_utc, due_date) -> str | None:
    """
    Compare projected completion against date_required in shop local time.

    projected_completion is stored UTC; convert to Asia/Manila before taking
    .date(). Using the UTC calendar date would mis-flag jobs that finish
    after 16:00 UTC (00:00–07:59 the next day in Manila).
    """
    if not projected_completion_utc or not due_date:
        return None
    completion_date = utc_to_shop(projected_completion_utc).date()
    if completion_date <= due_date:
        return "GREEN"
    if completion_date <= due_date + timedelta(days=1):
        return "AMBER"
    return "RED"


def _parse_estimated_hours(value) -> tuple[Decimal, bool]:
    if value is None or value == "":
        return DEFAULT_ESTIMATED_HOURS, True
    return Decimal(str(value)), False


def _operation_booking_envelope(op: JobOperation) -> tuple[datetime, datetime] | None:
    if op.status == OperationStatus.COMPLETED:
        if op.actual_start and op.actual_end:
            return ensure_utc(op.actual_start), ensure_utc(op.actual_end)
        if op.scheduled_start and op.scheduled_end:
            return ensure_utc(op.scheduled_start), ensure_utc(op.scheduled_end)
        return None
    if op.actual_start and op.scheduled_end:
        return ensure_utc(op.actual_start), ensure_utc(op.scheduled_end)
    if op.scheduled_start and op.scheduled_end:
        return ensure_utc(op.scheduled_start), ensure_utc(op.scheduled_end)
    return None


def operation_working_segments(op: JobOperation) -> list[tuple[datetime, datetime]]:
    """Public alias: derived working segments for one operation (never overnight gaps)."""
    return _busy_intervals_for_operation(op)


def _busy_intervals_for_operation(op: JobOperation) -> list[tuple[datetime, datetime]]:
    """Worker/machine busy pieces for one op — derived segments, never overnight gaps."""
    envelope = _operation_booking_envelope(op)
    if not envelope:
        return []
    start, end = envelope
    if not op.assigned_worker_id:
        return [(start, end)]
    schedule_by_dow = load_worker_schedule_maps(op.assigned_worker_id)
    exceptions = load_calendar_exceptions(
        utc_to_shop(start).date(), utc_to_shop(end).date()
    )
    return derive_working_segments(start, end, schedule_by_dow, exceptions)


def _segments_for_worker_envelope(
    worker_id,
    start: datetime,
    end: datetime,
    exceptions_by_date=None,
) -> list[tuple[datetime, datetime]]:
    schedule_by_dow = load_worker_schedule_maps(worker_id) if worker_id else {}
    if exceptions_by_date is None:
        exceptions_by_date = load_calendar_exceptions(
            utc_to_shop(start).date(), utc_to_shop(end).date()
        )
    return derive_working_segments(start, end, schedule_by_dow, exceptions_by_date)


def _load_external_bookings(exclude_job_id=None, exclude_operation_ids=None):
    query = JobOperation.query.filter(
        JobOperation.status.in_(ACTIVE_BOOKING_STATUSES + (OperationStatus.COMPLETED,)),
    )
    if exclude_job_id:
        query = query.filter(JobOperation.job_order_id != exclude_job_id)
    ops = query.all()
    worker_busy = {}
    machine_busy = {}
    exclude_operation_ids = set(exclude_operation_ids or [])
    for op in ops:
        if op.id in exclude_operation_ids:
            continue
        intervals = _busy_intervals_for_operation(op)
        if not intervals:
            continue
        if op.assigned_worker_id:
            worker_busy.setdefault(op.assigned_worker_id, []).extend(intervals)
        if op.machine_unit_id:
            machine_busy.setdefault(op.machine_unit_id, []).extend(intervals)

    # Open machine downtimes block units for scheduling
    from app.services.operation_service import open_downtime_intervals_by_unit

    for unit_id, intervals in open_downtime_intervals_by_unit().items():
        machine_busy.setdefault(unit_id, []).extend(intervals)

    return worker_busy, machine_busy


def _machine_units_by_type():
    grouped = {}
    for unit in MachineUnit.query.filter_by(active=True).order_by(MachineUnit.label).all():
        grouped.setdefault(unit.machine_type_id, []).append(unit)
    return grouped


def _normalize_operation(op_data, seq_fallback: int) -> dict:
    if isinstance(op_data, JobOperation):
        est, defaulted = _parse_estimated_hours(op_data.estimated_hours)
        return {
            "id": op_data.id,
            "sequenceNo": op_data.sequence_no,
            "operationName": op_data.operation_name,
            "operationTypeId": op_data.operation_type_id,
            "machineTypeId": op_data.machine_type_id,
            "machineUnitId": op_data.machine_unit_id,
            "assignedWorkerId": op_data.assigned_worker_id,
            "estimatedHours": float(est),
            "estimatedHoursDefaulted": defaulted,
            "status": op_data.status.value if op_data.status else "PENDING",
            "scheduledStart": op_data.scheduled_start.isoformat() if op_data.scheduled_start else None,
            "scheduledEnd": op_data.scheduled_end.isoformat() if op_data.scheduled_end else None,
            "actualStart": op_data.actual_start.isoformat() if op_data.actual_start else None,
            "actualEnd": op_data.actual_end.isoformat() if op_data.actual_end else None,
        }
    est, defaulted = _parse_estimated_hours(op_data.get("estimatedHours"))
    return {
        "id": op_data.get("id"),
        "sequenceNo": int(op_data.get("sequenceNo", op_data.get("seq", seq_fallback))),
        "operationName": op_data.get("operationName") or op_data.get("name") or "",
        "operationTypeId": op_data.get("operationTypeId"),
        "machineTypeId": op_data.get("machineTypeId"),
        "machineUnitId": op_data.get("machineUnitId"),
        "assignedWorkerId": op_data.get("assignedWorkerId"),
        "estimatedHours": float(est),
        "estimatedHoursDefaulted": defaulted,
        "status": op_data.get("status", "PENDING"),
        "scheduledStart": op_data.get("scheduledStart"),
        "scheduledEnd": op_data.get("scheduledEnd"),
        "actualStart": op_data.get("actualStart"),
        "actualEnd": op_data.get("actualEnd"),
    }


def _frozen_result(op: dict) -> dict | None:
    status = op.get("status")
    if status == OperationStatus.COMPLETED.value:
        start = op.get("actualStart") or op.get("scheduledStart")
        end = op.get("actualEnd") or op.get("scheduledEnd")
        if start and end:
            return _result_from_slot(
                op,
                start,
                end,
                op.get("machineUnitId"),
                scheduled=True,
                message=None,
                machine_unit_label=op.get("machineUnitLabel"),
            )
    if status == OperationStatus.IN_PROGRESS.value and op.get("actualStart") and op.get("scheduledEnd"):
        return _result_from_slot(
            op,
            op["actualStart"],
            op["scheduledEnd"],
            op.get("machineUnitId"),
            scheduled=True,
            message="in progress — existing window kept",
            machine_unit_label=op.get("machineUnitLabel"),
        )
    return None


def _unit_label(unit_id, units_by_type):
    if not unit_id:
        return None
    for units in units_by_type.values():
        for unit in units:
            if unit.id == unit_id:
                return unit.label
    return None


def _result_from_slot(
    op,
    start,
    end,
    machine_unit_id,
    *,
    scheduled: bool,
    message: str | None,
    placeable_hours: float | None = None,
    required_hours: float | None = None,
    machine_unit_label: str | None = None,
    exceptions_by_date=None,
):
    start_dt = ensure_utc(datetime.fromisoformat(str(start).replace("Z", "+00:00")))
    end_dt = ensure_utc(datetime.fromisoformat(str(end).replace("Z", "+00:00")))
    wid = op.get("assignedWorkerId")
    segments = (
        _segments_for_worker_envelope(wid, start_dt, end_dt, exceptions_by_date)
        if wid
        else []
    )
    return {
        "id": op.get("id"),
        "sequenceNo": op["sequenceNo"],
        "operationName": op.get("operationName"),
        "assignedWorkerId": wid,
        "machineTypeId": op.get("machineTypeId"),
        "machineUnitId": machine_unit_id,
        "machineUnitLabel": machine_unit_label,
        "estimatedHours": op["estimatedHours"],
        "estimatedHoursDefaulted": op["estimatedHoursDefaulted"],
        "scheduledStart": start_dt.isoformat(),
        "scheduledEnd": end_dt.isoformat(),
        "segments": serialize_segments(segments),
        "scheduled": scheduled,
        "message": message,
        "placeableHours": placeable_hours,
        "requiredHours": required_hours,
    }


def _failure_result(op, message, *, placeable_hours=None, required_hours=None):
    return {
        "id": op.get("id"),
        "sequenceNo": op["sequenceNo"],
        "operationName": op.get("operationName"),
        "assignedWorkerId": op.get("assignedWorkerId"),
        "machineTypeId": op.get("machineTypeId"),
        "machineUnitId": None,
        "estimatedHours": op["estimatedHours"],
        "estimatedHoursDefaulted": op["estimatedHoursDefaulted"],
        "scheduledStart": None,
        "scheduledEnd": None,
        "segments": [],
        "scheduled": False,
        "message": message,
        "placeableHours": placeable_hours,
        "requiredHours": required_hours,
    }


def _worker_free_intervals(
    worker_id,
    anchor_utc,
    end_utc,
    worker_busy,
    in_job_busy,
    exceptions_by_date,
):
    schedule_by_dow = load_worker_schedule_maps(worker_id)
    working = build_worker_working_windows(
        schedule_by_dow, exceptions_by_date, anchor_utc, end_utc
    )
    busy = merge_intervals(
        worker_busy.get(worker_id, []) + in_job_busy.get(worker_id, [])
    )
    return subtract_intervals(working, busy)


def _find_earliest_slot(
    worker_id,
    machine_type_id,
    duration: timedelta,
    not_before: datetime,
    anchor_utc,
    end_utc,
    worker_busy,
    machine_busy,
    in_job_worker_busy,
    in_job_machine_busy,
    exceptions_by_date,
    units_by_type,
):
    worker_free = _worker_free_intervals(
        worker_id,
        anchor_utc,
        end_utc,
        worker_busy,
        in_job_worker_busy,
        exceptions_by_date,
    )

    if not machine_type_id:
        start, end, placeable = place_duration(worker_free, duration, not_before, end_utc)
        if start and end:
            return start, end, None, placeable
        required = duration.total_seconds() / 3600.0
        return None, None, None, placeable

    units = units_by_type.get(machine_type_id, [])
    if not units:
        required = duration.total_seconds() / 3600.0
        return None, None, None, 0.0

    best = None
    best_placeable = 0.0
    for unit in units:
        machine_free = subtract_intervals(
            full_horizon_interval(anchor_utc, end_utc),
            merge_intervals(
                machine_busy.get(unit.id, []) + in_job_machine_busy.get(unit.id, [])
            ),
        )
        combined = intersect_intervals(worker_free, machine_free)
        start, end, placeable = place_duration(combined, duration, not_before, end_utc)
        if start and end and (best is None or start < best[0]):
            best = (start, end, unit.id)
            best_placeable = placeable

    if best:
        return best[0], best[1], best[2], best_placeable

    # Report best placeable seen across units for diagnostics
    max_placeable = 0.0
    for unit in units:
        machine_free = subtract_intervals(
            full_horizon_interval(anchor_utc, end_utc),
            merge_intervals(
                machine_busy.get(unit.id, []) + in_job_machine_busy.get(unit.id, [])
            ),
        )
        combined = intersect_intervals(worker_free, machine_free)
        _, _, placeable = place_duration(combined, duration, not_before, end_utc)
        max_placeable = max(max_placeable, placeable)
    return None, None, None, max_placeable


def propose_schedule(
    operations,
    due_date,
    *,
    exclude_job_id=None,
    anchor_utc=None,
):
    """
    Earliest-fit proposal for a job's operations. Does not write to the database.
    Every operation must have assignedWorkerId; missing workers are skipped per op.
    """
    anchor_utc = ensure_utc(anchor_utc or shop_now().astimezone(timezone.utc))
    end_utc = horizon_end_utc(anchor_utc)

    def _seq_key(item):
        if isinstance(item, JobOperation):
            return item.sequence_no
        return int(item.get("sequenceNo", item.get("seq", 0)))

    raw_sorted = sorted(operations, key=_seq_key)
    normalized = [
        _normalize_operation(op, i) for i, op in enumerate(raw_sorted, start=1)
    ]
    normalized.sort(key=lambda o: o["sequenceNo"])

    exclude_op_ids = [o["id"] for o in normalized if o.get("id")]
    worker_busy, machine_busy = _load_external_bookings(
        exclude_job_id=exclude_job_id,
        exclude_operation_ids=exclude_op_ids,
    )
    units_by_type = _machine_units_by_type()

    anchor_shop = utc_to_shop(anchor_utc)
    end_shop = utc_to_shop(end_utc)
    exceptions_by_date = load_calendar_exceptions(anchor_shop.date(), end_shop.date())

    in_job_worker_busy = {}
    in_job_machine_busy = {}
    results = []
    # Predecessor floor: never start an op before the search anchor or before
    # the previous op in this job ends (including COMPLETED / IN_PROGRESS frozen ends).
    prev_end = anchor_utc

    for op in normalized:
        frozen = _frozen_result(op)
        if frozen:
            results.append(frozen)
            frozen_start = ensure_utc(
                datetime.fromisoformat(frozen["scheduledStart"].replace("Z", "+00:00"))
            )
            frozen_end = ensure_utc(
                datetime.fromisoformat(frozen["scheduledEnd"].replace("Z", "+00:00"))
            )
            # Sequence constraint applies to frozen ops too. Use max so a
            # completed op that finished before the anchor does not pull the
            # floor earlier, and one that finishes after the anchor pushes it.
            prev_end = max(prev_end, frozen_end)
            wid = op.get("assignedWorkerId")
            uid = frozen.get("machineUnitId")
            frozen_segments = [
                (
                    ensure_utc(datetime.fromisoformat(s["start"].replace("Z", "+00:00"))),
                    ensure_utc(datetime.fromisoformat(s["end"].replace("Z", "+00:00"))),
                )
                for s in (frozen.get("segments") or [])
            ]
            if wid and frozen_segments:
                in_job_worker_busy.setdefault(wid, []).extend(frozen_segments)
            if uid and frozen_segments:
                in_job_machine_busy.setdefault(uid, []).extend(frozen_segments)
            continue

        if not op.get("assignedWorkerId"):
            results.append(
                _failure_result(op, MISSING_WORKER_MESSAGE, required_hours=op["estimatedHours"])
            )
            continue

        duration = timedelta(hours=float(op["estimatedHours"]))
        not_before = prev_end
        start, end, unit_id, placeable = _find_earliest_slot(
            op["assignedWorkerId"],
            op.get("machineTypeId"),
            duration,
            not_before,
            anchor_utc,
            end_utc,
            worker_busy,
            machine_busy,
            in_job_worker_busy,
            in_job_machine_busy,
            exceptions_by_date,
            units_by_type,
        )

        required = float(op["estimatedHours"])
        if not start or not end:
            if placeable <= 0 and op.get("machineTypeId") and not units_by_type.get(op["machineTypeId"]):
                msg = (
                    f"could not schedule within {SCHEDULE_HORIZON_DAYS} days "
                    f"(no machine units configured; {required:.1f}h required)"
                )
            elif op.get("machineTypeId") and placeable <= 0:
                msg = (
                    f"could not schedule within {SCHEDULE_HORIZON_DAYS} days "
                    f"(all machine units busy; 0.0h placeable of {required:.1f}h required)"
                )
            else:
                msg = (
                    f"could not schedule within {SCHEDULE_HORIZON_DAYS} days "
                    f"({placeable:.1f}h placeable of {required:.1f}h required)"
                )
            results.append(
                _failure_result(
                    op,
                    msg,
                    placeable_hours=round(placeable, 2),
                    required_hours=required,
                )
            )
            continue

        slot = _result_from_slot(
            op,
            start.isoformat(),
            end.isoformat(),
            unit_id,
            scheduled=True,
            message=None,
            machine_unit_label=_unit_label(unit_id, units_by_type),
            exceptions_by_date=exceptions_by_date,
        )
        results.append(slot)
        prev_end = end
        wid = op["assignedWorkerId"]
        slot_segments = [
            (
                ensure_utc(datetime.fromisoformat(s["start"].replace("Z", "+00:00"))),
                ensure_utc(datetime.fromisoformat(s["end"].replace("Z", "+00:00"))),
            )
            for s in (slot.get("segments") or [])
        ]
        if slot_segments:
            in_job_worker_busy.setdefault(wid, []).extend(slot_segments)
            if unit_id:
                in_job_machine_busy.setdefault(unit_id, []).extend(slot_segments)

    scheduled_ends = [
        ensure_utc(datetime.fromisoformat(r["scheduledEnd"].replace("Z", "+00:00")))
        for r in results
        if r.get("scheduled") and r.get("scheduledEnd")
    ]
    projected = max(scheduled_ends) if scheduled_ends else None
    flag = compute_schedule_flag(projected, due_date)

    return {
        "proposed": True,
        "anchor": anchor_utc.isoformat(),
        "horizonDays": SCHEDULE_HORIZON_DAYS,
        "projectedCompletion": projected.isoformat() if projected else None,
        "scheduleFlag": flag,
        "operations": results,
    }


def validate_schedule(operations, due_date=None):
    """
    Check manual windows for sequence, overlap, and working-hour violations.
    Returns warnings (non-blocking), never raises for conflicts.
    Working-hour checks run against derived segments (not the overnight envelope).
    """
    normalized = sorted(
        [_normalize_operation(op, i) for i, op in enumerate(operations, start=1)],
        key=lambda o: o["sequenceNo"],
    )
    warnings = []

    intervals_by_worker = {}
    intervals_by_machine = {}

    prev_end = None
    for op in normalized:
        if not op.get("scheduledStart") or not op.get("scheduledEnd"):
            continue
        start = ensure_utc(datetime.fromisoformat(op["scheduledStart"].replace("Z", "+00:00")))
        end = ensure_utc(datetime.fromisoformat(op["scheduledEnd"].replace("Z", "+00:00")))
        if end <= start:
            warnings.append(
                {
                    "sequenceNo": op["sequenceNo"],
                    "code": "INVALID_WINDOW",
                    "message": f"Operation {op['sequenceNo']} has end before start",
                }
            )
            continue

        if prev_end and start < prev_end:
            warnings.append(
                {
                    "sequenceNo": op["sequenceNo"],
                    "code": "SEQUENCE_VIOLATION",
                    "message": (
                        f"Operation {op['sequenceNo']} starts before the previous operation completes"
                    ),
                }
            )
        prev_end = end

        wid = op.get("assignedWorkerId")
        segments = []
        if wid:
            schedule_by_dow = load_worker_schedule_maps(wid)
            shop_start = utc_to_shop(start)
            shop_end = utc_to_shop(end)
            exceptions = load_calendar_exceptions(shop_start.date(), shop_end.date())
            segments = derive_working_segments(start, end, schedule_by_dow, exceptions)

            if not segments:
                warnings.append(
                    {
                        "sequenceNo": op["sequenceNo"],
                        "code": "OUTSIDE_WORKING_HOURS",
                        "message": (
                            f"Operation {op['sequenceNo']} runs outside working hours on "
                            f"{shop_start.date().isoformat()}"
                        ),
                    }
                )
            else:
                first_start, _ = segments[0]
                _, last_end = segments[-1]
                # Envelope must match accumulated working time (no overhang past shifts).
                if abs((start - first_start).total_seconds()) > 1 or abs(
                    (end - last_end).total_seconds()
                ) > 1:
                    overhang_day = (
                        shop_start.date()
                        if abs((start - first_start).total_seconds()) > 1
                        else shop_end.date()
                    )
                    warnings.append(
                        {
                            "sequenceNo": op["sequenceNo"],
                            "code": "OUTSIDE_WORKING_HOURS",
                            "message": (
                                f"Operation {op['sequenceNo']} runs outside working hours on "
                                f"{overhang_day.isoformat()}"
                            ),
                        }
                    )
                for seg_start, seg_end in segments:
                    seg_shop_start = utc_to_shop(seg_start)
                    seg_shop_end = utc_to_shop(seg_end)
                    cur = seg_shop_start.date()
                    last = seg_shop_end.date()
                    outside = False
                    while cur <= last:
                        day_start_t, day_end_t, is_working = effective_hours_for_date(
                            cur, schedule_by_dow, exceptions
                        )
                        day_lo = datetime.combine(
                            cur, datetime.min.time(), tzinfo=seg_shop_start.tzinfo
                        )
                        day_hi = day_lo + timedelta(days=1)
                        slice_start = max(seg_shop_start, day_lo)
                        slice_end = min(seg_shop_end, day_hi)
                        if slice_start >= slice_end:
                            cur += timedelta(days=1)
                            continue
                        if not is_working or not day_start_t or not day_end_t:
                            outside = True
                            break
                        work_start = datetime.combine(
                            cur, day_start_t, tzinfo=seg_shop_start.tzinfo
                        )
                        work_end = datetime.combine(
                            cur, day_end_t, tzinfo=seg_shop_start.tzinfo
                        )
                        if slice_start < work_start or slice_end > work_end:
                            outside = True
                            break
                        cur += timedelta(days=1)
                    if outside:
                        warnings.append(
                            {
                                "sequenceNo": op["sequenceNo"],
                                "code": "OUTSIDE_WORKING_HOURS",
                                "message": (
                                    f"Operation {op['sequenceNo']} runs outside working hours on "
                                    f"{seg_shop_start.date().isoformat()}"
                                ),
                            }
                        )
                        break

            for seg_start, seg_end in segments:
                for other_start, other_end, other_seq in intervals_by_worker.get(wid, []):
                    if seg_start < other_end and other_start < seg_end:
                        warnings.append(
                            {
                                "sequenceNo": op["sequenceNo"],
                                "code": "WORKER_CONFLICT",
                                "message": (
                                    f"Worker double-booked on operations {other_seq} and {op['sequenceNo']}"
                                ),
                            }
                        )
                        break
                else:
                    continue
                break
            intervals_by_worker.setdefault(wid, []).extend(
                (s, e, op["sequenceNo"]) for s, e in segments
            )

        uid = op.get("machineUnitId")
        if uid:
            busy_pieces = segments if segments else [(start, end)]
            for seg_start, seg_end in busy_pieces:
                for other_start, other_end, other_seq in intervals_by_machine.get(uid, []):
                    if seg_start < other_end and other_start < seg_end:
                        warnings.append(
                            {
                                "sequenceNo": op["sequenceNo"],
                                "code": "MACHINE_CONFLICT",
                                "message": (
                                    f"Machine unit double-booked on operations {other_seq} and {op['sequenceNo']}"
                                ),
                            }
                        )
                        break
                else:
                    continue
                break
            intervals_by_machine.setdefault(uid, []).extend(
                (s, e, op["sequenceNo"]) for s, e in busy_pieces
            )

    projected = None
    ends = [
        ensure_utc(datetime.fromisoformat(o["scheduledEnd"].replace("Z", "+00:00")))
        for o in normalized
        if o.get("scheduledEnd")
    ]
    if ends:
        projected = max(ends)

    return {
        "warnings": warnings,
        "projectedCompletion": projected.isoformat() if projected else None,
        "scheduleFlag": compute_schedule_flag(projected, due_date) if due_date else None,
    }
