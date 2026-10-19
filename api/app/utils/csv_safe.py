"""CSV helpers that prevent spreadsheet formula injection."""

from __future__ import annotations

import csv
import io
from collections.abc import Iterable, Sequence

# Excel / LibreOffice treat these leading chars as formulas.
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def escape_csv_cell(value) -> str:
    """Return a string safe for CSV cells (prefix apostrophe when needed)."""
    if value is None:
        return ""
    text = value if isinstance(value, str) else str(value)
    if text and text[0] in _FORMULA_PREFIXES:
        return "'" + text
    return text


def rows_to_csv(headers: Sequence[str], rows: Iterable[Sequence]) -> str:
    """Build a CSV body with formula-safe cells and CRLF line endings."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow([escape_csv_cell(h) for h in headers])
    for row in rows:
        writer.writerow([escape_csv_cell(c) for c in row])
    return buf.getvalue()
