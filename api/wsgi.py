# Load the idna codec once in the main thread, before gunicorn's request threads
# start; a first lookup from several threads at once can fail with
# "LookupError: unknown encoding: idna".
import encodings.idna  # noqa: F401

import os
import sys

from app import create_app
from app.services.overdue_delivery_service import start_background_checks

app = create_app()


def _is_cli_command() -> bool:
    """`flask <command>` (other than `flask run`) must not start the checks:
    they can move job dates, and commands such as load-reference-data
    promise not to touch job data."""
    launcher = sys.argv[0].replace("\\", "/").lower() if sys.argv else ""
    via_flask = os.path.basename(launcher).startswith("flask") or launcher.endswith(
        "flask/__main__.py"
    )
    return via_flask and (len(sys.argv) < 2 or sys.argv[1] != "run")


# Under the debug reloader only the serving child (WERKZEUG_RUN_MAIN) runs checks.
if not _is_cli_command() and (
    __name__ != "__main__" or os.environ.get("WERKZEUG_RUN_MAIN") == "true"
):
    start_background_checks(app)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
