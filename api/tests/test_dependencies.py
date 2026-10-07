"""The models configure, and the tests run on the exact versions Render installs."""

import subprocess
import sys
from importlib import metadata
from pathlib import Path

import pytest
from packaging.requirements import Requirement

API_DIR = Path(__file__).resolve().parents[1]


def test_models_configure_in_a_fresh_process():
    # A fresh interpreter, so configuration really runs here rather than being
    # already done by earlier tests. Relationship errors otherwise surface only
    # on the first request in production.
    script = (
        "import app.models\n"
        "from sqlalchemy.orm import configure_mappers\n"
        "configure_mappers()\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=API_DIR,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr[-3000:]


def test_create_app_configures_every_model_before_serving():
    script = (
        "from app import create_app\n"
        "from app.extensions import db\n"
        "create_app()\n"
        "pending = [m.class_.__name__ for m in db.Model.registry.mappers if not m.configured]\n"
        "assert not pending, pending\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=API_DIR,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr[-3000:]


def test_models_configure_in_this_process():
    from sqlalchemy.orm import configure_mappers

    import app.models  # noqa: F401

    configure_mappers()


def _pins():
    for line in (API_DIR / "requirements.txt").read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            yield Requirement(line)


def test_every_requirement_is_pinned_exactly():
    loose = [str(r) for r in _pins() if len(r.specifier) != 1 or next(iter(r.specifier)).operator != "=="]
    assert loose == []


@pytest.mark.parametrize("req", list(_pins()), ids=lambda r: r.name)
def test_installed_version_matches_requirements(req):
    if req.marker and not req.marker.evaluate():
        pytest.skip(f"{req.name} is not used on this platform")
    pinned = next(iter(req.specifier)).version
    assert metadata.version(req.name) == pinned, (
        f"{req.name} {metadata.version(req.name)} is installed but requirements.txt pins {pinned}; "
        "run pip install -r requirements.txt"
    )
