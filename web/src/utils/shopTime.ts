import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export const SHOP_TZ = 'Asia/Manila';

/** Format an ISO UTC timestamp for display in shop local time. */
export function formatShopDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dayjs(iso).tz(SHOP_TZ).format('MMM D, YYYY HH:mm');
}

export function formatShopDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dayjs(iso).tz(SHOP_TZ).format('MMM D, YYYY');
}

export function formatShopTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dayjs(iso).tz(SHOP_TZ).format('HH:mm');
}

/** Parse shop-local datetime string to ISO UTC for API. */
export function shopLocalToIso(localValue: dayjs.Dayjs | null): string | null {
  if (!localValue || !localValue.isValid()) return null;
  return localValue.tz(SHOP_TZ, true).utc().format();
}

/** UTC ISO → dayjs in shop timezone (for DatePicker). */
export function isoToShopDayjs(iso: string | null | undefined): dayjs.Dayjs | null {
  if (!iso) return null;
  return dayjs(iso).tz(SHOP_TZ);
}

export function computeScheduleFlag(
  projectedCompletionIso: string | null | undefined,
  dueDate: string
): 'GREEN' | 'AMBER' | 'RED' | null {
  if (!projectedCompletionIso || !dueDate) return null;
  const completionDate = dayjs(projectedCompletionIso).tz(SHOP_TZ).format('YYYY-MM-DD');
  const due = dueDate.slice(0, 10);
  if (completionDate <= due) return 'GREEN';
  const amberLimit = dayjs(due).add(1, 'day').format('YYYY-MM-DD');
  if (completionDate <= amberLimit) return 'AMBER';
  return 'RED';
}

export const scheduleFlagStyle: Record<
  'GREEN' | 'AMBER' | 'RED',
  { label: string; color: string; bg: string; border: string }
> = {
  GREEN: { label: 'On time', color: '#15803d', bg: '#f0fdf4', border: '#86efac' },
  AMBER: { label: 'Within 1 day', color: '#b45309', bg: '#fffbeb', border: '#fcd34d' },
  RED: { label: 'Late', color: '#b91c1c', bg: '#fef2f2', border: '#fca5a5' },
};
