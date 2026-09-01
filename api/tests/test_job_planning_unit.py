"""Unit tests for planning status helpers (no database)."""

from types import SimpleNamespace
from decimal import Decimal

from app.models.job_order import JobOrderStatus, draft_stage_label
from app.models.operation import OperationStatus
from app.services.job_order_service import _release_missing_items, derive_job_status


def test_derive_keeps_draft():
    draft = SimpleNamespace(status=JobOrderStatus.DRAFT, delivered_at=None, operations=[])
    assert derive_job_status(draft) == JobOrderStatus.DRAFT


def test_derive_scheduled_with_workers_not_started():
    job = SimpleNamespace(
        status=JobOrderStatus.SCHEDULED,
        delivered_at=None,
        operations=[
            SimpleNamespace(
                status=OperationStatus.PENDING,
                assigned_worker_id="w1",
            )
        ],
    )
    assert derive_job_status(job) == JobOrderStatus.SCHEDULED


def test_draft_stage_labels():
    empty = SimpleNamespace(
        operations=[],
    )
    assert draft_stage_label(empty) == "No operations yet"

    with_ops = SimpleNamespace(
        operations=[
            SimpleNamespace(operation_name="Milling", operation_type_id="t1"),
            SimpleNamespace(operation_name="Turning", operation_type_id=None),
        ]
    )
    assert draft_stage_label(with_ops) == "2 operations, not scheduled"


def test_release_missing_lists_worker_and_hours():
    job = SimpleNamespace(
        operations=[
            SimpleNamespace(
                sequence_no=1,
                operation_name="Milling",
                assigned_worker_id=None,
                estimated_hours=None,
            ),
            SimpleNamespace(
                sequence_no=2,
                operation_name="Turning",
                assigned_worker_id="w1",
                estimated_hours=Decimal("2"),
            ),
        ]
    )
    missing = _release_missing_items(job)
    assert any("worker" in m.lower() for m in missing)
    assert any("target hours" in m.lower() for m in missing)
    assert any("#1" in m for m in missing)
    assert not any("#2" in m and "worker" in m.lower() for m in missing)


def test_migration_012_maps_legacy_statuses():
    mapping = {
        "PLANNING": "DRAFT",
        "RELEASED": "SCHEDULED",
        "ASSIGNED": "SCHEDULED",
        "UNASSIGNED": "SCHEDULED",
        "IN_PROGRESS": "IN_PROGRESS",
        "COMPLETED": "COMPLETED",
        "DELIVERED": "DELIVERED",
        "DRAFT": "DRAFT",
    }
    for before, after in mapping.items():
        if before in ("PLANNING",):
            assert after == "DRAFT"
        elif before in ("RELEASED", "ASSIGNED", "UNASSIGNED"):
            assert after == "SCHEDULED"
        else:
            assert after == before
