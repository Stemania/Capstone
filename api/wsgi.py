# Load the idna codec once in the main thread, before gunicorn's request threads
# start; a first lookup from several threads at once can fail with
# "LookupError: unknown encoding: idna".
import encodings.idna  # noqa: F401

import os

from app import create_app
from app.services.overdue_delivery_service import start_background_checks

app = create_app()

# Under the debug reloader only the serving child (WERKZEUG_RUN_MAIN) runs checks.
if __name__ != "__main__" or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
    start_background_checks(app)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
