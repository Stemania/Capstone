import dayjs, { type Dayjs } from 'dayjs';
import { SHOP_TZ } from '../../utils/shopTime';

export const TIMELINE_NAVY = '#0f1c2e';
export const TIMELINE_BORDER = '#e2e8f0';
export const HOUR_START = 6;
export const HOUR_END = 22;
export const WORKING_HOURS_NOTE = 'Hours shown are working hours only.';

export type TimelineViewMode = 'day' | 'week' | 'month';

export type ShopDayWindow = {
  date: string;
  startTime: string | null;
  endTime: string | null;
  isWorking: boolean;
};

export type WeekDayColumn = {
  date: string;
  left: number;
  width: number;
  isWorking: boolean;
  startMinutes: number;
  endMinutes: number;
  durationHours: number;
};

export type WeekTimelineLayout = {
  days: WeekDayColumn[];
  totalWidth: number;
  pph: number;
};

export const CLOSED_DAY_WIDTH_PX = 28;

export function periodBounds(anchor: Dayjs, mode: TimelineViewMode): { from: Dayjs; to: Dayjs } {
  const a = anchor.tz(SHOP_TZ);
  if (mode === 'day') {
    const d = a.startOf('day');
    return { from: d, to: d };
  }
  if (mode === 'week') {
    const dow = a.day();
    const start = a.startOf('day').subtract(dow === 0 ? 6 : dow - 1, 'day');
    return { from: start, to: start.add(6, 'day') };
  }
  const start = a.startOf('month');
  return { from: start, to: a.endOf('month').startOf('day') };
}

export function pxPerHour(mode: TimelineViewMode, mobile: boolean): number {
  if (mode === 'day') return mobile ? 40 : 56;
  if (mode === 'week') return mobile ? 12 : 18;
  return mobile ? 4 : 6;
}

