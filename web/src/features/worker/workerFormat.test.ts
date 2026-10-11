import { describe, expect, it } from 'vitest';
import type { MyWorkFigures, WorkerSchedule } from '../../types';
import { formatHm, greeting, summarizeSchedule, weekInWords } from './workerFormat';

const day = (dayOfWeek: number, startTime: string | null, endTime: string | null): WorkerSchedule => ({
  dayOfWeek,
  startTime,
  endTime,
  isWorking: Boolean(startTime),
});

const week = (finishedOperations: number, loggedHours: number | null = null): MyWorkFigures => ({
  from: '',
  to: '',
  finishedOperations,
  redoOperations: 0,
  hoursWorked: null,
  targetHours: null,
  laborEfficiencyPct: null,
  loggedHours,
});

describe('worker formatting', () => {
  it('formats shop times', () => {
    expect(formatHm('08:00')).toBe('8:00 AM');
    expect(formatHm('12:30')).toBe('12:30 PM');
    expect(formatHm('17:05')).toBe('5:05 PM');
    expect(greeting(7)).toBe('Good morning');
    expect(greeting(13)).toBe('Good afternoon');
    expect(greeting(19)).toBe('Good evening');
  });

  it('groups days with the same hours', () => {
    const schedules = [
      ...[0, 1, 2, 3, 4].map((d) => day(d, '08:00', '17:00')),
      day(5, '08:00', '12:00'),
      day(6, null, null),
    ];
    expect(summarizeSchedule(schedules)).toEqual([
      'Mon–Fri 8:00 AM – 5:00 PM',
      'Sat 8:00 AM – 12:00 PM',
      'Sun Off',
    ]);
    expect(summarizeSchedule([])).toEqual([]);
  });

  it('describes the week in plain words', () => {
    const up = weekInWords(week(5, 12.5), week(3));
    expect(up.finished).toBe('5 operations finished this week');
    expect(up.change).toEqual({ text: '2 more than this time last week', up: true });
    expect(up.hours).toBe('12.5 hours on operations this week');
    expect(weekInWords(week(1, 1), week(4)).change?.text).toBe('3 fewer than this time last week');
    expect(weekInWords(week(1, 1), week(4)).hours).toBe('1 hour on operations this week');
    expect(weekInWords(week(0), week(0)).change).toBeNull();
  });
});
