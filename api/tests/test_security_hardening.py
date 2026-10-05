"""Security fixes: no demo quick-fill, seed refused in production, real client
address behind Render's proxy, one gunicorn worker, HSTS, demo-account script.

Uses the bmsc_test database from conftest (schema built from the models).
"""

import importlib.util
import re
from pathlib import Path

import pytest

from app import create_app
from app.config import TestConfig
from app.extensions import bcrypt, db, limiter
from app.models.user import User, UserRole, UserStatus

ROOT = Path(__file__).resolve().parents[2]
DEMO_PASSWORDS = ("Admin123!", "Office123!", "Worker123!")


class ProdConfig(TestConfig):
    ENV = "production"


class DevConfig(TestConfig):
    ENV = "development"


class ProxiedRateLimitConfig(ProdConfig):
    RATELIMIT_ENABLED = True
    AUTH_RATE_LIMIT_LOGIN = "3 per minute"
    TRUSTED_PROXY_COUNT = 1


# --- 1. Sign-in page has no quick-fill panel or demo passwords -------------

def test_web_source_has_no_quick_fill_or_demo_passwords():
    offenders = []
    for path in (ROOT / "web" / "src").rglob("*"):
        if path.suffix not in (".ts", ".tsx", ".css"):
            continue
        text = path.read_text(encoding="utf-8")
        for needle in ("Quick fill", "login-demo", "DEMO_ACCOUNTS", *DEMO_PASSWORDS):
            if needle in text:
                offenders.append(f"{path.relative_to(ROOT)}: {needle}")
    assert offenders == []


# --- 2. flask seed refuses in production -----------------------------------

@pytest.fixture
def seed_calls(monkeypatch):
    calls = []
    monkeypatch.setattr("app.seed.seed_data.seed_database", lambda: calls.append(1))
    return calls


def test_seed_refuses_in_production_and_points_to_create_admin(seed_calls):
    result = create_app(ProdConfig).test_cli_runner().invoke(args=["seed"])
    assert result.exit_code != 0
    assert "flask create-admin" in result.output
    assert seed_calls == []


def test_seed_runs_in_development(seed_calls):
    result = create_app(DevConfig).test_cli_runner().invoke(args=["seed"])
    assert result.exit_code == 0, result.output
    assert seed_calls == [1]


def test_deployment_guide_no_longer_seeds_the_live_database():
    guide = (ROOT / "DEPLOYMENT.md").read_text(encoding="utf-8")
    assert "flask create-admin" in guide
    assert not re.search(r"^flask seed\s*$", guide, re.MULTILINE)


# --- 5. Real client address behind one proxy; one gunicorn worker ----------

def test_login_limit_counts_the_real_client_behind_the_proxy():
    app = create_app(ProxiedRateLimitConfig)
    client = app.test_client()
    with app.app_context():
        limiter.reset()

    def attempt(forwarded_for):
        return client.post(
            "/api/v1/auth/login", json={}, headers={"X-Forwarded-For": forwarded_for}
        ).status_code

    assert [attempt("203.0.113.5") for _ in range(3)] == [400, 400, 400]
    assert attempt("203.0.113.5") == 429
    # A different client behind the same proxy has its own count.
    assert attempt("203.0.113.9") == 400
    # A client cannot escape by sending its own X-Forwarded-For: the proxy
    # appends the real address last, and only that hop is trusted.
    assert attempt("198.51.100.1, 203.0.113.5") == 429


def test_render_runs_one_gunicorn_worker_with_threads():
    start = re.search(r"startCommand:\s*(.+)", (ROOT / "render.yaml").read_text()).group(1)
    assert re.search(r"--workers 1\b", start)
    threads = re.search(r"--threads (\d+)", start)
    assert threads and int(threads.group(1)) > 1


# --- 4. HSTS ----------------------------------------------------------------

def test_hsts_header_in_production_only():
    prod = create_app(ProdConfig).test_client().post("/api/v1/auth/login", json={})
    assert "max-age=31536000" in prod.headers.get("Strict-Transport-Security", "")
    dev = create_app(DevConfig).test_client().post("/api/v1/auth/login", json={})
    assert "Strict-Transport-Security" not in dev.headers
    vercel = (ROOT / "web" / "vercel.json").read_text()
    assert "Strict-Transport-Security" in vercel


# --- 3. Demo-account script ---------------------------------------------------

def _load_script():
    path = ROOT / "api" / "scripts" / "disable_demo_accounts.py"
    spec = importlib.util.spec_from_file_location("disable_demo_accounts", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _user(email, role, password):
    user = User(
        email=email,
        password_hash=bcrypt.generate_password_hash(password).decode("utf-8"),
        full_name=email.split("@")[0],
        role=role,
        status=UserStatus.ACTIVE,
        active=True,
    )
    db.session.add(user)
    return user


def test_script_disables_demo_accounts_and_keeps_one_admin(app, capsys):
    script = _load_script()
    _user("admin@bmsc.local", UserRole.ADMIN, "Admin123!")
    _user("office@bmsc.local", UserRole.OFFICE_STAFF, "Office123!")
    _user("worker1@bmsc.local", UserRole.PRODUCTION_WORKER, "Worker123!")
    _user("renamed@shop.ph", UserRole.PRODUCTION_WORKER, "Worker123!")
    _user("owner@shop.ph", UserRole.ADMIN, "Real-Owner-2026")
    db.session.commit()

    new_password = "Fresh-Admin-Pass-77"
    result = script.disable_demo_accounts("admin@bmsc.local", new_password)
    db.session.commit()

    by_email = {u.email: u for u in User.query.all()}
    assert sorted(result["disabled"]) == [
        "office@bmsc.local",
        "renamed@shop.ph",
        "worker1@bmsc.local",
    ]
    for email in result["disabled"]:
        assert by_email[email].status == UserStatus.DISABLED
        assert by_email[email].active is False
    admin = by_email["admin@bmsc.local"]
    assert admin.status == UserStatus.ACTIVE
    assert bcrypt.check_password_hash(admin.password_hash, new_password)
    assert not bcrypt.check_password_hash(admin.password_hash, "Admin123!")
    assert by_email["owner@shop.ph"].status == UserStatus.ACTIVE
    assert new_password not in capsys.readouterr().out


def test_script_refuses_a_published_password_or_a_non_admin(app):
    script = _load_script()
    _user("admin@bmsc.local", UserRole.ADMIN, "Admin123!")
    _user("office@bmsc.local", UserRole.OFFICE_STAFF, "Office123!")
    db.session.commit()
    with pytest.raises(ValueError):
        script.disable_demo_accounts("admin@bmsc.local", "Worker123!")
    with pytest.raises(ValueError):
        script.disable_demo_accounts("office@bmsc.local", "Fresh-Admin-Pass-77")
