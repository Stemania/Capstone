import enum
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import validates

from app.extensions import db


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


class JobOrderStatus(enum.Enum):
    # Pre-production (Office / Admin planning)
    DRAFT = "DRAFT"
    # Production floor
    SCHEDULED = "SCHEDULED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    DELIVERED = "DELIVERED"
    # Legacy labels — retained for Postgres enum compatibility only; never set in code.
    PLANNING = "PLANNING"
    RELEASED = "RELEASED"
    UNASSIGNED = "UNASSIGNED"
    ASSIGNED = "ASSIGNED"


# Enum labels that remain in the DB type but must not be written by application code.
DEPRECATED_JOB_STATUSES = frozenset(
    {
        JobOrderStatus.PLANNING,
        JobOrderStatus.RELEASED,
        JobOrderStatus.UNASSIGNED,
        JobOrderStatus.ASSIGNED,
    }
)

PRODUCTION_STATUSES = frozenset(
    {
        JobOrderStatus.SCHEDULED,
        JobOrderStatus.IN_PROGRESS,
        JobOrderStatus.COMPLETED,
        JobOrderStatus.DELIVERED,
    }
)

# Workers may only see committed production jobs (not drafts).
PRODUCTION_VISIBLE_STATUSES = PRODUCTION_STATUSES


class JobPriority(enum.Enum):
    HIGH = "HIGH"
    MODERATE = "MODERATE"
    LOW = "LOW"


class JobType(enum.Enum):
    FABRICATION = "FABRICATION"
    MODIFICATION = "MODIFICATION"
    REPAIR = "REPAIR"


class MaterialStatus(enum.Enum):
    NOT_REQUIRED = "NOT_REQUIRED"
    TO_ORDER = "TO_ORDER"
    ORDERED = "ORDERED"
    RECEIVED = "RECEIVED"


def default_material_status(job_type: JobType) -> MaterialStatus:
    """REPAIR/MODIFICATION use client-supplied parts; fabrication needs steel ordered."""
    if job_type in (JobType.REPAIR, JobType.MODIFICATION):
        return MaterialStatus.NOT_REQUIRED
    return MaterialStatus.TO_ORDER


class PartCondition(enum.Enum):
    RAW_MATERIAL = "RAW_MATERIAL"
    CLIENT_SUPPLIED_ITEM = "CLIENT_SUPPLIED_ITEM"
    BLANK = "BLANK"
    WORK_IN_PROCESS = "WORK_IN_PROCESS"
    MACHINED = "MACHINED"
    HEAT_TREATED = "HEAT_TREATED"
    FINISHED = "FINISHED"
    CUT = "CUT"
    FORMED = "FORMED"
    ASSEMBLED = "ASSEMBLED"


def draft_stage_label(job: "JobOrder") -> str:
    """Human-readable planning stage for DRAFT rows (not stored)."""
    ops = list(job.operations or [])
    meaningful = [
        o
        for o in ops
        if (o.operation_name or "").strip() or o.operation_type_id
    ]
    if not meaningful:
        return "No operations yet"
    n = len(meaningful)
    word = "operation" if n == 1 else "operations"
    if all(o.scheduled_start and o.scheduled_end for o in meaningful):
        return f"{n} {word}, schedule ready"
    return f"{n} {word}, not scheduled"


