"""SMS helpers: PH number normalizer and content sanitizer."""

import pytest

from app.services.sms_backends import (
    ConsoleSmsBackend,
    SMS_MAX_LENGTH,
    get_sms_backend,
    normalize_ph_number,
    sanitize_sms,
)


@pytest.mark.parametrize(
    "raw",
    ["09171234567", "0917 123 4567", "0917-123-4567", "639171234567", "+639171234567", "+63 917 123 4567", "9171234567"],
)
def test_normalizer_accepts_common_forms(raw):
    assert normalize_ph_number(raw) == "+639171234567"


@pytest.mark.parametrize("raw", [None, "", "12345", "0817 123 4567", "+1 415 555 0100", "091712345678", "abc"])
def test_normalizer_rejects_invalid(raw):
    assert normalize_ph_number(raw) is None


def test_sanitizer_strips_emoji_and_flags():
    text = "BMSC: Job ready \U0001F389\U0001F44D\U0001F3FD \u2705 \U0001F1F5\U0001F1ED done \u2764\ufe0f"
    assert sanitize_sms(text) == "BMSC: Job ready done"


def test_sanitizer_uses_plain_punctuation_and_keeps_machining_symbols():
    out = sanitize_sms("Shaft \u00d825mm \u2013 \u201cready\u201d\u2026 it\u2019s done")
    assert out == "Shaft \u00d825mm - \"ready\"... it's done"


def test_sanitizer_collapses_whitespace():
    assert sanitize_sms("  a\n\n b\t c  ") == "a b c"


def test_sanitizer_keeps_within_160():
    long = "word " * 80
    out = sanitize_sms(long)
    assert len(out) <= SMS_MAX_LENGTH
    assert out.endswith("...")
    exact = "x" * 160
    assert sanitize_sms(exact) == exact


def test_sms_backend_is_console_only_for_now():
    assert isinstance(get_sms_backend({}), ConsoleSmsBackend)
    assert isinstance(get_sms_backend({"SMS_BACKEND": "textbee"}), ConsoleSmsBackend)
    assert ConsoleSmsBackend.delivers is False
