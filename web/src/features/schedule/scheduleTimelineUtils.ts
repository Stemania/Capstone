import dayjs, { type Dayjs } from 'dayjs';
import { SHOP_TZ } from '../../utils/shopTime';
import { adminPx } from '../../theme/adminTheme';

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

/** Default Mon–Sat shop window used for equal week-column sizing. */
const DEFAULT_DAY_START_MIN = 8 * 60;
const DEFAULT_DAY_END_MIN = 17 * 60;

function defaultWorkingDayWidth(pph: number): number {
  return ((DEFAULT_DAY_END_MIN - DEFAULT_DAY_START_MIN) / 60) * pph;
}

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

/** Stretch day-view hours to fill the board when the viewport is wider than the natural width. */
export function fitDayPxPerHour(mobile: boolean, availBoardW: number): number {
  const natural = pxPerHour('day', mobile);
  const hours = HOUR_END - HOUR_START;
  if (availBoardW <= 0 || hours <= 0) return natural;
  return Math.max(natural, availBoardW / hours);
}

function resolveHourPx(
  mode: TimelineViewMode,
  mobile: boolean,
  hourPx?: number
): number {
  return hourPx ?? pxPerHour(mode, mobile);
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

/**
 * Week columns start at the fixed 08:00 opening so a job that starts at
 * opening sits flush on every day (the per-day union of worker hours can start
 * earlier on some weekdays and would inset bars — the Tuesday gap). A day that
 * runs past 17:00 (overtime) gets a proportionally wider column so bars are
 * not cut off at normal closing time.
 */
export function buildWeekTimelineLayout(
  from: Dayjs,
  to: Dayjs,
  windows: ShopDayWindow[],
  mobile: boolean
): WeekTimelineLayout {
  const pph = pxPerHour('week', mobile);
  const byDate = new Map(windows.map((w) => [w.date, w]));
  const count = to.diff(from, 'day') + 1;
  const colW = defaultWorkingDayWidth(pph);

  const days: WeekDayColumn[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const d = from.add(i, 'day');
    const date = d.format('YYYY-MM-DD');
    const w = byDate.get(date);
    const isWorking = w?.isWorking ?? d.day() !== 0;
    const endMinutes = isWorking
      ? Math.max(DEFAULT_DAY_END_MIN, w?.endTime ? parseHm(w.endTime) : 0)
      : 0;
    const durationHours = isWorking ? (endMinutes - DEFAULT_DAY_START_MIN) / 60 : 0;
    const width = isWorking ? durationHours * pph : colW;
    days.push({
      date,
      isWorking,
      startMinutes: isWorking ? DEFAULT_DAY_START_MIN : 0,
      endMinutes,
      durationHours,
      left: cursor,
      width,
    });
    cursor += width;
  }

  return { days, totalWidth: cursor, pph };
}

/**
 * Split a wall-clock / overnight envelope into per-day pieces clipped to each
 * day's shop window. Mon 13:00 → Tue 09:00 becomes Mon 13–17 and Tue 08–09 so
 * geometry stays inside working columns.
 */
export function splitSegmentAcrossWeekDays(
  startIso: string,
  endIso: string,
  weekLayout: WeekTimelineLayout
): { start: string; end: string }[] {
  const start = dayjs(startIso).tz(SHOP_TZ);
  const end = dayjs(endIso).tz(SHOP_TZ);
  if (!start.isValid() || !end.isValid() || !end.isAfter(start)) return [];

  const pieces: { start: string; end: string }[] = [];
  for (const day of weekLayout.days) {
    if (!day.isWorking || day.durationHours <= 0) continue;
    const dayStart = dayjs
      .tz(day.date, SHOP_TZ)
      .startOf('day')
      .add(day.startMinutes, 'minute');
    const dayEnd = dayjs
      .tz(day.date, SHOP_TZ)
      .startOf('day')
      .add(day.endMinutes, 'minute');
    if (!dayStart.isValid() || !dayEnd.isValid()) continue;
    const segStart = start.isAfter(dayStart) ? start : dayStart;
    const segEnd = end.isBefore(dayEnd) ? end : dayEnd;
    if (segEnd.isAfter(segStart)) {
      pieces.push({ start: segStart.toISOString(), end: segEnd.toISOString() });
    }
  }
  return pieces;
}

/**
 * Join overnight / next-day pieces into one visual span so the week board
 * draws a single bar (one label) across adjacent day columns. Gaps of 2+
 * calendar days (e.g. weekend / holiday) stay separate.
 */
export function mergeAdjacentWeekPieces(
  pieces: { start: string; end: string }[]
): { start: string; end: string }[] {
  if (pieces.length <= 1) return pieces;
  const sorted = [...pieces].sort(
    (a, b) => dayjs(a.start).valueOf() - dayjs(b.start).valueOf()
  );
  const merged: { start: string; end: string }[] = [];
  let cur = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const curEndDay = dayjs(cur.end).tz(SHOP_TZ).startOf('day');
    const nextStartDay = dayjs(next.start).tz(SHOP_TZ).startOf('day');
    const daysApart = nextStartDay.diff(curEndDay, 'day');
    if (daysApart <= 1) {
      const nextEnd = dayjs(next.end);
      const curEnd = dayjs(cur.end);
      cur = {
        start: cur.start,
        end: nextEnd.isAfter(curEnd) ? next.end : cur.end,
      };
    } else {
      merged.push(cur);
      cur = { ...next };
    }
  }
  merged.push(cur);
  return merged;
}

