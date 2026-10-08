from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import re

from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models.job_order import (
    JobOrder,
    JobOrderStatus,
    JobPriority,
    JobType,
    MaterialStatus,
    PartCondition,
    PRODUCTION_STATUSES,
    PRODUCTION_VISIBLE_STATUSES,
)
from app.models.machine import MachineType
from app.models.operation import JobOperation, OperationStatus
from app.models.user import User, UserRole
from app.utils.errors import AppError


def _parse_date(value):
    if value is None or value == "":
        return None
    if isinstance(value, str):
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    return value


def _parse_datetime(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _parse_decimal(value, field_name):
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise AppError(f"Invalid {field_name}", "VALIDATION_ERROR", 400)


def _normalize_raw_materials(items, existing=None):
    """Clean the planned list. An entry keeps its id only when it matches one
    already on the job; new entries get a fresh id from the model validator.

    From stock is Admin-only and set through its own endpoint, so a saved list
    keeps each existing entry's flag and new entries start without it.
    """
    existing = existing or {}
    if items is None:
        return []
    if not isinstance(items, list):
        raise AppError("rawMaterials must be a list", "VALIDATION_ERROR", 400)
    normalized = []
    kept_ids = set()
    for item in items:
        if isinstance(item, str):
            name = item.strip()
            if name:
                normalized.append({"name": name})
            continue
        if not isinstance(item, dict):
            raise AppError("Each raw material must be an object", "VALIDATION_ERROR", 400)
        name = (item.get("name") or "").strip()
        if not name:
            continue
        entry = {"name": name}
        item_id = item.get("id")
        if item_id in existing and item_id not in kept_ids:
            entry["id"] = item_id
            kept_ids.add(item_id)
            if existing[item_id].get("fromStock"):
                entry["fromStock"] = True
        if item.get("quantity") not in (None, ""):
            entry["quantity"] = float(_parse_decimal(item["quantity"], "raw material quantity"))
        if item.get("unit"):
            entry["unit"] = str(item["unit"]).strip()
        normalized.append(entry)
    return normalized


_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


def _normalize_schedule_color(value):
    if value is None or value == "":
        return None
    color = str(value).strip()
    if not _HEX_COLOR_RE.match(color):
        raise AppError(
            "scheduleColor must be a hex color like #2563eb",
            "VALIDATION_ERROR",
            400,
        )
    return color.upper()


def _resolve_machine_type_id(op_data):
    mid = op_data.get("machineTypeId")
    if mid:
        mt = MachineType.query.get(mid)
        if not mt:
            raise AppError("Invalid machineTypeId", "VALIDATION_ERROR", 400)
        return mt.id
    # Legacy: machinesNeeded: ["MILLING"]
    codes = op_data.get("machinesNeeded") or []
    if codes:
        code = str(codes[0]).strip().upper()
        mt = MachineType.query.filter_by(code=code).first()
        if not mt:
            raise AppError(f"Unknown machine type '{code}'", "VALIDATION_ERROR", 400)
        return mt.id
    return None


def _assert_worker_has_operation_skill(worker, operation_type_id=None, operation_name=None):
    """An operation without a machine refuses a worker who lacks its skill, but
    only once at least one worker has that skill recorded."""
    from app.services.worker_profile_service import operation_skill_holders

    ot, holders = operation_skill_holders(
        operation_type_id=operation_type_id, operation_name=operation_name
    )
    if holders is None or worker.id in holders:
        return
    raise AppError(
        f"{worker.full_name} has no {ot.name} skill. "
        "Add the skill under Worker setup, or assign a qualified worker.",
        "WORKER_NOT_QUALIFIED",
        400,
    )


def _assert_worker_has_machine_skill(worker, machine_type_id):
    """Operations with no machine type are checked by _assert_worker_has_operation_skill."""
    if not machine_type_id:
        return
    from app.models.worker_skill import WorkerSkill

    has_skill = (
        WorkerSkill.query.filter_by(worker_id=worker.id, machine_type_id=machine_type_id).first()
        is not None
    )
    if has_skill:
        return
    machine = db.session.get(MachineType, machine_type_id)
    machine_name = machine.name if machine else "this machine type"
    raise AppError(
        f"{worker.full_name} has no skill for {machine_name}. "
        "Add the skill under Worker setup, or assign a qualified worker.",
        "WORKER_NOT_QUALIFIED",
        400,
    )


def _validate_worker(
    worker_id,
    start=None,
    end=None,
    exclude_operation_id=None,
    *,
    machine_type_id=None,
    operation_type_id=None,
    operation_name=None,
    exclude_operation_ids=None,
):
    from app.services.worker_profile_service import (
        assert_worker_allowed_for_operation,
        is_assignable_worker,
    )

    worker = User.query.get(worker_id)
    if not is_assignable_worker(worker):
        raise AppError("Invalid worker assignment", "VALIDATION_ERROR", 400)
    assert_worker_allowed_for_operation(
        worker,
        machine_type_id=machine_type_id,
        operation_type_id=operation_type_id,
        operation_name=operation_name,
    )
    _assert_worker_has_machine_skill(worker, machine_type_id)
    if not machine_type_id:
        _assert_worker_has_operation_skill(worker, operation_type_id, operation_name)
    from app.services.worker_availability import assert_worker_available

    assert_worker_available(
        worker_id,
        start=start,
        end=end,
        exclude_operation_id=exclude_operation_id,
        exclude_operation_ids=exclude_operation_ids,
    )
    return worker


def derive_job_status(job: JobOrder) -> JobOrderStatus:
    if job.status == JobOrderStatus.DELIVERED or job.delivered_at:
        return JobOrderStatus.DELIVERED
    # Draft is sticky until release — stage is derived from data, not stored.
    if job.status == JobOrderStatus.DRAFT:
        return JobOrderStatus.DRAFT

    ops = list(job.operations or [])
    if not ops:
        return JobOrderStatus.SCHEDULED
    if all(op.status == OperationStatus.COMPLETED for op in ops):
        return JobOrderStatus.COMPLETED
    if any(
        op.status in (OperationStatus.IN_PROGRESS, OperationStatus.COMPLETED, OperationStatus.REWORK)
        for op in ops
    ):
        return JobOrderStatus.IN_PROGRESS
    return JobOrderStatus.SCHEDULED


def _initial_part_condition(job_type: JobType) -> PartCondition:
    if job_type in (JobType.MODIFICATION, JobType.REPAIR):
        return PartCondition.CLIENT_SUPPLIED_ITEM
    return PartCondition.RAW_MATERIAL


# Furthest stage wins; never move backwards.
_PART_CONDITION_RANK = {
    PartCondition.RAW_MATERIAL: 0,
    PartCondition.CLIENT_SUPPLIED_ITEM: 0,
    PartCondition.WORK_IN_PROCESS: 1,
    PartCondition.CUT: 2,
    PartCondition.BLANK: 3,
    PartCondition.FORMED: 4,
    PartCondition.MACHINED: 5,
    PartCondition.ASSEMBLED: 6,
    PartCondition.HEAT_TREATED: 7,
    PartCondition.FINISHED: 8,
}

# Completed ops that never change the stage.
_STAGE_NEUTRAL_OP_CODES = frozenset({"CHECKING", "LAYOUT"})

_OP_CODE_STAGE = {
    "CUTTING": PartCondition.CUT,
    "BLANKING": PartCondition.BLANK,
    "BENDING": PartCondition.FORMED,
    "FORMING": PartCondition.FORMED,
    "WELDING": PartCondition.ASSEMBLED,
    "ASSEMBLY": PartCondition.ASSEMBLED,
    "FITTING": PartCondition.ASSEMBLED,
    "HEAT_TREATMENT": PartCondition.HEAT_TREATED,
    "FINISHING": PartCondition.FINISHED,
}

_MACHINING_OP_CODES = frozenset(
    {
        "TURNING",
        "FACING",
        "THREADING",
        "TEETH_CUTTING",
        "SLOTTING",
        "GROOVING",
        "DRILLING",
        "KEYWAY",
        "SPLINE",
        "SURFACE_GRINDING",
    }
)


def _part_condition_from_op_code(code: str | None) -> PartCondition | None:
    """Stage reached by completing an op of this code.

    None means the op does not change the stage (CHECKING, LAYOUT). Any other op with
    no specific stage (e.g. custom names) is generic WORK_IN_PROCESS.
    """
    if code in _STAGE_NEUTRAL_OP_CODES:
        return None
    if code in _MACHINING_OP_CODES:
        return PartCondition.MACHINED
    return _OP_CODE_STAGE.get(code or "", PartCondition.WORK_IN_PROCESS)


def _op_stage_code(op) -> str | None:
    if op.operation_type and op.operation_type.code:
        return op.operation_type.code
    name = (op.operation_name or "").strip().upper()
    return "_".join(name.replace("-", " ").split()) or None


def _rank(condition: PartCondition | None) -> int:
    if condition is None:
        return 0
    return _PART_CONDITION_RANK.get(condition, 0)


def advance_part_condition(job: JobOrder):
    """Advance part stage from completed operation types; never move backwards."""
    ops = list(job.operations or [])
    if not ops:
        return

    current = job.part_condition or PartCondition.RAW_MATERIAL
    best = current

    for op in ops:
        if op.status != OperationStatus.COMPLETED:
            continue
        stage = _part_condition_from_op_code(_op_stage_code(op))
        if stage is not None and _rank(stage) > _rank(best):
            best = stage

    if ops and all(op.status == OperationStatus.COMPLETED for op in ops):
        best = PartCondition.FINISHED

    if _rank(best) > _rank(current):
        job.part_condition = best


def check_job_access(job_order, user_id, user_role):
    if user_role in (UserRole.ADMIN.value, UserRole.OFFICE_STAFF.value):
        return True
    if user_role == UserRole.PRODUCTION_WORKER.value:
        if job_order.status == JobOrderStatus.DRAFT:
            raise AppError("Access denied", "FORBIDDEN", 403)
        has_op = any(op.assigned_worker_id == user_id for op in (job_order.operations or []))
        if not has_op:
            raise AppError("Access denied", "FORBIDDEN", 403)
        return True
    raise AppError("Access denied", "FORBIDDEN", 403)


def job_list_load_options():
    """Everything ``JobOrder.to_dict`` and the completion estimate read, in a
    fixed number of queries however many jobs are loaded."""
    from sqlalchemy.orm import selectinload

    from app.models.material_purchase import MaterialPurchase

    operations = selectinload(JobOrder.operations)
    purchases = selectinload(JobOrder.material_purchases)
    return (
        operations.joinedload(JobOperation.assigned_worker),
        operations.joinedload(JobOperation.machine_type),
        operations.joinedload(JobOperation.operation_type),
        operations.selectinload(JobOperation.time_logs),
        joinedload(JobOrder.client),
        joinedload(JobOrder.supplier),
        joinedload(JobOrder.created_by),
        joinedload(JobOrder.material_delay_supplier_order),
        purchases.joinedload(MaterialPurchase.supplier_order),
        purchases.joinedload(MaterialPurchase.supplier),
    )


def list_job_orders(user_id, user_role, status=None, scope=None, awaiting_material=False):
    query = JobOrder.query.options(*job_list_load_options())
    if user_role == UserRole.PRODUCTION_WORKER.value:
        query = query.filter(
            JobOrder.status.in_(tuple(PRODUCTION_VISIBLE_STATUSES)),
            JobOrder.operations.any(JobOperation.assigned_worker_id == user_id),
        )
    elif scope == "drafts":
        query = query.filter_by(status=JobOrderStatus.DRAFT)
    elif scope != "all":
        query = query.filter(JobOrder.status.in_(tuple(PRODUCTION_STATUSES)))
    if status:
        query = query.filter_by(status=JobOrderStatus(status))
    if awaiting_material:
        query = query.filter(
            JobOrder.material_status.in_(
                (MaterialStatus.TO_ORDER, MaterialStatus.ORDERED)
            )
        )
    return query.order_by(JobOrder.due_date.asc()).all()


def get_job_order(job_id, user_id, user_role):
    from app.models.material_purchase import MaterialPurchase
    from app.models.operation_time import OperationTimeLog
    from app.models.sales_invoice import SalesInvoice

    # Use filter().first() (not Query.get) so loader options always apply even
    # when the JobOrder is already present in the identity map.
    job = (
        JobOrder.query.options(
            joinedload(JobOrder.client),
            joinedload(JobOrder.created_by),
            joinedload(JobOrder.sales_invoice).joinedload(SalesInvoice.prepared_by),
            joinedload(JobOrder.operations).joinedload(JobOperation.assigned_worker),
            joinedload(JobOrder.operations).joinedload(JobOperation.machine_type),
            joinedload(JobOrder.operations).joinedload(JobOperation.operation_type),
            joinedload(JobOrder.operations).joinedload(JobOperation.machine_unit),
            joinedload(JobOrder.operations)
            .joinedload(JobOperation.time_logs)
            .joinedload(OperationTimeLog.worker),
            joinedload(JobOrder.material_purchases).joinedload(MaterialPurchase.supplier),
            joinedload(JobOrder.material_purchases).joinedload(
                MaterialPurchase.supplier_order
            ),
        )
        .filter(JobOrder.id == job_id)
        .first()
    )
    if not job:
        raise AppError("Job order not found", "NOT_FOUND", 404)
    check_job_access(job, user_id, user_role)
    return job


def _parse_turnaround(value):
    if value is None or value == "":
        return None
    try:
        days = int(value)
    except (TypeError, ValueError):
        raise AppError("turnaroundDays must be a whole number of days", "VALIDATION_ERROR", 400)
    if days < 1 or days > 90:
        raise AppError("turnaroundDays must be between 1 and 90", "VALIDATION_ERROR", 400)
    return days


def _build_operation(job_id, op_data, seq_fallback):
    from app.models.worker_skill import OperationType

    op_type_id = op_data.get("operationTypeId")
    op_type = OperationType.query.get(op_type_id) if op_type_id else None
    name = (op_data.get("operationName") or op_data.get("name") or "").strip()
    if not name and op_type:
        name = op_type.name
    if not name:
        raise AppError("Each operation requires a name", "VALIDATION_ERROR", 400)
    seq = op_data.get("sequenceNo", op_data.get("seq", seq_fallback))
    worker_id = op_data.get("assignedWorkerId")
    start = op_data.get("scheduledStart")
    end = op_data.get("scheduledEnd")
    machine_type_id = _resolve_machine_type_id(op_data)
    if not machine_type_id and op_type and op_type.default_machine_type_id:
        machine_type_id = op_type.default_machine_type_id
    outsourced = bool(op_type and op_type.is_outsourced)
    turnaround_days = None
    if outsourced:
        # Done outside the shop: no worker, machine or target hours.
        worker_id = None
        machine_type_id = None
        turnaround_days = _parse_turnaround(op_data.get("turnaroundDays"))
        if turnaround_days is None:
            turnaround_days = op_type.default_turnaround_days
    if worker_id:
        # Clashes are checked on working periods when the schedule is confirmed.
        _validate_worker(
            worker_id,
            machine_type_id=machine_type_id,
            operation_type_id=op_type_id,
            operation_name=name,
        )
    status_raw = op_data.get("status", "PENDING")
    try:
        status = OperationStatus(status_raw)
    except ValueError:
        status = OperationStatus.PENDING

    kwargs = {
        "job_order_id": job_id,
        "sequence_no": int(seq),
        "operation_name": name,
        "operation_type_id": op_type.id if op_type else op_type_id,
        "machine_type_id": machine_type_id,
        "machine_unit_id": None if outsourced else op_data.get("machineUnitId"),
        "assigned_worker_id": worker_id,
        "estimated_hours": (
            None if outsourced else _parse_decimal(op_data.get("estimatedHours"), "estimatedHours")
        ),
        "turnaround_days": turnaround_days,
        "scheduled_start": _parse_datetime(start),
        "scheduled_end": _parse_datetime(end),
        "status": status,
        "rework_of_operation_id": op_data.get("reworkOfOperationId"),
        "notes": op_data.get("notes"),
    }
    return JobOperation(**kwargs)


_DERIVED_MATERIAL_STATUSES = (MaterialStatus.ORDERED, MaterialStatus.RECEIVED)


def _direct_material_status(value, *, has_lines: bool) -> MaterialStatus:
    """Validate a material status sent by a client.

    Only NOT_REQUIRED and TO_ORDER may be set directly; ORDERED and RECEIVED
    come from purchase lines and are refused when the job has none.
    """
    try:
        status = MaterialStatus(value)
    except ValueError:
        raise AppError(
            "materialStatus must be NOT_REQUIRED, TO_ORDER, ORDERED, or RECEIVED",
            "VALIDATION_ERROR",
            400,
        )
    if status in _DERIVED_MATERIAL_STATUSES and not has_lines:
        raise AppError(
            "Material cannot be marked Ordered or Received until a purchase is "
            "recorded. Record the purchase, or set material to To order or Not required.",
            "VALIDATION_ERROR",
            400,
        )
    return status


def _assert_can_set_not_required(role):
    if role != UserRole.ADMIN.value:
        raise AppError(
            "Only the Admin can set material to Not required.",
            "FORBIDDEN",
            403,
        )


def create_job_order(data, created_by_id, actor_role=None):
    """Office creates a DRAFT from the client PO. Operations are optional; no notify.

    Planned materials decide the material status: some to buy means To order,
    none means Not required. Choosing Not required explicitly is Admin-only.
    """
    priority = data.get("priority") or JobPriority.MODERATE.value
    try:
        priority_enum = JobPriority(priority)
    except ValueError:
        raise AppError("priority must be HIGH, MODERATE, or LOW", "VALIDATION_ERROR", 400)

    try:
        job_type = JobType(data.get("jobType", "FABRICATION"))
    except ValueError:
        raise AppError("Invalid jobType", "VALIDATION_ERROR", 400)

    raw_materials = _normalize_raw_materials(data.get("rawMaterials"))
    material_status = (
        MaterialStatus.TO_ORDER if raw_materials else MaterialStatus.NOT_REQUIRED
    )
    if data.get("materialStatus"):
        requested = _direct_material_status(data["materialStatus"], has_lines=False)
        if requested == MaterialStatus.NOT_REQUIRED and raw_materials:
            if actor_role is not None:
                _assert_can_set_not_required(actor_role)
            material_status = MaterialStatus.NOT_REQUIRED

    try:
        job = JobOrder(
            client_id=data["clientId"],
            title=data["title"],
            description=data.get("description"),
            due_date=_parse_date(data["dueDate"]),
            client_po_number=(data.get("clientPoNumber") or None),
            po_date=_parse_date(data.get("poDate")),
            status=JobOrderStatus.DRAFT,
            priority=priority_enum,
            job_type=job_type,
            part_condition=_initial_part_condition(job_type),
            quantity=_parse_decimal(data.get("quantity"), "quantity"),
            unit_of_measure=(data.get("unitOfMeasure") or None),
            amount=_parse_decimal(data.get("amount"), "amount"),
            raw_materials=raw_materials,
            material_status=material_status,
            material_expected_date=_parse_date(data.get("materialExpectedDate")),
            material_received_date=_parse_date(data.get("materialReceivedDate")),
            supplier_id=(data.get("supplierId") or None),
            supplier_reference=(data.get("supplierReference") or None),
            created_by_id=created_by_id,
        )
        db.session.add(job)
        db.session.flush()

        # Optional ops on create (admin tooling); still stays DRAFT — no JOB_RECEIVED.
        for i, op_data in enumerate(data.get("operations") or [], start=1):
            op = _build_operation(job.id, op_data, i)
            db.session.add(op)

        db.session.commit()
        return get_job_order(job.id, created_by_id, UserRole.OFFICE_STAFF.value)
    except AppError:
        db.session.rollback()
        raise
    except Exception:
        db.session.rollback()
        raise


def mark_job_delivered(job):
    """Office marks the job delivered / ready for pickup. Fires JOB_DELIVERED."""
    from app.models.notification import NotificationMilestone
    from app.services.notification_service import safe_notify_job_milestone

    if job.status == JobOrderStatus.DELIVERED or job.delivered_at:
        return job

    ops = list(job.operations or [])
    if not ops or not all(op.status == OperationStatus.COMPLETED for op in ops):
        raise AppError(
            "All operations must be complete before delivery",
            "INVALID_TRANSITION",
            409,
        )

    if job.sales_invoice is None:
        raise AppError(
            "Record the sales invoice for this job before marking it delivered.",
            "INVOICE_REQUIRED",
            409,
        )

    try:
        from datetime import datetime, timezone

        job.status = JobOrderStatus.DELIVERED
        job.delivered_at = datetime.now(timezone.utc)
        db.session.commit()
        safe_notify_job_milestone(job.id, NotificationMilestone.JOB_DELIVERED)
        return job
    except AppError:
        db.session.rollback()
        raise
    except Exception:
        db.session.rollback()
        raise


def update_job_order(job, data, actor_role=None):
    """Update job fields and/or operations.

    Office may edit job information while DRAFT.
    Admin may edit operations while DRAFT.
    After release (SCHEDULED+), either role may update as before; status is re-derived.
    """
    try:
        _apply_job_update(job, data, actor_role)
        db.session.commit()
        return get_job_order(job.id, job.created_by_id, UserRole.OFFICE_STAFF.value)
    except AppError:
        db.session.rollback()
        raise
    except Exception:
        db.session.rollback()
        raise


def _apply_job_update(job, data, role):
    """Apply an update payload to the job without committing."""
    is_draft = job.status == JobOrderStatus.DRAFT

    if is_draft and role == UserRole.OFFICE_STAFF.value and "operations" in data:
        raise AppError(
            "Office staff cannot edit operations during planning",
            "FORBIDDEN",
            403,
        )

    if "clientId" in data:
        job.client_id = data["clientId"]
    if "title" in data:
        job.title = data["title"]
    if "description" in data:
        job.description = data["description"]
    if "dueDate" in data:
        job.due_date = _parse_date(data["dueDate"])
    if "clientPoNumber" in data:
        job.client_po_number = data.get("clientPoNumber") or None
    if "poDate" in data:
        job.po_date = _parse_date(data.get("poDate"))
    if data.get("priority"):
        try:
            job.priority = JobPriority(data["priority"])
        except ValueError:
            raise AppError("priority must be HIGH, MODERATE, or LOW", "VALIDATION_ERROR", 400)
    if "jobType" in data:
        try:
            job.job_type = JobType(data["jobType"])
        except ValueError:
            raise AppError("Invalid jobType", "VALIDATION_ERROR", 400)
        # Only reset initial stage when no ops have advanced the piece yet.
        if not any(
            op.status == OperationStatus.COMPLETED for op in (job.operations or [])
        ):
            job.part_condition = _initial_part_condition(job.job_type)
    if data.get("partCondition"):
        raise AppError(
            "The part stage is worked out from completed operations and cannot be set.",
            "VALIDATION_ERROR",
            400,
        )
    if "quantity" in data:
        job.quantity = _parse_decimal(data.get("quantity"), "quantity")
    if "unitOfMeasure" in data:
        job.unit_of_measure = data.get("unitOfMeasure") or None
    if "amount" in data:
        job.amount = _parse_decimal(data.get("amount"), "amount")
    if "rawMaterials" in data:
        existing = {
            m["id"]: m for m in (job.raw_materials or []) if isinstance(m, dict) and m.get("id")
        }
        new_list = _normalize_raw_materials(data.get("rawMaterials"), existing)
        kept = {m.get("id") for m in new_list}
        in_use = {
            p.planned_material_id
            for p in (job.material_purchases or [])
            if p.planned_material_id and p.cancelled_at is None
        }
        dropped = [existing[i]["name"] for i in existing if i in in_use and i not in kept]
        if dropped:
            raise AppError(
                "Cannot remove planned material with purchases recorded: "
                + ", ".join(dropped),
                "PLANNED_MATERIAL_IN_USE",
                409,
            )
        previous = list(job.raw_materials or [])
        job.raw_materials = new_list
        if job.raw_materials != previous:
            from app.services.material_purchase_service import (
                apply_planned_materials_rule,
            )

            apply_planned_materials_rule(job, previous)
    if "materialStatus" in data and data["materialStatus"]:
        from app.services.material_purchase_service import placed_lines

        has_lines = bool(placed_lines(job))
        new_material_status = _direct_material_status(
            data["materialStatus"], has_lines=has_lines
        )
        if (
            new_material_status == MaterialStatus.NOT_REQUIRED
            and job.material_status != MaterialStatus.NOT_REQUIRED
        ):
            _assert_can_set_not_required(role)
        if new_material_status == MaterialStatus.NOT_REQUIRED:
            job.material_status = MaterialStatus.NOT_REQUIRED
        elif job.material_status == MaterialStatus.NOT_REQUIRED:
            # Lifting Not required: the planned list and lines decide again.
            from app.services.material_purchase_service import (
                apply_planned_materials_rule,
            )

            job.material_status = MaterialStatus.TO_ORDER
            apply_planned_materials_rule(job, [])
    if "materialExpectedDate" in data:
        job.material_expected_date = _parse_date(data.get("materialExpectedDate"))
    if "materialReceivedDate" in data:
        job.material_received_date = _parse_date(data.get("materialReceivedDate"))
    if "supplierId" in data:
        sid = data.get("supplierId") or None
        if sid:
            from app.models.supplier import Supplier

            if not Supplier.query.get(sid):
                raise AppError("Supplier not found", "NOT_FOUND", 404)
        job.supplier_id = sid
    if "supplierReference" in data:
        job.supplier_reference = (data.get("supplierReference") or None)
    if "scheduleColor" in data:
        job.schedule_color = _normalize_schedule_color(data.get("scheduleColor"))

    if "operations" in data:
        if not is_draft:
            raise AppError(
                "Operations can only be replaced while the job is pending. "
                "This job has been released; reassign, reschedule, or add rework "
                "to individual operations instead.",
                "OPERATIONS_LOCKED",
                409,
            )
        _assert_no_started_operations(job)
        JobOperation.query.filter_by(job_order_id=job.id).delete()
        for i, op_data in enumerate(data["operations"], start=1):
            payload = dict(op_data)
            payload.pop("id", None)
            op = _build_operation(job.id, payload, i)
            db.session.add(op)
        db.session.flush()

    if job.status != JobOrderStatus.DRAFT:
        job.status = derive_job_status(job)
    advance_part_condition(job)


def _release_missing_items(job: JobOrder) -> list[str]:
    ops = sorted(list(job.operations or []), key=lambda o: o.sequence_no or 0)
    if not ops:
        return ["Add at least one operation first."]
    missing = []
    for op in ops:
        label = op.operation_name or f"Operation {op.sequence_no}"
        seq = op.sequence_no
        if op.is_outsourced:
            if not op.turnaround_days:
                missing.append(f"#{seq} {label}: set the turnaround in days")
            continue
        if not op.assigned_worker_id:
            missing.append(f"#{seq} {label}: assign a worker")
        if op.estimated_hours is None:
            missing.append(f"#{seq} {label}: set target hours")
    return missing


def set_planned_material_from_stock(job, material_id, from_stock):
    """Admin marks one planned material as taken from the shop's stock (or not)."""
    from app.services.material_purchase_service import apply_planned_materials_rule

    items = list(job.raw_materials or [])
    index = next(
        (i for i, m in enumerate(items) if isinstance(m, dict) and m.get("id") == material_id),
        None,
    )
    if index is None:
        raise AppError("Planned material not found on this job", "NOT_FOUND", 404)
    item = items[index]
    if from_stock:
        in_use = [
            p
            for p in (job.material_purchases or [])
            if p.planned_material_id == material_id and p.cancelled_at is None
        ]
        if in_use:
            raise AppError(
                f"{item.get('name') or 'This material'} already has purchases recorded. "
                "Cancel them before marking it From stock.",
                "PLANNED_MATERIAL_IN_USE",
                409,
            )
    updated = {k: v for k, v in item.items() if k != "fromStock"}
    if from_stock:
        updated["fromStock"] = True
    if updated == item:
        return get_job_order(job.id, job.created_by_id, UserRole.ADMIN.value)
    try:
        previous = items
        job.raw_materials = items[:index] + [updated] + items[index + 1 :]
        apply_planned_materials_rule(job, previous)
        db.session.commit()
        return get_job_order(job.id, job.created_by_id, UserRole.ADMIN.value)
    except Exception:
        db.session.rollback()
        raise


def mark_material_received(job, received_date=None):
    """Office/Admin receives every outstanding purchase line for this job.

    Refused when no purchase is recorded; job status follows from the lines.
    """
    from app.services import material_purchase_service as mp_service

    try:
        mp_service.receive_all_outstanding(job, received_date)
        return get_job_order(job.id, job.created_by_id, UserRole.OFFICE_STAFF.value)
    except AppError:
        db.session.rollback()
        raise
    except Exception:
        db.session.rollback()
        raise


def _material_floor_utc(job: JobOrder):
    from app.services.material_purchase_service import scheduling_material_floor
    from app.services.schedule_service import resolve_material_not_before_utc

    floor_date, _ = scheduling_material_floor(job)
    return floor_date, resolve_material_not_before_utc(job.material_status, None, floor_date)


def _derive_scheduled_ends(job: JobOrder) -> None:
    """End is never typed: it follows Start and the target hours across the
    worker's working hours, overtime and holidays."""
    from app.constants.scheduling import DEFAULT_ESTIMATED_HOURS
    from app.services.schedule_service import place_from_start

    for op in job.operations:
        if op.status in _STARTED_OPERATION_STATUSES or op.actual_start is not None:
            continue
        if op.is_outsourced:
            if op.scheduled_start and op.turnaround_days:
                op.scheduled_end = op.scheduled_start + timedelta(days=int(op.turnaround_days))
            continue
        if not op.scheduled_start or not op.assigned_worker_id:
            continue
        hours = op.estimated_hours if op.estimated_hours is not None else DEFAULT_ESTIMATED_HOURS
        _start, end, _segments = place_from_start(op.assigned_worker_id, op.scheduled_start, hours)
        if end is not None:
            op.scheduled_end = end


def _assert_schedule_has_no_problems(job: JobOrder, lead: str) -> None:
    from app.services.schedule_service import schedule_problems

    _floor_date, floor_utc = _material_floor_utc(job)
    problems = schedule_problems(
        sorted(job.operations, key=lambda o: o.sequence_no or 0),
        exclude_job_id=job.id,
        material_not_before_utc=floor_utc,
    )
    if problems:
        raise AppError(
            f"{lead} " + "; ".join(p["message"] for p in problems) + ".",
            "SCHEDULE_INVALID",
            409,
        )


def propose_for_job(job: JobOrder, data: dict) -> dict:
    """
    Proposal for the Schedule step or a released job's re-plan, with every
    problem that would stop it being confirmed.

    pinSequence: that operation starts at its scheduledStart; the ones after it
      are re-placed from its end (pending jobs: earliest free time, earlier or
      later; released jobs: never earlier than now planned).
    restoreSaved: show the pending job's saved schedule, unless it starts in the
      past, in which case a fresh one is proposed (replacedPastStart says so).
    """
    from app.services import material_purchase_service as mp_service
    from app.services.schedule_calendar import ensure_utc
    from app.services.schedule_service import (
        propose_schedule,
        resolve_material_not_before_utc,
        schedule_problems,
    )

    mp_service.assert_material_date_known(job)
    ready_date, ready_reason = mp_service.scheduling_material_floor(job)
    material_nb = resolve_material_not_before_utc(job.material_status, None, ready_date)
    is_draft = job.status == JobOrderStatus.DRAFT

    ops = data.get("operations")
    lock_before = data.get("lockBeforeSequence")
    honor_pins = bool(data.get("honorMachinePins"))
    restored = False
    replaced_past_start = None
    if ops is None:
        ops = sorted(job.operations, key=lambda o: o.sequence_no or 0)
        if data.get("restoreSaved") and is_draft and ops:
            not_started = [
                o for o in ops
                if o.status not in _STARTED_OPERATION_STATUSES and o.actual_start is None
            ]
            starts = [ensure_utc(o.scheduled_start) for o in not_started if o.scheduled_start]
            if starts and len(starts) == len(not_started):
                honor_pins = True
                earliest = min(starts)
                if earliest >= datetime.now(timezone.utc):
                    lock_before = max(o.sequence_no or 0 for o in ops) + 1
                    restored = True
                else:
                    replaced_past_start = earliest.isoformat()

    if data.get("anchor"):
        anchor = _parse_datetime(data["anchor"])
    else:
        # Next quarter hour, so a fresh proposal isn't already in the past when confirmed.
        now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        anchor = now + timedelta(minutes=15 - now.minute % 15)
    result = propose_schedule(
        ops,
        job.due_date,
        exclude_job_id=job.id,
        anchor_utc=anchor,
        lock_before_sequence=lock_before,
        honor_machine_pins=honor_pins,
        material_not_before_utc=material_nb,
        material_constraint_reason=ready_reason,
        never_earlier=not is_draft,
        pin_sequence=data.get("pinSequence"),
    )
    by_id = {o.id: o for o in job.operations}
    checked = []
    for row in result["operations"]:
        src = by_id.get(row.get("id"))
        checked.append(
            {
                **row,
                "status": src.status.value if src and src.status else "PENDING",
                "actualStart": src.actual_start.isoformat() if src and src.actual_start else None,
            }
        )
    result["problems"] = schedule_problems(
        checked, exclude_job_id=job.id, material_not_before_utc=material_nb
    )
    result["restored"] = restored
    result["replacedPastStart"] = replaced_past_start
    return result


def _assert_first_operation_after_material_floor(job: JobOrder) -> None:
    from app.services.schedule_calendar import ensure_utc

    floor_date, floor_utc = _material_floor_utc(job)
    if floor_utc is None:
        return
    first = min(job.operations, key=lambda o: o.sequence_no or 0)
    if ensure_utc(first.scheduled_start) < floor_utc:
        raise AppError(
            f"The first operation cannot start before {floor_date.isoformat()}, "
            "when the materials can be in. Propose the schedule again.",
            "MATERIAL_NOT_READY",
            400,
        )


def confirm_job_schedule(job, data=None, actor_role=None):
    """Admin confirms a pending job's schedule, which releases it to production.

    Saves the operations sent (if any), checks every operation has a worker,
    target hours and a window, then marks the job and its operations Scheduled
    and fires JOB_RECEIVED. Nothing is saved when a check fails.
    """
    from app.models.notification import NotificationMilestone
    from app.services.notification_service import safe_notify_job_milestone

    data = data or {}
    if job.status != JobOrderStatus.DRAFT:
        raise AppError(
            "Only pending jobs can have their schedule confirmed",
            "INVALID_TRANSITION",
            409,
        )

    try:
        update = {k: data[k] for k in ("operations", "materialStatus") if k in data}
        if update:
            _apply_job_update(job, update, actor_role)
            db.session.flush()
            db.session.expire(job, ["operations"])

        missing = _release_missing_items(job)
        if missing:
            raise AppError(
                "Cannot confirm the schedule yet — " + "; ".join(missing),
                "VALIDATION_ERROR",
                400,
            )

        _derive_scheduled_ends(job)
        db.session.flush()
        unscheduled = [
            f"#{op.sequence_no} {op.operation_name or f'Operation {op.sequence_no}'}"
            for op in sorted(job.operations, key=lambda o: o.sequence_no or 0)
            if not op.scheduled_start or not op.scheduled_end
        ]
        if unscheduled:
            raise AppError(
                "Cannot confirm the schedule yet — these operations have no "
                "scheduled window: " + ", ".join(unscheduled) + ". Schedule them first.",
                "OPERATIONS_UNSCHEDULED",
                400,
            )

        _assert_first_operation_after_material_floor(job)
        _assert_schedule_has_no_problems(job, "Cannot confirm the schedule —")

        for op in job.operations:
            if op.status == OperationStatus.PENDING:
                op.status = OperationStatus.SCHEDULED
        job.status = JobOrderStatus.SCHEDULED
        job.status = derive_job_status(job)
        job.released_at = datetime.now(timezone.utc)
        db.session.commit()
        safe_notify_job_milestone(job.id, NotificationMilestone.JOB_RECEIVED)
        return get_job_order(job.id, job.created_by_id, UserRole.ADMIN.value)
    except AppError:
        db.session.rollback()
        raise
    except Exception:
        db.session.rollback()
        raise


_STARTED_OPERATION_STATUSES = (OperationStatus.IN_PROGRESS, OperationStatus.COMPLETED)


def _assert_no_started_operations(job):
    """Started or completed operations (and their time logs) are production records."""
    started = [
        op
        for op in (job.operations or [])
        if op.status in _STARTED_OPERATION_STATUSES or op.actual_start is not None
    ]
    if started:
        names = ", ".join(op.operation_name for op in started)
        raise AppError(
            f"Work has already been recorded on {names}. "
            "Started or completed operations cannot be deleted.",
            "OPERATIONS_STARTED",
            409,
        )


def delete_job_order(job):
    """Permanently remove a pending job order, its operations, and schedule data."""
    if job.status != JobOrderStatus.DRAFT:
        raise AppError(
            "This job has been released and the client was told it was received, "
            "so it can no longer be deleted.",
            "JOB_RELEASED",
            409,
        )
    if job.sales_invoice is not None:
        raise AppError(
            "This job has a recorded sales invoice and cannot be deleted.",
            "INVOICE_EXISTS",
            409,
        )
    _assert_no_started_operations(job)
    try:
        from app.models.tool_event import ToolEvent

        ToolEvent.query.filter_by(job_order_id=job.id).update(
            {ToolEvent.job_order_id: None}, synchronize_session=False
        )
        db.session.delete(job)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise


def assign_operation_worker(operation, worker_id):
    if operation.is_outsourced:
        raise AppError(
            "This operation is done outside the shop and has no worker.",
            "OPERATION_OUTSOURCED",
            409,
        )
    if operation.status in _STARTED_OPERATION_STATUSES or operation.actual_start is not None:
        raise AppError(
            "This operation has already started, so its worker can't be changed.",
            "OPERATION_STARTED",
            409,
        )
    _validate_worker(
        worker_id,
        start=operation.scheduled_start,
        end=operation.scheduled_end,
        exclude_operation_id=operation.id,
        machine_type_id=operation.machine_type_id,
        operation_type_id=operation.operation_type_id,
        operation_name=operation.operation_name,
    )
    try:
        operation.assigned_worker_id = worker_id
        if operation.status == OperationStatus.PENDING:
            operation.status = OperationStatus.SCHEDULED
        operation.job_order.status = derive_job_status(operation.job_order)
        db.session.commit()
        return operation
    except Exception:
        db.session.rollback()
        raise


def _same_instant(a, b) -> bool:
    from app.services.schedule_calendar import ensure_utc

    if a is None or b is None:
        return a is None and b is None
    return ensure_utc(a) == ensure_utc(b)


def apply_released_schedule(job, operations):
    """
    Admin confirms a re-proposed schedule for a released job. Only operations
    that have not started get new starts (ends follow from target hours);
    started or completed work never moves. Every operation is checked.
    """
    from app.models.machine import MachineUnit

    if job.status in (JobOrderStatus.DRAFT, JobOrderStatus.COMPLETED, JobOrderStatus.DELIVERED):
        raise AppError(
            "Only released jobs with work still to do can be re-scheduled.",
            "INVALID_TRANSITION",
            409,
        )
    if not operations:
        raise AppError("operations is required", "VALIDATION_ERROR", 400)

    by_id = {op.id: op for op in job.operations}
    try:
        for data in operations:
            op = by_id.get(data.get("id"))
            if op is None:
                raise AppError(
                    "Operation does not belong to this job", "VALIDATION_ERROR", 400
                )
            start = _parse_datetime(data.get("scheduledStart"))
            end = _parse_datetime(data.get("scheduledEnd"))
            started = op.status in _STARTED_OPERATION_STATUSES or op.actual_start is not None
            if started:
                start_kept = (
                    start is None
                    or _same_instant(start, op.scheduled_start)
                    or _same_instant(start, op.actual_start)
                )
                end_kept = end is None or _same_instant(end, op.scheduled_end)
                if not (start_kept and end_kept):
                    raise AppError(
                        f"{op.operation_name or f'Operation {op.sequence_no}'} has already "
                        "started, so its schedule can't be moved.",
                        "OPERATION_STARTED",
                        409,
                    )
                continue
            if not start:
                raise AppError(
                    f"{op.operation_name or f'Operation {op.sequence_no}'} needs a start time.",
                    "VALIDATION_ERROR",
                    400,
                )
            unit_id = data.get("machineUnitId") or None
            if unit_id:
                unit = MachineUnit.query.get(unit_id)
                if unit is None or (
                    op.machine_type_id and unit.machine_type_id != op.machine_type_id
                ):
                    raise AppError(
                        "Machine unit does not match the operation's machine type",
                        "VALIDATION_ERROR",
                        400,
                    )
            label = op.operation_name or f"Operation {op.sequence_no}"
            if op.is_outsourced:
                op.scheduled_start = start
                if op.status == OperationStatus.PENDING:
                    op.status = OperationStatus.SCHEDULED
                continue
            worker_id = data.get("assignedWorkerId") or op.assigned_worker_id
            if not worker_id:
                raise AppError(
                    f"{label}: assign a worker to schedule this operation.",
                    "VALIDATION_ERROR",
                    400,
                )
            try:
                _validate_worker(
                    worker_id,
                    machine_type_id=op.machine_type_id,
                    operation_type_id=op.operation_type_id,
                    operation_name=op.operation_name,
                )
            except AppError as exc:
                raise AppError(f"{label}: {exc.message}", exc.code, exc.status_code)

            op.scheduled_start = start
            op.machine_unit_id = unit_id or op.machine_unit_id
            op.assigned_worker_id = worker_id
            if op.status == OperationStatus.PENDING and worker_id:
                op.status = OperationStatus.SCHEDULED

        _derive_scheduled_ends(job)
        db.session.flush()
        _assert_schedule_has_no_problems(job, "This schedule can't be applied:")

        job.status = derive_job_status(job)
        db.session.commit()
        return get_job_order(job.id, job.created_by_id, UserRole.ADMIN.value)
    except AppError:
        db.session.rollback()
        raise
    except Exception:
        db.session.rollback()
        raise
