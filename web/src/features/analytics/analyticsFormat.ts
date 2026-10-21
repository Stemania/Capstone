/** Small formatting helpers — keep out of analyticsPeriod so job-detail does not pull charts. */

/** Plain percent with no leading +. Use for rates like on-time or machine usage. */
export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

/**
 * One phrase for a finished operation: "0.9 h over target (5%)", "on target",
 * or "1.2 h under target". Hours above target are slower. Efficiency above
 * 100% is the same fact as under target.
 */
export function formatDifferenceFromTarget(
  hours?: number | null,
  pct?: number | null,
  digits = 1
): string {
  const hoursKnown = hours != null && !Number.isNaN(hours);
  const pctKnown = pct != null && !Number.isNaN(pct);
  if (!hoursKnown && !pctKnown) return '—';
  const hoursZero = !hoursKnown || Math.abs(hours) < 0.05;
  const pctZero = !pctKnown || Math.abs(pct) < 0.05;
  if (hoursZero && pctZero) return 'on target';
  const over = !hoursZero ? hours! > 0 : pct! > 0;
  const dir = over ? 'over target' : 'under target';
  if (!hoursZero) {
    const text = `${Math.abs(hours!).toFixed(digits)} h ${dir}`;
    return pctZero ? text : `${text} (${Math.abs(pct!).toFixed(digits)}%)`;
  }
  return `${Math.abs(pct!).toFixed(digits)}% ${dir}`;
}

/** Percent-only difference from target. Negative variance is faster than target. */
export function formatPctVsTarget(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (Math.abs(value) < 0.05) return 'on target';
  return value > 0
    ? `${value.toFixed(digits)}% over target`
    : `${Math.abs(value).toFixed(digits)}% under target`;
}

export function formatNum(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

export function formatHours(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)} h`;
}

export function formatInt(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return String(Math.round(value));
}

export function formatMoney(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
