import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import { SHOP_TZ } from '../utils/shopTime';
import { periodBounds } from '../features/schedule/scheduleTimelineUtils';
import { formatPeriodLabel } from './PeriodNavigator';

const d = (iso: string) => dayjs.tz(iso, SHOP_TZ);

describe('formatPeriodLabel', () => {
  it('formats day as weekday, month day, year', () => {
    expect(formatPeriodLabel(d('2026-10-19'), 'day')).toBe('Mon, Oct 19, 2026');
  });

  it('formats week as start – end range', () => {
    expect(formatPeriodLabel(d('2026-10-19'), 'week')).toBe('Oct 19 – Oct 25, 2026');
  });

  it('formats month as month name and year', () => {
    expect(formatPeriodLabel(d('2026-10-19'), 'month')).toBe('October 2026');
  });
});

describe('periodBounds (date pick jumps to containing period)', () => {
  it('day mode is the picked calendar day', () => {
    const { from, to } = periodBounds(d('2026-10-22'), 'day');
    expect(from.format('YYYY-MM-DD')).toBe('2026-10-22');
    expect(to.format('YYYY-MM-DD')).toBe('2026-10-22');
  });

  it('week mode is Mon–Sun containing the date', () => {
    const { from, to } = periodBounds(d('2026-10-22'), 'week');
    expect(from.format('YYYY-MM-DD')).toBe('2026-10-19');
    expect(to.format('YYYY-MM-DD')).toBe('2026-10-25');
  });

  it('month mode is the calendar month', () => {
    const { from, to } = periodBounds(d('2026-10-22'), 'month');
    expect(from.format('YYYY-MM-DD')).toBe('2026-10-01');
    expect(to.format('YYYY-MM-DD')).toBe('2026-10-31');
  });
});
