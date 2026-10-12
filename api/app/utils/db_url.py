"""Show which database a URL points at without its user name or password."""

from __future__ import annotations


def mask_database_url(url) -> str:
    """'host/dbname' for a database URL, '(unset)' when empty.

    Never returns the user name, password or query string, even when the URL
    cannot be parsed.
    """
    if not url:
        return "(unset)"
    text = str(url)
    try:
        from sqlalchemy.engine import make_url

        parsed = make_url(text)
        if parsed.drivername.startswith("sqlite"):
            return f"sqlite/{parsed.database or ''}"
        return f"{parsed.host or 'localhost'}/{parsed.database or ''}"
    except Exception:
        return "(unreadable database URL)"