/** Stretch a week layout to fill a wider container while keeping equal columns. */
export function scaleWeekTimelineLayout(
  layout: WeekTimelineLayout,
  targetWidth: number
): WeekTimelineLayout {
  if (targetWidth <= layout.totalWidth + 0.5 || layout.totalWidth <= 0 || layout.days.length === 0) {
    return layout;
  }
  const scale = targetWidth / layout.totalWidth;
  return {
    pph: layout.pph * scale,
    totalWidth: targetWidth,
    days: layout.days.map((d) => ({
      ...d,
      left: d.left * scale,
      width: d.width * scale,
    })),
  };
}

export function timelineWidth(
  from: Dayjs,
  to: Dayjs,
  mode: TimelineViewMode,
  mobile: boolean,
  weekLayout?: WeekTimelineLayout | null,
  hourPx?: number
): number {
  if (mode === 'week' && weekLayout) {
    return weekLayout.totalWidth;
  }
  const hoursPerDay = HOUR_END - HOUR_START;
  const days = to.diff(from, 'day') + 1;
  return days * hoursPerDay * resolveHourPx(mode, mobile, hourPx);
}

export function dayWidthPx(
  mode: TimelineViewMode,
  mobile: boolean,
  hourPx?: number
): number {
  return (HOUR_END - HOUR_START) * resolveHourPx(mode, mobile, hourPx);
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
  weekLayout?: WeekTimelineLayout | null,
  hourPx?: number
): number | null {
  const t = dayjs(iso).tz(SHOP_TZ);
  if (mode === 'week' && weekLayout) {
    const day = weekDayForInstant(t, weekLayout);
    // Outside the visible week — never fall back to left:0 (that pinned
    // Sep 8/9 ops onto Mon Aug 31).
    if (!day) return null;
    if (!day.isWorking || day.durationHours <= 0) return day.left;
    const span = day.endMinutes - day.startMinutes;
    if (span <= 0) return day.left;
    const minutes = shopMinutes(t);
    const clamped = Math.min(Math.max(minutes, day.startMinutes), day.endMinutes);
    // Fraction of the day column — stays aligned after equal-column stretch.
    return day.left + ((clamped - day.startMinutes) / span) * day.width;
  }

  const dayIndex = t.startOf('day').diff(from.startOf('day'), 'day');
  if (dayIndex < 0) return null;
  const pph = resolveHourPx(mode, mobile, hourPx);
  return dayIndex * dayWidthPx(mode, mobile, hourPx) + shopHourOffset(t) * pph;
}

