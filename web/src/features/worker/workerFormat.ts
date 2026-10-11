import type { MyWorkFigures, WorkerSchedule } from '../../types';

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "13:30" -> "1:30 PM". */
export function formatHm(hm: string | null | undefined): string {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m || 0).padStart(2, '0')} ${suffix}`;
}

export function formatRange(start?: string | null, end?: string | null): string {
  return start && end ? `${formatHm(start)} – ${formatHm(end)}` : '';
}

export function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Consecutive days with the same hours share a line: "Mon–Fri 8:00 AM – 5:00 PM", "Sun Off". */
export function summarizeSchedule(schedules: WorkerSchedule[] | undefined | null): string[] {
  if (!schedules?.length) return [];
  const byDay = new Map(schedules.map((s) => [s.dayOfWeek, s]));
  const label = (dow: number) => {
    const s = byDay.get(dow);
    if (!s || !s.isWorking || !s.startTime || !s.endTime) return 'Off';
    return formatRange(s.startTime, s.endTime);
  };
  const lines: string[] = [];
  let from = 0;
  for (let dow = 1; dow <= 7; dow += 1) {
    if (dow < 7 && label(dow) === label(from)) continue;
    const days = from === dow - 1 ? DAY_SHORT[from] : `${DAY_SHORT[from]}–${DAY_SHORT[dow - 1]}`;
    lines.push(`${days} ${label(from)}`);
    from = dow;
  }
  return lines;
}

function hoursText(h: number): string {
  const rounded = Math.round(h * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} ${rounded === 1 ? 'hour' : 'hours'}`;
}

/** The week in plain words, compared with the same days of last week. */
export function weekInWords(thisWeek: MyWorkFigures, lastWeek?: MyWorkFigures | null) {
  const done = thisWeek.finishedOperations;
  const finished = `${done} ${done === 1 ? 'operation' : 'operations'} finished this week`;
  let change: { text: string; up: boolean | null } | null = null;
  if (lastWeek) {
    const diff = done - lastWeek.finishedOperations;
    if (diff > 0) change = { text: `${diff} more than this time last week`, up: true };
    else if (diff < 0) change = { text: `${-diff} fewer than this time last week`, up: false };
    else if (done > 0) change = { text: 'same as this time last week', up: null };
  }
  const logged = thisWeek.loggedHours ?? null;
  const hours = logged == null ? null : `${hoursText(logged)} on operations this week`;
  return { finished, change, hours };
}
