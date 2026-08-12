import { createContext, useContext, type ReactNode } from 'react';
import dayjs, { type Dayjs } from 'dayjs';

export type AnalyticsRange = [Dayjs, Dayjs];

export function defaultAnalyticsRange(): AnalyticsRange {
  const to = dayjs();
  const from = to.subtract(8, 'week');
  return [from.startOf('day'), to.endOf('day')];
}

export function rangeToParams(range: AnalyticsRange) {
  return {
    from: range[0].format('YYYY-MM-DD'),
    to: range[1].format('YYYY-MM-DD'),
  };
}

type AnalyticsPeriodContextValue = {
  range: AnalyticsRange;
  setRange: (range: AnalyticsRange) => void;
  params: { from: string; to: string };
};

const AnalyticsPeriodContext = createContext<AnalyticsPeriodContextValue | null>(null);

export function AnalyticsPeriodProvider({
  range,
  setRange,
  children,
}: {
  range: AnalyticsRange;
  setRange: (range: AnalyticsRange) => void;
  children: ReactNode;
}) {
  const params = rangeToParams(range);
  return (
    <AnalyticsPeriodContext.Provider value={{ range, setRange, params }}>
      {children}
    </AnalyticsPeriodContext.Provider>
  );
}

export function useAnalyticsPeriod() {
  const ctx = useContext(AnalyticsPeriodContext);
  if (!ctx) {
    throw new Error('useAnalyticsPeriod must be used within AnalyticsPeriodProvider');
  }
  return ctx;
}

/** Plain percent with no leading +. Use for rates like on-time or machine usage. */
export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

/**
 * Hours over/under target, then percent. Prefer this for difference-from-target numbers.
 * Example: "2.5 hours over target · 15% over"
 */
export function formatDifferenceFromTarget(
  hours?: number | null,
  pct?: number | null,
  digits = 1
): string {
  const hPart =
    hours == null || Number.isNaN(hours)
      ? null
      : hours === 0
        ? 'On target'
        : hours > 0
          ? `${hours.toFixed(digits)} hours over target`
          : `${Math.abs(hours).toFixed(digits)} hours under target`;

  const pPart =
    pct == null || Number.isNaN(pct)
      ? null
      : pct === 0
        ? null
        : pct > 0
          ? `${pct.toFixed(digits)}% over`
          : `${Math.abs(pct).toFixed(digits)}% under`;

  if (hPart && pPart && hPart !== 'On target') return `${hPart} · ${pPart}`;
  if (hPart) return hPart;
  if (pPart) {
    // Percent-only (e.g. overview average): still say over/under, not a signed %
    if (pct == null || Number.isNaN(pct) || pct === 0) return 'On target';
    return pct > 0
      ? `${pct.toFixed(digits)}% over target`
      : `${Math.abs(pct).toFixed(digits)}% under target`;
  }
  return '—';
}

/** Shorter table cell for percent-only difference from target. */
export function formatPctVsTarget(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (value === 0) return 'On target';
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