export function parseHm(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function defaultShopDayWindows(from: Dayjs, to: Dayjs): ShopDayWindow[] {
  const days: ShopDayWindow[] = [];
  const count = to.diff(from, 'day') + 1;
  for (let i = 0; i < count; i++) {
    const d = from.add(i, 'day');
    const sunday = d.day() === 0;
    days.push({
      date: d.format('YYYY-MM-DD'),
      startTime: sunday ? null : '08:00',
      endTime: sunday ? null : '17:00',
      isWorking: !sunday,
    });
  }
  return days;
}

export function buildWeekTimelineLayout(
  from: Dayjs,
  to: Dayjs,
  windows: ShopDayWindow[],
  mobile: boolean
): WeekTimelineLayout {
  const pph = pxPerHour('week', mobile);
  const byDate = new Map(windows.map((w) => [w.date, w]));
  const days: WeekDayColumn[] = [];
  let cursor = 0;
  const count = to.diff(from, 'day') + 1;

  for (let i = 0; i < count; i++) {
    const d = from.add(i, 'day');
    const date = d.format('YYYY-MM-DD');
    const w = byDate.get(date);
    const isWorking = w?.isWorking ?? d.day() !== 0;
    let startMinutes = 8 * 60;
    let endMinutes = 17 * 60;
    let width = CLOSED_DAY_WIDTH_PX;
    let durationHours = 0;

    if (isWorking && w?.startTime && w?.endTime) {
      startMinutes = parseHm(w.startTime);
      endMinutes = parseHm(w.endTime);
      durationHours = Math.max((endMinutes - startMinutes) / 60, 0);
      width = durationHours * pph;
    } else if (isWorking) {
      durationHours = (endMinutes - startMinutes) / 60;
      width = durationHours * pph;
    }

    days.push({
      date,
      left: cursor,
      width,
      isWorking: isWorking && durationHours > 0,
      startMinutes,
      endMinutes,
      durationHours,
    });
    cursor += width;
  }

  return { days, totalWidth: cursor, pph };
}

export function timelineWidth(
  from: Dayjs,
  to: Dayjs,
  mode: TimelineViewMode,
  mobile: boolean,
  weekLayout?: WeekTimelineLayout | null
): number {
  if (mode === 'week' && weekLayout) {
    return weekLayout.totalWidth;
  }
  const hoursPerDay = HOUR_END - HOUR_START;
  const days = to.diff(from, 'day') + 1;
  return days * hoursPerDay * pxPerHour(mode, mobile);
}

export function dayWidthPx(mode: TimelineViewMode, mobile: boolean): number {
  return (HOUR_END - HOUR_START) * pxPerHour(mode, mobile);
}

/** Hours from HOUR_START within the shop day window, clamped to [0, HOUR_END - HOUR_START]. */
export function shopHourOffset(t: Dayjs): number {
  const hour = t.hour() + t.minute() / 60 + t.second() / 3600;
  return Math.min(HOUR_END, Math.max(HOUR_START, hour)) - HOUR_START;
}

function shopMinutes(t: Dayjs): number {
  return t.hour() * 60 + t.minute() + t.second() / 60;
}

function weekDayForInstant(t: Dayjs, layout: WeekTimelineLayout): WeekDayColumn | undefined {
  return layout.days.find((d) => d.date === t.format('YYYY-MM-DD'));
}

export function leftPx(
  iso: string,
  from: Dayjs,
  mode: TimelineViewMode,
  mobile: boolean,
  weekLayout?: WeekTimelineLayout | null
): number {
  const t = dayjs(iso).tz(SHOP_TZ);
  if (mode === 'week' && weekLayout) {
    const day = weekDayForInstant(t, weekLayout);
    if (!day || !day.isWorking) return day?.left ?? 0;
    const minutes = shopMinutes(t);
    const clamped = Math.min(Math.max(minutes, day.startMinutes), day.endMinutes);
    const offsetHours = (clamped - day.startMinutes) / 60;
    return day.left + offsetHours * weekLayout.pph;
  }

  const dayIndex = t.startOf('day').diff(from.startOf('day'), 'day');
  const pph = pxPerHour(mode, mobile);
  return dayIndex * dayWidthPx(mode, mobile) + shopHourOffset(t) * pph;
}

export function widthPx(
  startIso: string,
  endIso: string,
  from: Dayjs,
  mode: TimelineViewMode,
  mobile: boolean,
  weekLayout?: WeekTimelineLayout | null
): number {
  const start = dayjs(startIso).tz(SHOP_TZ);
  const end = dayjs(endIso).tz(SHOP_TZ);

  if (mode === 'week' && weekLayout) {
    const startDay = weekDayForInstant(start, weekLayout);
    if (!startDay || !startDay.isWorking) return 4;

    if (start.startOf('day').isSame(end.startOf('day'))) {
      const startMinutes = Math.min(
        Math.max(shopMinutes(start), startDay.startMinutes),
        startDay.endMinutes
      );
      const endMinutes = Math.min(
        Math.max(shopMinutes(end), startDay.startMinutes),
        startDay.endMinutes
      );
      const width = ((endMinutes - startMinutes) / 60) * weekLayout.pph;
      return Math.max(width, 4);
    }

    const left = leftPx(startIso, from, mode, mobile, weekLayout);
    const dayEndPx = startDay.left + startDay.width;
    return Math.max(dayEndPx - left, 4);
  }

  const left = leftPx(startIso, from, mode, mobile, weekLayout);
  const pph = pxPerHour(mode, mobile);
  const dayW = dayWidthPx(mode, mobile);

  if (start.startOf('day').isSame(end.startOf('day'))) {
    const width = (shopHourOffset(end) - shopHourOffset(start)) * pph;
    return Math.max(width, 4);
  }

  const startDayIndex = start.startOf('day').diff(from.startOf('day'), 'day');
  const dayEndPx = (startDayIndex + 1) * dayW;
  return Math.max(dayEndPx - left, 4);
}

export function weekStartFromIsoDates(isoDates: string[]): Dayjs {
  const dates = isoDates
    .map((iso) => dayjs(iso).tz(SHOP_TZ).startOf('day'))
    .filter((d) => d.isValid());
  if (!dates.length) return dayjs().tz(SHOP_TZ).startOf('week').add(1, 'day');
  return dates.reduce((a, b) => (a.isBefore(b) ? a : b));
}

export type TimelineDayColumn = {
  key: string;
  left: number;
  width: number;
  label: string;
};

export function dayColumnsForView(
  from: Dayjs,
  to: Dayjs,
  viewMode: TimelineViewMode,
  mobile: boolean,
  weekLayout?: WeekTimelineLayout | null
): TimelineDayColumn[] {
  const dayCount = to.diff(from, 'day') + 1;
  if (viewMode === 'week' && weekLayout) {
    return weekLayout.days.map((day) => ({
      key: day.date,
      left: day.left,
      width: day.width,
      label: dayjs(day.date).format('ddd D'),
    }));
  }
  const hoursPerDay = HOUR_END - HOUR_START;
  const pph = pxPerHour(viewMode, mobile);
  return Array.from({ length: dayCount }, (_, i) => {
    const d = from.add(i, 'day');
    return {
      key: d.format('YYYY-MM-DD'),
      left: i * hoursPerDay * pph,
      width: hoursPerDay * pph,
      label:
        viewMode === 'day'
          ? d.format(mobile ? 'ddd D' : 'ddd MMM D')
          : viewMode === 'week'
            ? d.format('ddd D')
            : d.format('D'),
    };
  });
}
