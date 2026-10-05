"""Disable the seeded demo accounts on a database you choose, keeping one Admin.

A demo account is any user whose email ends in @bmsc.local, or whose password
is one of the passwords published in this repository (Admin123!, Office123!,
Worker123!). Every demo account is disabled and its phone PINs revoked, except
the Admin you keep, whose password is replaced with one you type at a hidden
prompt. Accounts that are not demo accounts are not touched. All changes are
made in one transaction.

The password is never printed. The database URL is never printed either; only
its host and database name are shown so you can confirm the target.

Run from the api/ folder:

    .venv\\Scripts\\python.exe scripts\\disable_demo_accounts.py
    .venv\\Scripts\\python.exe scripts\\disable_demo_accounts.py --keep admin@bmsc.local --dry-run

You are asked for the database URL at a hidden prompt; press Enter to use
DATABASE_URL from the environment / api/.env instead.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from getpass import getpass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DEMO_DOMAIN = "@bmsc.local"
DEMO_PASSWORDS = ("Admin123!", "Office123!", "Worker123!")


def find_demo_accounts():
    from app.extensions import bcrypt
    from app.models.user import User

    found = []
    for user in User.query.order_by(User.email).all():
        email = (user.email or "").lower()
        if email.endswith(DEMO_DOMAIN):
            found.append(user)
        elif user.password_hash and any(
            bcrypt.check_password_hash(user.password_hash, p) for p in DEMO_PASSWORDS
        ):
            found.append(user)
    return found


def _revoke_devices(user_id, now):
    from app.models.user_security import UserDevice

    for device in UserDevice.query.filter(
        UserDevice.user_id == user_id, UserDevice.revoked_at.is_(None)
    ).all():
        device.revoked_at = now
        device.pin_hash = None
        device.pin_set_at = None


def disable_demo_accounts(keep_email: str, new_password: str) -> dict:
    """Disable demo accounts except ``keep_email`` (an Admin) and set its password.

    Does not commit; the caller commits or rolls back.
    """
    from sqlalchemy import func

    from app.extensions import bcrypt, db
    from app.models.user import User, UserRole, UserStatus
    from app.utils.passwords import validate_password

    keep = User.query.filter(func.lower(User.email) == keep_email.strip().lower()).first()
    if keep is None:
        raise ValueError(f"No account with email {keep_email}.")
    if keep.role != UserRole.ADMIN:
        raise ValueError(f"{keep.email} is not an Admin.")
    if new_password in DEMO_PASSWORDS:
        raise ValueError("Choose a password that is not one of the published demo passwords.")
    validate_password(new_password)

    now = datetime.now(timezone.utc)
    disabled = []
    for user in find_demo_accounts():
        if user.id == keep.id:
            continue
        if user.status != UserStatus.DISABLED:
            user.status = UserStatus.DISABLED
            user.sync_active_flag()
            disabled.append(user.email)
        _revoke_devices(user.id, now)

    keep.password_hash = bcrypt.generate_password_hash(new_password).decode("utf-8")
    keep.status = UserStatus.ACTIVE
    keep.sync_active_flag()
    _revoke_devices(keep.id, now)
    db.session.flush()
    return {"kept": keep.email, "disabled": disabled}


def _target_label(url: str) -> str:
    from sqlalchemy.engine import make_url

    parsed = make_url(url)
    return f"{parsed.host or 'localhost'}:{parsed.port or ''}/{parsed.database or ''}"


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--keep", default="admin@bmsc.local", help="Admin email to keep")
    parser.add_argument("--dry-run", action="store_true", help="List accounts; change nothing")
    args = parser.parse_args()

    entered = getpass("Database URL (hidden; Enter to use DATABASE_URL): ").strip()
    if entered:
        os.environ["DATABASE_URL"] = entered

    from app import create_app
    from app.config import Config, _normalize_database_url
    from app.extensions import db

    url = os.environ.get("DATABASE_URL") or Config.SQLALCHEMY_DATABASE_URI
    if not url:
        raise SystemExit("No database URL given.")

    class ScriptConfig(Config):
        ENV = "maintenance"
        SQLALCHEMY_DATABASE_URI = _normalize_database_url(url)
        RATELIMIT_ENABLED = False

    target = _target_label(ScriptConfig.SQLALCHEMY_DATABASE_URI)
    app = create_app(ScriptConfig)
    with app.app_context():
        demo = find_demo_accounts()
        print(f"Target database: {target}")
        print(f"Demo accounts found: {len(demo)}")
        for user in demo:
            mark = "KEEP (Admin, new password)" if user.email.lower() == args.keep.lower() else "disable"
            print(f"  {user.email:<32} {user.role.value:<18} {user.status.value:<9} -> {mark}")
        if args.dry_run:
            print("Dry run: nothing changed.")
            return

        typed = input(f"Type the database name to confirm changes to {target}: ").strip()
        if typed != target.rsplit("/", 1)[-1]:
            raise SystemExit("Not confirmed. Nothing changed.")

        password = getpass(f"New password for {args.keep} (hidden): ")
        if getpass("Repeat new password: ") != password:
            raise SystemExit("Passwords do not match. Nothing changed.")

        try:
            result = disable_demo_accounts(args.keep, password)
            db.session.commit()
        except Exception as exc:
            db.session.rollback()
            message = getattr(exc, "message", None) or str(exc)
            raise SystemExit(f"Nothing changed: {message}")

        print(f"Disabled {len(result['disabled'])} account(s).")
        print(f"Kept {result['kept']} as Admin with the new password.")
        print("Disabled accounts can no longer sign in or refresh; access tokens already issued expire within an hour.")


if __name__ == "__main__":
    main()
