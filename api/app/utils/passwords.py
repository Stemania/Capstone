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

_OBVIOUS_PINS = {
    "000000",
    "111111",
    "222222",
    "333333",
    "444444",
    "555555",
    "666666",
    "777777",
    "888888",
    "999999",
    "123456",
    "654321",
    "012345",
    "543210",
    "112233",
    "121212",
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


def validate_pin(pin: str) -> None:
    if not pin or not re.fullmatch(r"\d{6}", pin):
        raise AppError("PIN must be exactly 6 digits", "VALIDATION_ERROR", 400)
    if pin in _OBVIOUS_PINS or len(set(pin)) == 1:
        raise AppError("Choose a less obvious PIN", "VALIDATION_ERROR", 400)
    if pin in "0123456789" or pin in "9876543210":
        raise AppError("Choose a less obvious PIN", "VALIDATION_ERROR", 400)
