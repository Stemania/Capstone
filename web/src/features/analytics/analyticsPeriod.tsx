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

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatNum(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

export function formatInt(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return String(Math.round(value));
}
