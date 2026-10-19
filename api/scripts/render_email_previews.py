"""Render every email type to HTML (+ .txt) under api/.email_previews/ for browser review.

Usage (from api/):
  .venv\\Scripts\\python.exe scripts/render_email_previews.py

Does not send mail. Does not touch the live database.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import base64
import shutil

from app import create_app
from app.models.notification import NotificationMilestone
from app.services.email_templates import (
    EMAIL_LOGO_CID,
    absolute_frontend_url,
    invitation_email,
    job_update_email_content,
    password_reset_email,
    test_email,
)

OUT = ROOT / ".email_previews"
LOGO_SRC = ROOT / "app" / "assets" / "email_logo.png"


def _html_for_browser(html: str) -> str:
    """Replace cid: logo with a data URI so previews render in a browser."""
    if not LOGO_SRC.is_file():
        return html
    data = base64.b64encode(LOGO_SRC.read_bytes()).decode("ascii")
    uri = f"data:image/png;base64,{data}"
    return html.replace(f"cid:{EMAIL_LOGO_CID}", uri)


def main() -> None:
    app = create_app()
    # Preview links should look like production https even on local.
    app.config["FRONTEND_URL"] = app.config.get("FRONTEND_URL") or "https://app.example.com"
    if not str(app.config["FRONTEND_URL"]).lower().startswith("https://"):
        app.config["FRONTEND_URL"] = "https://app.example.com"

    OUT.mkdir(parents=True, exist_ok=True)
    if LOGO_SRC.is_file():
        shutil.copy2(LOGO_SRC, OUT / "bmsc-logo.png")
    written = []

    with app.app_context():
        samples = [
            (
                "invitation",
                invitation_email(
                    "Ada Lovelace",
                    absolute_frontend_url("/set-password?token=preview-token-invite"),
                ),
            ),
            (
                "password_reset",
                password_reset_email(
                    "Ada Lovelace",
                    absolute_frontend_url("/reset-password?token=preview-token-reset"),
                ),
            ),
            ("admin_test", test_email()),
        ]
        for milestone in NotificationMilestone:
            samples.append(
                (
                    milestone.value.lower(),
                    job_update_email_content(
                        milestone, "JO-2031-ABCD", "Conveyor roller assembly"
                    ),
                )
            )

        for name, content in samples:
            html_path = OUT / f"{name}.html"
            txt_path = OUT / f"{name}.txt"
            html_path.write_text(_html_for_browser(content.html), encoding="utf-8")
            txt_path.write_text(
                f"Subject: {content.subject}\n\n{content.text}", encoding="utf-8"
            )
            written.append(html_path.name)

    print(f"Wrote {len(written)} previews to {OUT}")
    for name in written:
        print(f"  {name}")


if __name__ == "__main__":
    main()
