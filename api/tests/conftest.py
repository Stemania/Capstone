import os
import re
from pathlib import Path

import pytest
from dotenv import dotenv_values

# Runs before any app module is imported (app.config calls load_dotenv, which
# never overrides variables that are already set).
_dotenv = dotenv_values(Path(__file__).resolve().parents[1] / ".env")


def _setting(name):
    return os.environ.get(name) or _dotenv.get(name) or ""


def _database_identity(url):
    """host:port/dbname, ignoring driver, credentials and query string."""
    match = re.match(r"^[^:]+://(?:[^@/]*@)?([^/?]+)/([^?]+)", url or "")
    return f"{match.group(1).lower()}/{match.group(2)}" if match else (url or "")


_test_url = _setting("TEST_DATABASE_URL")
_dev_url = _setting("DATABASE_URL")
if not _test_url:
    pytest.exit(
        "TEST_DATABASE_URL is not set. The tests never use the development database: "
        "set TEST_DATABASE_URL (in api/.env or the environment) to a separate local "
        "database whose name contains 'test', e.g. .../bmsc_test.",
        returncode=2,
    )
if "test" not in _database_identity(_test_url).rsplit("/", 1)[-1].lower():
    pytest.exit("TEST_DATABASE_URL must name a database containing 'test' (e.g. bmsc_test).", returncode=2)
if _dev_url and _database_identity(_test_url) == _database_identity(_dev_url):
    pytest.exit("TEST_DATABASE_URL points at the same database as DATABASE_URL.", returncode=2)

# Every app built in the tests, including the ones that use the plain Config,
# connects to the test database.
os.environ["TEST_DATABASE_URL"] = _test_url
os.environ["DATABASE_URL"] = _test_url

# Pin the notification settings so a developer's real Gmail values in api/.env
# can never send mail from the test suite.
for _name, _value in {
    "NOTIFICATIONS_ENABLED": "false",
    "NOTIFY_ALLOWLIST": "",
    "EMAIL_BACKEND": "console",
    "GMAIL_CLIENT_ID": "",
    "GMAIL_CLIENT_SECRET": "",
    "GMAIL_REFRESH_TOKEN": "",
    "SMTP_HOST": "",
    "SMTP_PASSWORD": "",
}.items():
    os.environ[_name] = _value

from sqlalchemy import text  # noqa: E402

from app import create_app  # noqa: E402
from app.config import TestConfig  # noqa: E402
from app.extensions import db  # noqa: E402

_schema = {"present": False}


def _drop_leftover_enums():
    """Postgres keeps ENUM types after drop_all(). Drop them (no CASCADE) so
    the next create_all can recreate types without UniqueViolation."""
    db.session.rollback()
    db.session.execute(
        text(
            """
            DO $$
            DECLARE r RECORD;
            BEGIN
              FOR r IN
                SELECT t.typname
                FROM pg_type t
                JOIN pg_namespace n ON n.oid = t.typnamespace
                WHERE n.nspname = 'public' AND t.typtype = 'e'
              LOOP
                EXECUTE format('DROP TYPE IF EXISTS %I', r.typname);
              END LOOP;
            END $$;
            """
        )
    )
    db.session.commit()


@pytest.fixture(autouse=True)
def _test_schema():
    """Tests with their own app fixture (rolled-back sessions) need the tables;
    create them in the test database whenever the previous test dropped them."""
    if not _schema["present"]:
        with create_app(TestConfig).app_context():
            db.create_all()
        _schema["present"] = True
    yield


@pytest.fixture
def app():
    app = create_app(TestConfig)
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()
        _drop_leftover_enums()
        _schema["present"] = False


@pytest.fixture
def client(app):
    return app.test_client()
