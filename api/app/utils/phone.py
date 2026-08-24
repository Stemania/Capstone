"""Philippine mobile number normalization."""

from __future__ import annotations

import re

from app.utils.errors import AppError

_CANONICAL_RE = re.compile(r"^\+639\d{9}$")


def normalize_ph_mobile(raw: str | None, *, required: bool = False) -> str | None:
    """
    Accept 09XXXXXXXXX, 639XXXXXXXXX, +639XXXXXXXXX, and forms with spaces/dashes.
    Return +639XXXXXXXXX or None.
    """
    if raw is None:
        if required:
            raise AppError("Mobile number is required", "VALIDATION_ERROR", 400)
        return None

    text = str(raw).strip()
    if not text:
        if required:
            raise AppError("Mobile number is required", "VALIDATION_ERROR", 400)
        return None

    digits = re.sub(r"[^\d]", "", text)
    if digits.startswith("0") and len(digits) == 11 and digits[1] == "9":
        digits = "63" + digits[1:]
    if digits.startswith("9") and len(digits) == 10:
        digits = "63" + digits
    if not (digits.startswith("639") and len(digits) == 12):
        raise AppError(
            "Enter a valid Philippine mobile number (e.g. 09XX XXX XXXX)",
            "VALIDATION_ERROR",
            400,
        )

    canonical = "+" + digits
    if not _CANONICAL_RE.match(canonical):
        raise AppError(
            "Enter a valid Philippine mobile number (e.g. 09XX XXX XXXX)",
            "VALIDATION_ERROR",
            400,
        )
    return canonical


def looks_like_email(value: str) -> bool:
    return "@" in (value or "")


def looks_like_mobile(value: str) -> bool:
    if not value or looks_like_email(value):
        return False
    digits = re.sub(r"[^\d]", "", value)
    return bool(digits) and (
        digits.startswith("09")
        or digits.startswith("639")
        or (digits.startswith("9") and len(digits) == 10)
        or value.strip().startswith("+63")
    )
