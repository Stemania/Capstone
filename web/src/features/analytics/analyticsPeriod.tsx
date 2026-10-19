import { shopToday } from '../../utils/shopTime';
import { createContext, useContext, type ReactNode } from 'react';
import { type Dayjs } from 'dayjs';

export type AnalyticsRange = [Dayjs, Dayjs];

export function defaultAnalyticsRange(): AnalyticsRange {
  const to = shopToday();
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

export {
  formatPct,
  formatDifferenceFromTarget,
  formatPctVsTarget,
  formatNum,
  formatHours,
  formatInt,
  formatMoney,
} from './analyticsFormat';