export function widthPx(
  startIso: string,
  endIso: string,
  from: Dayjs,
  mode: TimelineViewMode,
  mobile: boolean,
  weekLayout?: WeekTimelineLayout | null,
  hourPx?: number
): number | null {
  const start = dayjs(startIso).tz(SHOP_TZ);
  const end = dayjs(endIso).tz(SHOP_TZ);

  if (mode === 'week' && weekLayout) {
    const startDay = weekDayForInstant(start, weekLayout);
    if (!startDay) return null;
    if (!startDay.isWorking || startDay.durationHours <= 0) {
      return Math.max(startDay.width, 4);
    }

    const span = startDay.endMinutes - startDay.startMinutes;
    if (span <= 0) return Math.max(startDay.width, 4);

    // Multi-day span: continuous bar across adjacent day columns (one label).
    const left = leftPx(startIso, from, mode, mobile, weekLayout, hourPx);
    const right = leftPx(endIso, from, mode, mobile, weekLayout, hourPx);
    if (left == null || right == null) return null;
    return Math.max(right - left, 4);
  }

  const left = leftPx(startIso, from, mode, mobile, weekLayout, hourPx);
  if (left == null) return null;
  const pph = resolveHourPx(mode, mobile, hourPx);
  const dayW = dayWidthPx(mode, mobile, hourPx);

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

/**
 * Clip a segment to the visible timeline period. Returns null when there is
 * no overlap — callers must skip rendering (never place at left:0).
 */
export function clipSegmentToPeriod(
  startIso: string,
  endIso: string,
  from: Dayjs,
  to: Dayjs
): { start: string; end: string } | null {
  const start = dayjs(startIso).tz(SHOP_TZ);
  const end = dayjs(endIso).tz(SHOP_TZ);
  if (!start.isValid() || !end.isValid() || !end.isAfter(start)) return null;

  const rangeStart = from.tz(SHOP_TZ).startOf('day');
  const rangeEnd = to.tz(SHOP_TZ).endOf('day');
  if (end.isBefore(rangeStart) || !start.isBefore(rangeEnd)) return null;

  const clippedStart = start.isBefore(rangeStart) ? rangeStart : start;
  const clippedEnd = end.isAfter(rangeEnd) ? rangeEnd : end;
  if (!clippedEnd.isAfter(clippedStart)) return null;

  return { start: clippedStart.toISOString(), end: clippedEnd.toISOString() };
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
  weekLayout?: WeekTimelineLayout | null,
  hourPx?: number
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
  const pph = resolveHourPx(viewMode, mobile, hourPx);

  // Day view: one column per shop hour so the header shows clock times.
  if (viewMode === 'day') {
    const dateKey = from.format('YYYY-MM-DD');
    return Array.from({ length: hoursPerDay }, (_, i) => {
      const hour = HOUR_START + i;
      return {
        key: `${dateKey}-h${hour}`,
        left: i * pph,
        width: pph,
        label: mobile ? String(hour) : `${hour}:00`,
      };
    });
  }

  return Array.from({ length: dayCount }, (_, i) => {
    const d = from.add(i, 'day');
    return {
      key: d.format('YYYY-MM-DD'),
      left: i * hoursPerDay * pph,
      width: hoursPerDay * pph,
      label: viewMode === 'week' ? d.format('ddd D') : d.format('D'),
    };
  });
}

/**
 * Prefixed op name for bars/tooltips, e.g. "#1 Blanking".
 */
export function scheduleOpTitle(
  sequenceNo: number | null | undefined,
  operationName: string
): string {
  const name = (operationName || 'Op').trim() || 'Op';
  const n =
    sequenceNo != null && Number.isFinite(Number(sequenceNo))
      ? Number(sequenceNo)
      : null;
  if (n != null && n > 0) return `#${n} ${name}`;
  return name;
}

export type ScheduleBarLabelParts = {
  title: string;
  meta?: string;
};

/**
 * Two-line bar caption: "#N Op" on top; job number · client below.
 * Always include meta when present so partial/short bars still show both lines
 * (text ellipsizes instead of dropping the second line).
 */
export function scheduleBarLabelParts(
  operationName: string,
  jobNumber: string | null | undefined,
  clientName: string | null | undefined,
  _barWidthPx: number,
  _mobile = false,
  sequenceNo?: number | null
): ScheduleBarLabelParts | null {
  const title = scheduleOpTitle(sequenceNo, operationName);
  if (!title) return null;
  const job = jobNumber?.trim();
  const client = clientName?.trim();
  const meta = [job, client].filter(Boolean).join(' · ');
  return meta ? { title, meta } : { title };
}

/** @deprecated Prefer scheduleBarLabelParts for two-line bars. */
export function scheduleBarLabel(
  operationName: string,
  jobNumber: string | null | undefined,
  barWidthPx: number,
  mobile = false,
  sequenceNo?: number | null,
  clientName?: string | null
): string {
  const parts = scheduleBarLabelParts(
    operationName,
    jobNumber,
    clientName,
    barWidthPx,
    mobile,
    sequenceNo
  );
  if (!parts) return '';
  return parts.meta ? `${parts.title} · ${parts.meta}` : parts.title;
}

/** Shared text layout for schedule bars — stacked title + meta. */
export function scheduleBarTextStyle(opts: {
  mobile?: boolean;
  barWidthPx: number;
  columnFill?: boolean;
}): {
  display: 'flex';
  flexDirection: 'column';
  alignItems: 'flex-start';
  justifyContent: 'center';
  boxSizing: 'border-box';
  margin: number;
  fontSize: number;
  fontWeight: number;
  letterSpacing: string;
  lineHeight: number;
  padding: string;
  overflow: 'hidden';
  textAlign: 'left';
  gap: number;
} {
  const narrow = opts.barWidthPx < adminPx(64);
  const fontSize = opts.mobile
    ? narrow
      ? adminPx(11)
      : adminPx(12)
    : narrow
      ? adminPx(12)
      : adminPx(13);
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    boxSizing: 'border-box',
    margin: 0,
    fontSize,
    fontWeight: 400,
    letterSpacing: narrow ? '-0.02em' : '-0.01em',
    lineHeight: 1.15,
    padding: opts.columnFill
      ? narrow
        ? `0 ${adminPx(3)}px`
        : `0 ${adminPx(7)}px`
      : narrow
        ? `0 ${adminPx(3)}px`
        : `0 ${adminPx(6)}px`,
    overflow: 'hidden',
    textAlign: 'left',
    gap: 1,
  };
}

