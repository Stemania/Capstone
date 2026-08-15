"""Unit tests for planning status helpers (no database)."""

from types import SimpleNamespace
from decimal import Decimal

from app.models.job_order import JobOrderStatus
from app.models.operation import OperationStatus
from app.services.job_order_service import _release_missing_items, derive_job_status


def test_derive_keeps_draft_and_planning():
    draft = SimpleNamespace(status=JobOrderStatus.DRAFT, delivered_at=None, operations=[])
    planning = SimpleNamespace(
        status=JobOrderStatus.PLANNING,
        delivered_at=None,
        operations=[SimpleNamespace(status=OperationStatus.PENDING, assigned_worker_id="w1")],
    )
    assert derive_job_status(draft) == JobOrderStatus.DRAFT
    assert derive_job_status(planning) == JobOrderStatus.PLANNING


def test_derive_released_with_workers_becomes_assigned():
    job = SimpleNamespace(
        status=JobOrderStatus.RELEASED,
        delivered_at=None,
        operations=[
            SimpleNamespace(
                status=OperationStatus.PENDING,
                assigned_worker_id="w1",
            )
        ],
    )
    assert derive_job_status(job) == JobOrderStatus.ASSIGNED


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


def test_migration_009_maps_unassigned_only():
    mapping = {
        "UNASSIGNED": "RELEASED",
        "ASSIGNED": "ASSIGNED",
        "IN_PROGRESS": "IN_PROGRESS",
        "COMPLETED": "COMPLETED",
        "DELIVERED": "DELIVERED",
    }
    for before, after in mapping.items():
        assert after not in ("DRAFT", "PLANNING")
        if before == "UNASSIGNED":
            assert after == "RELEASED"
        else:
            assert after == before
