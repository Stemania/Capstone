import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import { SHOP_TZ } from '../../utils/shopTime';
import {
  assignSegmentLanes,
  buildWeekTimelineLayout,
  defaultShopDayWindows,
  layoutRowBars,
  mergePiecesAround,
  type RowPosition,
} from './scheduleTimelineUtils';

const at = (date: string, hm: string) => dayjs.tz(`${date} ${hm}`, SHOP_TZ).toISOString();

// Monday 2031-06-02
const from = dayjs.tz('2031-06-02', SHOP_TZ).startOf('day');
const to = from.add(6, 'day');
const week: RowPosition = {
  from,
  to,
  mode: 'week',
  mobile: false,
  weekLayout: buildWeekTimelineLayout(from, to, defaultShopDayWindows(from, to), false),
};
const opts = { markClashes: true, gap: 2, minWidth: 16 };

describe('assignSegmentLanes', () => {
  it('keeps back-to-back work in one lane', () => {
    const { laneCount, overlapping } = assignSegmentLanes([
      { id: 'a', segments: [{ start: at('2031-06-02', '08:00'), end: at('2031-06-02', '12:00') }] },
      { id: 'b', segments: [{ start: at('2031-06-02', '12:00'), end: at('2031-06-02', '15:00') }] },
    ]);
    expect(laneCount).toBe(1);
    expect(overlapping.size).toBe(0);
  });

  it('stacks work that really overlaps and reports both', () => {
    const { laneById, laneCount, overlapping } = assignSegmentLanes([
      { id: 'a', segments: [{ start: at('2031-06-02', '08:00'), end: at('2031-06-02', '12:00') }] },
      { id: 'b', segments: [{ start: at('2031-06-02', '10:00'), end: at('2031-06-02', '15:00') }] },
    ]);
    expect(laneCount).toBe(2);
    expect(laneById.get('a')).not.toBe(laneById.get('b'));
    expect([...overlapping].sort()).toEqual(['a', 'b']);
  });

  it('lets an operation split around another share its lane', () => {
    const { laneCount, overlapping } = assignSegmentLanes([
      {
        id: 'a',
        segments: [
          { start: at('2031-06-02', '08:00'), end: at('2031-06-02', '10:00') },
          { start: at('2031-06-02', '15:00'), end: at('2031-06-02', '17:00') },
        ],
      },
      { id: 'b', segments: [{ start: at('2031-06-02', '10:00'), end: at('2031-06-02', '15:00') }] },
    ]);
    expect(laneCount).toBe(1);
    expect(overlapping.size).toBe(0);
  });
});

describe('mergePiecesAround', () => {
  const mon = { start: at('2031-06-02', '13:00'), end: at('2031-06-02', '17:00') };
  const tue = { start: at('2031-06-03', '08:00'), end: at('2031-06-03', '10:00') };

  it('joins overnight pieces into one bar', () => {
    expect(mergePiecesAround([mon, tue], [])).toEqual([{ start: mon.start, end: tue.end }]);
  });

  it('never joins across another operation', () => {
    const other = { start: at('2031-06-02', '16:00'), end: at('2031-06-02', '17:00') };
    const later = { start: at('2031-06-03', '09:00'), end: at('2031-06-03', '10:00') };
    const first = { start: at('2031-06-02', '13:00'), end: at('2031-06-02', '16:00') };
    expect(mergePiecesAround([first, later], [other])).toHaveLength(2);
  });
});

describe('layoutRowBars', () => {
  it('leaves a gap between adjacent bars', () => {
    const { bars } = layoutRowBars(
      [
        { id: 'a', segments: [{ start: at('2031-06-02', '08:00'), end: at('2031-06-02', '12:00') }] },
        { id: 'b', segments: [{ start: at('2031-06-02', '12:00'), end: at('2031-06-02', '17:00') }] },
      ],
      week,
      opts
    );
    const [a, b] = [...bars].sort((x, y) => x.left - y.left);
    expect(a.left + a.width).toBeLessThanOrEqual(b.left - 2);
  });

  it('widens a short bar but never over the next one', () => {
    const { bars } = layoutRowBars(
      [
        { id: 'short', segments: [{ start: at('2031-06-02', '08:00'), end: at('2031-06-02', '08:15') }] },
        { id: 'next', segments: [{ start: at('2031-06-02', '08:15'), end: at('2031-06-02', '12:00') }] },
        { id: 'alone', segments: [{ start: at('2031-06-04', '08:00'), end: at('2031-06-04', '08:15') }] },
      ],
      week,
      opts
    );
    const short = bars.find((b) => b.opId === 'short')!;
    const next = bars.find((b) => b.opId === 'next')!;
    const alone = bars.find((b) => b.opId === 'alone')!;
    expect(short.short).toBe(true);
    expect(short.left + short.width).toBeLessThanOrEqual(next.left - 2);
    expect(alone.width).toBe(16);
  });

  it('stacks overlapping machine work in lanes and marks the clash', () => {
    const { bars, laneCount } = layoutRowBars(
      [
        { id: 'a', segments: [{ start: at('2031-06-02', '08:00'), end: at('2031-06-02', '12:00') }] },
        { id: 'b', segments: [{ start: at('2031-06-02', '11:00'), end: at('2031-06-02', '15:00') }] },
      ],
      week,
      opts
    );
    expect(laneCount).toBe(2);
    expect(bars.every((b) => b.clash)).toBe(true);
    expect(new Set(bars.map((b) => b.lane)).size).toBe(2);
  });

  it('stacks the no-machine row without calling it a clash', () => {
    const { bars, laneCount } = layoutRowBars(
      [
        { id: 'a', segments: [{ start: at('2031-06-02', '08:00'), end: at('2031-06-02', '12:00') }] },
        { id: 'b', segments: [{ start: at('2031-06-02', '11:00'), end: at('2031-06-02', '15:00') }] },
      ],
      week,
      { ...opts, markClashes: false }
    );
    expect(laneCount).toBe(2);
    expect(bars.some((b) => b.clash)).toBe(false);
  });

  it('does not draw one bar over another operation working in between', () => {
    const { bars } = layoutRowBars(
      [
        {
          id: 'a',
          segments: [
            { start: at('2031-06-02', '13:00'), end: at('2031-06-02', '15:00') },
            { start: at('2031-06-03', '10:00'), end: at('2031-06-03', '12:00') },
          ],
        },
        {
          id: 'b',
          segments: [
            { start: at('2031-06-02', '15:00'), end: at('2031-06-02', '17:00') },
            { start: at('2031-06-03', '08:00'), end: at('2031-06-03', '10:00') },
          ],
        },
      ],
      week,
      opts
    );
    const aBars = bars.filter((b) => b.opId === 'a');
    const bBars = bars.filter((b) => b.opId === 'b');
    expect(aBars).toHaveLength(2);
    for (const x of aBars) {
      for (const y of bBars) {
        expect(x.left + x.width <= y.left || y.left + y.width <= x.left).toBe(true);
      }
    }
  });
});
