"""Outbound SMS backends, chosen by SMS_BACKEND. Only console exists for now;
a real provider (e.g. textbee) is a new SmsBackend returned by get_sms_backend.
"""

from __future__ import annotations

import logging
import re
from abc import ABC, abstractmethod

from app.services.email_backends import is_development_environment
from app.utils.errors import AppError
from app.utils.phone import normalize_ph_mobile

logger = logging.getLogger(__name__)

SMS_MAX_LENGTH = 160

_EMOJI_RE = re.compile(
    "["
    "\U0001F000-\U0001FAFF"  # emoji, pictographs, flags, symbols
    "\U0001FC00-\U0001FFFF"
    "\u2600-\u27BF"  # misc symbols, dingbats
    "\u2B00-\u2BFF"  # arrows, stars
    "\u231A\u231B\u23E9-\u23FA"
    "\uFE00-\uFE0F"  # variation selectors
    "\u200D"  # zero-width joiner
    "\u20E3"  # keycap
    "]"
)

# Typographic characters that would force the message out of the GSM alphabet
# (cutting the length limit from 160 to 70) for no visible gain.
_PLAIN = str.maketrans(
    {
        "\u2013": "-",
        "\u2014": "-",
        "\u2018": "'",
        "\u2019": "'",
        "\u201C": '"',
        "\u201D": '"',
        "\u2026": "...",
        "\u00A0": " ",
    }
)


def normalize_ph_number(raw: str | None) -> str | None:
    """+639XXXXXXXXX from 09..., 639..., +639... (spaces/dashes allowed); None if invalid."""
    try:
        return normalize_ph_mobile(raw)
    except AppError:
        return None


def sanitize_sms(text: str | None, limit: int = SMS_MAX_LENGTH) -> str:
    """Strip emoji, plain punctuation, collapse whitespace, and keep within ``limit`` chars."""
    cleaned = _EMOJI_RE.sub("", (text or "").translate(_PLAIN))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 3].rstrip() + "..."


class SmsBackend(ABC):
    name = "base"
    delivers = True

    @abstractmethod
    def send(self, to: str, text: str) -> str | None:
        """Send one SMS to a +639XXXXXXXXX number. Return the provider id; raise on failure."""


class ConsoleSmsBackend(SmsBackend):
    name = "console"
    delivers = False

    def send(self, to, text):
        shown = text if is_development_environment() else "[hidden outside development]"
        logger.info("[CONSOLE sms] to=%s body=%s", to, shown)
        print(f"[CONSOLE sms] to={to} body={shown}")
        return None


def get_sms_backend(config) -> SmsBackend:
    choice = str(config.get("SMS_BACKEND") or "console").strip().lower()
    if choice != "console":
        logger.warning("SMS_BACKEND %r is not available yet; using console", choice)
    return ConsoleSmsBackend()