class JobOrder(db.Model):
    __tablename__ = "job_orders"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    client_id = db.Column(
        db.String(36), db.ForeignKey("clients.id"), nullable=False, index=True
    )
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    # Client PO "date required" — reused; do not add a separate date_required column.
    due_date = db.Column(db.Date, nullable=False, index=True)
    client_po_number = db.Column(db.String(100), nullable=True)
    po_date = db.Column(db.Date, nullable=True)
    status = db.Column(
        db.Enum(JobOrderStatus), nullable=False, default=JobOrderStatus.DRAFT, index=True
    )
    priority = db.Column(
        db.Enum(JobPriority), nullable=False, default=JobPriority.MODERATE, index=True
    )
    job_type = db.Column(
        db.Enum(JobType), nullable=False, default=JobType.FABRICATION, index=True
    )
    part_condition = db.Column(
        db.Enum(PartCondition),
        nullable=False,
        default=PartCondition.RAW_MATERIAL,
        index=True,
    )
    quantity = db.Column(db.Numeric(12, 2), nullable=True)
    unit_of_measure = db.Column(db.String(32), nullable=True)
    amount = db.Column(db.Numeric(14, 2), nullable=True)
    # [{ "name": "Mild steel plate", "quantity": 2, "unit": "pcs" }, ...]
    raw_materials = db.Column(JSONB, nullable=False, default=list)
    material_status = db.Column(
        db.Enum(MaterialStatus),
        nullable=False,
        default=MaterialStatus.TO_ORDER,
        index=True,
    )
    material_expected_date = db.Column(db.Date, nullable=True)
    material_received_date = db.Column(db.Date, nullable=True)
    # Preferred supplier for the job (optional); PO/invoice number stays free-text.
    supplier_id = db.Column(
        db.String(36), db.ForeignKey("suppliers.id"), nullable=True, index=True
    )
    # Supplier's own order / invoice number.
    supplier_reference = db.Column(db.String(120), nullable=True)
    # Hex color (#RRGGBB) for schedule board distinction; optional.
    schedule_color = db.Column(db.String(7), nullable=True)
    created_by_id = db.Column(
        db.String(36), db.ForeignKey("users.id"), nullable=False
    )
    delivered_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    client = db.relationship("Client", back_populates="job_orders")
    supplier = db.relationship("Supplier", back_populates="job_orders")
    created_by = db.relationship(
        "User", back_populates="created_job_orders", foreign_keys=[created_by_id]
    )
    operations = db.relationship(
        "JobOperation",
        back_populates="job_order",
        cascade="all, delete-orphan",
        order_by="JobOperation.sequence_no",
    )
    material_purchases = db.relationship(
        "MaterialPurchase",
        back_populates="job_order",
        cascade="all, delete-orphan",
        order_by="MaterialPurchase.date_ordered",
    )
    sales_invoice = db.relationship(
        "SalesInvoice", back_populates="job_order", uselist=False
    )
    tool_events = db.relationship("ToolEvent", back_populates="job_order")
    notification_logs = db.relationship(
        "NotificationLog",
        back_populates="job_order",
        cascade="all, delete-orphan",
    )

    def _serialize_operations(self, ops):
        """Serialize ops with request-scoped schedule/downtime caches (no N+1)."""
        from app.models.operation_time import MachineDowntime
        from app.services.schedule_calendar import (
            load_calendar_exceptions,
            load_worker_schedule_maps_many,
            utc_to_shop,
        )

        worker_ids = {op.assigned_worker_id for op in ops if op.assigned_worker_id}
        schedule_by_worker = load_worker_schedule_maps_many(worker_ids)

        starts = [op.scheduled_start for op in ops if op.scheduled_start]
        ends = [op.scheduled_end for op in ops if op.scheduled_end]
        if starts and ends:
            calendar_exceptions = load_calendar_exceptions(
                utc_to_shop(min(starts)).date(),
                utc_to_shop(max(ends)).date(),
            )
        else:
            calendar_exceptions = {}

        unit_ids = {op.machine_unit_id for op in ops if op.machine_unit_id}
        if unit_ids:
            open_downtime_unit_ids = {
                uid
                for (uid,) in db.session.query(MachineDowntime.machine_unit_id)
                .filter(
                    MachineDowntime.machine_unit_id.in_(unit_ids),
                    MachineDowntime.ended_at.is_(None),
                )
                .all()
            }
        else:
            open_downtime_unit_ids = set()

        return [
            op.to_dict(
                schedule_by_worker=schedule_by_worker,
                calendar_exceptions=calendar_exceptions,
                open_downtime_unit_ids=open_downtime_unit_ids,
            )
            for op in ops
        ]

    @validates("raw_materials")
    def _ensure_raw_material_ids(self, _key, items):
        """Every planned material carries a stable id that purchases link to."""
        out = []
        for item in items or []:
            if isinstance(item, dict) and not item.get("id"):
                item = {**item, "id": _uuid()}
            out.append(item)
        return out

    def planned_materials_summary(self):
        """Planned quantity vs linked purchase lines for each planned material.

        Ordered = placed lines (issued PO or recorded without a PO); draft =
        lines still on a draft PO. Cancelled lines count for nothing, so their
        material goes back to to-order. Still to order = planned - ordered - draft.
        """
        ordered: dict[str, Decimal] = {}
        drafted: dict[str, Decimal] = {}
        for p in self.material_purchases or []:
            if not p.planned_material_id or p.cancelled_at is not None:
                continue
            bucket = drafted if p.is_draft else ordered
            bucket[p.planned_material_id] = bucket.get(
                p.planned_material_id, Decimal("0")
            ) + Decimal(str(p.quantity or 0))
        rows = []
        for item in self.raw_materials or []:
            if not isinstance(item, dict) or not item.get("id"):
                continue
            purchased = ordered.get(item["id"], Decimal("0"))
            draft = drafted.get(item["id"], Decimal("0"))
            planned = item.get("quantity")
            if planned is None:
                remaining = None
                if purchased > 0:
                    status = "PURCHASED"
                elif draft > 0:
                    status = "ON_DRAFT_ORDER"
                else:
                    status = "TO_ORDER"
            else:
                remaining = max(Decimal(str(planned)) - purchased - draft, Decimal("0"))
                if purchased >= Decimal(str(planned)):
                    status = "PURCHASED"
                elif remaining == 0:
                    status = "ON_DRAFT_ORDER"
                elif purchased > 0 or draft > 0:
                    status = "PARTLY_ORDERED"
                else:
                    status = "TO_ORDER"
            rows.append(
                {
                    "id": item["id"],
                    "name": item.get("name"),
                    "unit": item.get("unit"),
                    "plannedQuantity": planned,
                    "purchasedQuantity": float(purchased),
                    "draftQuantity": float(draft),
                    "remainingQuantity": float(remaining) if remaining is not None else None,
                    "status": status,
                }
            )
        return rows

    def _material_readiness(self):
        from app.services.material_purchase_service import (
            derived_material_expected,
            material_readiness_date,
        )

        ready, reason = material_readiness_date(self)
        derived = derived_material_expected(self)
        if derived:
            source = "PURCHASE_LINES"
        elif ready:
            source = "JOB"
        else:
            source = None
        return {
            "expectedDate": ready.isoformat() if ready else None,
            "reason": reason,
            "source": source,
            "limitingLine": derived["limitingLine"] if derived else None,
            "missingLeadTimeSuppliers": (
                derived["missingLeadTimeSuppliers"] if derived else []
            ),
            "lines": derived["lines"] if derived else [],
        }

    @property
    def job_number(self) -> str:
        year = self.created_at.year if self.created_at else datetime.now(timezone.utc).year
        return f"JO-{year}-{(self.id or '')[:4].upper()}"

    def to_dict(self, include_operations=False, viewer_role=None):
        from app.models.operation import OperationStatus
        from app.models.user import UserRole

        ops = list(self.operations or [])
        completed = sum(1 for op in ops if op.status == OperationStatus.COMPLETED)
        next_op = next(
            (op for op in ops if op.status != OperationStatus.COMPLETED),
            None,
        )

        def _num(v):
            if v is None:
                return None
            return float(v) if isinstance(v, Decimal) else float(v)

        role = viewer_role.value if isinstance(viewer_role, UserRole) else viewer_role
        hide_commercial = role == UserRole.PRODUCTION_WORKER.value

        data = {
            "id": self.id,
            "jobNumber": self.job_number,
            "clientName": self.client.name if self.client else None,
            "title": self.title,
            "description": self.description,
            "dueDate": self.due_date.isoformat() if self.due_date else None,
            "clientPoNumber": self.client_po_number,
            "status": self.status.value,
            "priority": self.priority.value if self.priority else JobPriority.MODERATE.value,
            "jobType": self.job_type.value if self.job_type else JobType.FABRICATION.value,
            "partCondition": (
                self.part_condition.value
                if self.part_condition
                else PartCondition.RAW_MATERIAL.value
            ),
            "quantity": _num(self.quantity),
            "unitOfMeasure": self.unit_of_measure,
            "rawMaterials": self.raw_materials or [],
            "materialStatus": (
                self.material_status.value
                if self.material_status
                else MaterialStatus.TO_ORDER.value
            ),
            "materialExpectedDate": (
                self.material_expected_date.isoformat()
                if self.material_expected_date
                else None
            ),
            "materialReceivedDate": (
                self.material_received_date.isoformat()
                if self.material_received_date
                else None
            ),
            "supplierId": self.supplier_id,
            "supplierName": self.supplier.name if self.supplier else None,
            "supplierReference": self.supplier_reference,
            "scheduleColor": self.schedule_color,
            "deliveredAt": self.delivered_at.isoformat() if self.delivered_at else None,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
            "opsCompleted": completed,
            "opsTotal": len(ops),
            "nextOperation": next_op.operation_name if next_op else None,
            "nextOperationWorkerId": next_op.assigned_worker_id if next_op else None,
            "nextOperationWorkerName": (
                next_op.assigned_worker.full_name
                if next_op and next_op.assigned_worker
                else None
            ),
        }
        if self.status == JobOrderStatus.DRAFT:
            data["draftStage"] = draft_stage_label(self)
        if not hide_commercial:
            data["clientId"] = self.client_id
            data["poDate"] = self.po_date.isoformat() if self.po_date else None
            data["createdById"] = self.created_by_id
            data["createdByName"] = self.created_by.full_name if self.created_by else None
            data["amount"] = _num(self.amount)
        if include_operations:
            data["operations"] = self._serialize_operations(ops)
            if not hide_commercial:
                inv = self.sales_invoice
                data["salesInvoice"] = inv.to_dict() if inv else None
                data["materialReadiness"] = self._material_readiness()
                data["plannedMaterials"] = self.planned_materials_summary()
        scheduled_ends = [op.scheduled_end for op in ops if op.scheduled_end]
        if scheduled_ends:
            from app.services.schedule_service import compute_schedule_flag

            projected = max(scheduled_ends)
            data["projectedCompletion"] = projected.isoformat()
            data["scheduleFlag"] = compute_schedule_flag(projected, self.due_date)
        else:
            data["projectedCompletion"] = None
            data["scheduleFlag"] = None
        return data
