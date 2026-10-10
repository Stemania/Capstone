"""Scheduling constants — single source for horizon and defaults."""

from decimal import Decimal

# How far ahead earliest-fit search runs from the anchor time.
SCHEDULE_HORIZON_DAYS = 60

# Used when an operation has no estimated_hours; surfaced as a default, not an estimate.
DEFAULT_ESTIMATED_HOURS = Decimal("1.0")

# IANA zone for Brothers Machine Shop (UTC+8).
SHOP_TIMEZONE = "Asia/Manila"

# Postgres advisory lock held while a schedule is checked and saved, so two
# confirmations (or re-plans) never pass the clash check at the same time.
SCHEDULE_LOCK_KEY = 7340001
