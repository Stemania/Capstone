import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

export const SHOP_TZ = 'Asia/Manila';

dayjs.tz.setDefault(SHOP_TZ);

const WALL = 'YYYY-MM-DD HH:mm:ss';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

type DateInput = string | number | Date | dayjs.Dayjs | null | undefined;

/**
 * Any timestamp → dayjs in shop time. Plain calendar dates ("2026-10-05")
 * have no time zone and are kept as-is so they never shift a day.
 */
export function toShopDayjs(value: DateInput): dayjs.Dayjs {
  if (typeof value === 'string' && DATE_ONLY.test(value)) return dayjs(value);
  return dayjs(value ?? undefined).tz(SHOP_TZ);
}

/** Current moment in shop time. */
export function shopNow(): dayjs.Dayjs {
  return dayjs().tz(SHOP_TZ);
}

/** Today's shop calendar date as a plain (zone-less) dayjs, for date pickers. */
export function shopToday(): dayjs.Dayjs {
  return dayjs(shopNow().format('YYYY-MM-DD'));
}

/** Format any timestamp in shop time with a dayjs format string. */
export function formatShop(value: DateInput, format: string, empty = '—'): string {
  if (value == null || value === '') return empty;
  const d = toShopDayjs(value);
  return d.isValid() ? d.format(format) : empty;
}

/** Format an ISO UTC timestamp for display in shop local time. */
export function formatShopDateTime(iso: string | null | undefined): string {
  return formatShop(iso, 'MMM D, YYYY HH:mm');
}

export function formatShopDate(iso: string | null | undefined): string {
  return formatShop(iso, 'MMM D, YYYY');
}

export function formatShopTime(iso: string | null | undefined): string {
  return formatShop(iso, 'HH:mm');
}

/**
 * Parse shop-local datetime from Ant DatePicker to ISO UTC.
 * Ant Design DatePicker does not handle timezone-aware dayjs well — treat the
 * picker's wall-clock fields as Asia/Manila, then convert to UTC.
 */
export function shopLocalToIso(localValue: dayjs.Dayjs | null): string | null {
  if (!localValue || !localValue.isValid()) return null;
  return dayjs.tz(localValue.format(WALL), WALL, SHOP_TZ).utc().format();
}

/**
 * UTC ISO → naive dayjs carrying shop wall-clock (for Ant DatePicker `value`).
 * Returning a tz-aware dayjs breaks controlled updates (OK appears to do nothing).
 */
export function isoToShopDayjs(iso: string | null | undefined): dayjs.Dayjs | null {
  if (!iso) return null;
  const shop = dayjs(iso).tz(SHOP_TZ);
  if (!shop.isValid()) return null;
  return dayjs(shop.format(WALL), WALL);
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
  RED: { label: 'Late', color: '#7A1528', bg: '#F9F0F2', border: '#D4A0A8' },
};
