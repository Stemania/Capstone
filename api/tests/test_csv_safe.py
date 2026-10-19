"""CSV formula injection escaping (H-04)."""

from app.utils.csv_safe import escape_csv_cell, rows_to_csv


def test_escape_formula_prefixes():
    assert escape_csv_cell("=1+1") == "'=1+1"
    assert escape_csv_cell("+cmd") == "'+cmd"
    assert escape_csv_cell("-1") == "'-1"
    assert escape_csv_cell("@SUM(A1)") == "'@SUM(A1)"
    assert escape_csv_cell("\tTAB") == "'\tTAB"
    assert escape_csv_cell("\rCR") == "'\rCR"
    assert escape_csv_cell("safe") == "safe"
    assert escape_csv_cell(None) == ""
    assert escape_csv_cell(42) == "42"


def test_rows_to_csv_escapes_formula_cells():
    body = rows_to_csv(["note"], [["=1+1"], ["hello"]])
    lines = body.strip().split("\r\n")
    assert lines[0] == "note"
    assert lines[1] == "'=1+1"
    assert lines[2] == "hello"
