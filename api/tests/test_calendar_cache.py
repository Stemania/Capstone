"""Per-request cache for worker hours and calendar exceptions: one query per
request, and never stale after a write in the same request.

Uses the bmsc_test database from conftest (schema built from the models).
"""

from datetime import date, time, timedelta

from sqlalchemy import event, text, update

from app.extensions import db
from app.models.user import User, UserRole, UserStatus
from app.models.worker_skill import CalendarExceptionType, WorkCalendarException, WorkerSchedule
from app.services.schedule_calendar import (
    clear_calendar_cache,
    load_calendar_exceptions,
    load_worker_schedule_maps,
    load_worker_schedule_maps_many,
)

DAY = date(2031, 3, 3)


def _worker(email):
    user = User(
        email=email,
        password_hash="x",
        full_name=email,
        role=UserRole.PRODUCTION_WORKER,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    db.session.flush()
    db.session.add(
        WorkerSchedule(
            worker_id=user.id,
            day_of_week=0,
            is_working=True,
            start_time=time(8, 0),
            end_time=time(17, 0),
        )
    )
    db.session.commit()
    return user


class _QueryCounter:
    def __init__(self):
        self.n = 0

    def __enter__(self):
        event.listen(db.engine, "before_cursor_execute", self._count)
        return self

    def __exit__(self, *_exc):
        event.remove(db.engine, "before_cursor_execute", self._count)

    def _count(self, *_args, **_kwargs):
        self.n += 1


def test_repeated_loads_hit_the_database_once(app):
    a_id = _worker("cache-a@example.com").id
    b_id = _worker("cache-b@example.com").id
    clear_calendar_cache()

    with _QueryCounter() as q:
        for _ in range(5):
            load_worker_schedule_maps(a_id)
            load_worker_schedule_maps_many([a_id, b_id])
    assert q.n == 1

    with _QueryCounter() as q:
        load_calendar_exceptions(DAY, DAY + timedelta(days=6))
        load_calendar_exceptions(DAY + timedelta(days=2), DAY + timedelta(days=30))
        load_calendar_exceptions(DAY - timedelta(days=10), DAY)
    assert q.n == 1


def test_unknown_worker_gets_empty_hours(app):
    clear_calendar_cache()
    assert load_worker_schedule_maps("no-such-worker") == {}
    assert load_worker_schedule_maps_many(["no-such-worker"]) == {"no-such-worker": {}}


def test_new_exception_is_seen_after_flush(app):
    clear_calendar_cache()
    assert load_calendar_exceptions(DAY, DAY) == {}

    db.session.add(WorkCalendarException(date=DAY, type=CalendarExceptionType.HOLIDAY_NO_WORK))
    db.session.flush()

    assert list(load_calendar_exceptions(DAY, DAY)) == [DAY]


def test_edited_worker_hours_are_seen_after_commit(app):
    worker = _worker("cache-edit@example.com")
    clear_calendar_cache()
    assert load_worker_schedule_maps(worker.id)[0].end_time == time(17, 0)

    row = WorkerSchedule.query.filter_by(worker_id=worker.id, day_of_week=0).one()
    row.end_time = time(15, 0)
    db.session.commit()

    assert load_worker_schedule_maps(worker.id)[0].end_time == time(15, 0)


def test_bulk_update_clears_the_cache(app):
    worker = _worker("cache-bulk@example.com")
    clear_calendar_cache()
    assert load_worker_schedule_maps(worker.id)[0].is_working is True

    db.session.execute(
        update(WorkerSchedule)
        .where(WorkerSchedule.worker_id == worker.id)
        .values(is_working=False)
        .execution_options(synchronize_session="fetch")
    )

    assert load_worker_schedule_maps(worker.id)[0].is_working is False


def test_rollback_drops_unsaved_rows(app):
    clear_calendar_cache()
    db.session.add(WorkCalendarException(date=DAY, type=CalendarExceptionType.OVERTIME))
    db.session.flush()
    assert DAY in load_calendar_exceptions(DAY, DAY)

    db.session.rollback()

    assert load_calendar_exceptions(DAY, DAY) == {}


def test_app_contexts_do_not_share_the_cache(app):
    worker = _worker("cache-ctx@example.com")
    clear_calendar_cache()
    assert load_worker_schedule_maps(worker.id)

    # Bypass the ORM so no session hook clears this context's cache.
    with db.engine.begin() as conn:
        conn.execute(
            text("DELETE FROM worker_schedules WHERE worker_id = :w"), {"w": worker.id}
        )

    assert load_worker_schedule_maps(worker.id), "same context keeps its cached copy"
    with app.app_context():
        assert load_worker_schedule_maps(worker.id) == {}
