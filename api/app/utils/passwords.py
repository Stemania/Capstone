"""Password and PIN strength checks."""

from __future__ import annotations

import re

from app.utils.errors import AppError

_WEAK_PASSWORDS = {
    "password",
    "password1",
    "password123",
    "12345678",
    "123456789",
    "qwerty123",
    "admin123",
    "letmein1",
    "welcome1",
    "changeme",
    "bmsc1234",
    "worker12",
}

# PINs are 4 digits (like a phone or ATM PIN). Repeated digits and straight
# runs are refused below; these are other common picks.
PIN_LENGTH = 4

_OBVIOUS_PINS = {
    "1212",
    "1122",
    "1313",
    "2323",
    "1010",
    "0101",
    "2000",
    "1004",
    "6969",
    "2580",
    "0852",
}


_PASSWORD_REQUIREMENTS = (
    "Password must be at least 8 characters, mix letters with numbers or "
    "symbols, and not be a common password"
)


def validate_password(password: str) -> None:
    if not password or len(password) < 8:
        raise AppError(_PASSWORD_REQUIREMENTS, "VALIDATION_ERROR", 400)
    if password.lower().strip() in _WEAK_PASSWORDS:
        raise AppError(_PASSWORD_REQUIREMENTS, "VALIDATION_ERROR", 400)
    if password.isdigit() or password.isalpha():
        raise AppError(_PASSWORD_REQUIREMENTS, "VALIDATION_ERROR", 400)


def is_pin_format(pin: str | None) -> bool:
    return bool(pin) and re.fullmatch(rf"\d{{{PIN_LENGTH}}}", pin) is not None


def validate_pin(pin: str) -> None:
    if not is_pin_format(pin):
        raise AppError(f"PIN must be exactly {PIN_LENGTH} digits", "VALIDATION_ERROR", 400)
    if pin in _OBVIOUS_PINS or len(set(pin)) == 1:
        raise AppError("Choose a less obvious PIN", "VALIDATION_ERROR", 400)
    if pin in "0123456789" or pin in "9876543210":
        raise AppError("Choose a less obvious PIN", "VALIDATION_ERROR", 400)