/** Inner stack so ellipsis works inside flex-centered bars. */
export const SCHEDULE_BAR_LABEL_SPAN_STYLE = {
  display: 'flex' as const,
  flexDirection: 'column' as const,
  justifyContent: 'center' as const,
  overflow: 'hidden' as const,
  minWidth: 0,
  width: '100%',
  gap: 1,
};

export const SCHEDULE_BAR_TITLE_STYLE = {
  overflow: 'hidden' as const,
  textOverflow: 'ellipsis' as const,
  whiteSpace: 'nowrap' as const,
  minWidth: 0,
  width: '100%',
  fontWeight: 800,
  lineHeight: 1.15,
};

export const SCHEDULE_BAR_META_STYLE = {
  overflow: 'hidden' as const,
  textOverflow: 'ellipsis' as const,
  whiteSpace: 'nowrap' as const,
  minWidth: 0,
  width: '100%',
  fontWeight: 500,
  opacity: 0.92,
  lineHeight: 1.15,
};

/**
 * Pack overlapping intervals into the fewest lanes (greedy left-edge sort).
 * Used for the shared "No machine" timeline row so concurrent worker-only
 * ops stack instead of painting on top of each other.
 */
export function assignOverlapLanes(
  items: { id: string; start: string; end: string }[]
): { laneById: Map<string, number>; laneCount: number } {
  const sorted = [...items].sort((a, b) => {
    const as = dayjs(a.start).valueOf();
    const bs = dayjs(b.start).valueOf();
    if (as !== bs) return as - bs;
    const ae = dayjs(a.end).valueOf();
    const be = dayjs(b.end).valueOf();
    if (ae !== be) return ae - be;
    return a.id.localeCompare(b.id);
  });

  const laneEnds: number[] = [];
  const laneById = new Map<string, number>();

  for (const item of sorted) {
    const start = dayjs(item.start).valueOf();
    const end = dayjs(item.end).valueOf();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      laneById.set(item.id, 0);
      if (laneEnds.length === 0) laneEnds.push(end || start);
      continue;
    }
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    laneById.set(item.id, lane);
  }

  return { laneById, laneCount: Math.max(1, laneEnds.length) };
}

