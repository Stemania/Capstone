"""054 size matcher: 14\" must not collide with 4\"/115 mm; only stated aliases match."""

import importlib.util
from pathlib import Path

import pytest

path = Path(__file__).resolve().parents[1] / "migrations" / "versions" / "054_catalog_fill.py"
spec = importlib.util.spec_from_file_location("m054_sizes", path)
m054 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m054)


@pytest.mark.parametrize(
    "a,b,expect",
    [
        ('4" (107 mm)', "115mm", True),
        ('4"', "100mm", True),
        ('14" (355 mm)', "115mm", False),
        ('14" (355 mm)', '4"', False),
        ('14" (355 mm)', "355mm", True),
        ('14"', '14 in', True),
        ("grit 80", "grit 120", False),
        ("grit 80", "Grit 80", True),
        (None, None, True),
        ('4"', None, False),
    ],
)
def test_054_sizes_match_exact_families(a, b, expect):
    assert m054._sizes_match(a, b) is expect
