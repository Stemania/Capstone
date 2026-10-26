"""Row locks for check-then-write updates.

Two requests that read the same row, check it, and write it back can both pass
the check (two workers borrowing one tool) or overwrite each other (two scans
taking one unit of stock but only one deduction kept). Locking the row first
makes the second request wait for the first to commit, then read the new values.
The lock is released when the transaction commits or rolls back.
"""

from __future__ import annotations

from app.extensions import db


def lock_row(model, pk):
    """The row with ``pk``, locked FOR UPDATE and reloaded from the database; None if missing."""
    if pk is None:
        return None
    return (
        db.session.query(model)
        .filter(model.id == pk)
        .with_for_update(of=model)
        .populate_existing()
        .one_or_none()
    )


def lock_rows(model, pks):
    """Rows with these ids, locked in id order (a fixed order avoids deadlocks)."""
    ids = sorted({p for p in pks if p is not None})
    if not ids:
        return []
    return (
        db.session.query(model)
        .filter(model.id.in_(ids))
        .order_by(model.id)
        .with_for_update(of=model)
        .populate_existing()
        .all()
    )
