"""Scheduling constants — single source for horizon and defaults."""

from decimal import Decimal

# How far ahead earliest-fit search runs from the anchor time.
SCHEDULE_HORIZON_DAYS = 60

# Used when an operation has no estimated_hours; surfaced as a default, not an estimate.
DEFAULT_ESTIMATED_HOURS = Decimal("1.0")

# IANA zone for Brothers Machine Shop (UTC+8).
SHOP_TIMEZONE = "Asia/Manila"
