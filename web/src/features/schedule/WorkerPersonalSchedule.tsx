import { OPERATION_BAR_COLOR } from '../../theme/statuses';
import { useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import { CoffeeOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { scheduleApi, type ScheduleBoardOperation, type ShopDayWindow } from '../../api/schedule.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { WorkerPageHeader } from '../../layouts/WorkerLayout';
import { PageSkeleton, StatusPill } from '../../components/ui';
import { SHOP_TZ } from '../../utils/shopTime';
import { opStatusPill, opTitle } from '../my-assignments/opStatus';
import { formatRange } from '../worker/workerFormat';
import type { Operation } from '../../types';
import { parseHm } from './scheduleTimelineUtils';

const DEFAULT_BREAK = { start: '12:00', end: '13:00' };

type Slot =
  | {
      kind: 'op';
      key: string;
      start: dayjs.Dayjs;
      end: dayjs.Dayjs;
      op: ScheduleBoardOperation;
      continued: boolean;
    }
  | { kind: 'lunch'; key: string; start: dayjs.Dayjs; end: dayjs.Dayjs };

function mondayOf(d: dayjs.Dayjs) {
  return d.startOf('day').subtract((d.day() + 6) % 7, 'day');
}

function dayWindow(windows: ShopDayWindow[], key: string) {
  const w = windows.find((d) => d.date === key);
  if (w?.isWorking && w.startTime && w.endTime && parseHm(w.endTime) > parseHm(w.startTime)) {
    return { working: true, start: w.startTime, end: w.endTime };
  }
  if (w) return { working: false, start: null, end: null };
  return { working: dayjs.tz(key, SHOP_TZ).day() !== 0, start: null, end: null };
}

/** Each op's planned pieces on this day, in time order, with the lunch break between them. */
function slotsForDay(
  ops: ScheduleBoardOperation[],
  key: string,
  brk: { start: string; end: string },
  window: { start: string | null; end: string | null }
): Slot[] {
  const pieces: Slot[] = [];
  for (const op of ops) {
    const segs = op.segments?.length
      ? op.segments
      : op.scheduledStart && op.scheduledEnd
        ? [{ start: op.scheduledStart, end: op.scheduledEnd }]
        : [];
    let earlierPiece = false;
    segs
      .map((s) => ({ start: dayjs(s.start).tz(SHOP_TZ), end: dayjs(s.end).tz(SHOP_TZ) }))
      .sort((a, b) => a.start.valueOf() - b.start.valueOf())
      .forEach((s, i) => {
        if (!s.end.isAfter(s.start)) return;
        const onDay = s.start.format('YYYY-MM-DD') === key;
        if (onDay) {
          pieces.push({
            kind: 'op',
            key: `${op.id}-${i}`,
            start: s.start,
            end: s.end,
            op,
            continued: earlierPiece,
          });
        }
        earlierPiece = true;
      });
  }
  if (!pieces.length) return [];

  const day = dayjs.tz(key, SHOP_TZ).startOf('day');
  const lunchStart = day.add(parseHm(brk.start), 'minute');
  const lunchEnd = day.add(parseHm(brk.end), 'minute');
  const inWindow =
    !window.start ||
    !window.end ||
    (parseHm(brk.start) >= parseHm(window.start) && parseHm(brk.end) <= parseHm(window.end));
  if (inWindow) pieces.push({ kind: 'lunch', key: `lunch-${key}`, start: lunchStart, end: lunchEnd });
  return pieces.sort((a, b) => a.start.valueOf() - b.start.valueOf() || (a.kind === 'lunch' ? -1 : 1));
}

export default function WorkerPersonalSchedule() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const today = dayjs().tz(SHOP_TZ);
  const todayKey = today.format('YYYY-MM-DD');
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [selected, setSelected] = useState(todayKey);
  const [ops, setOps] = useState<ScheduleBoardOperation[]>([]);
  const [windows, setWindows] = useState<ShopDayWindow[]>([]);
  const [brk, setBrk] = useState(DEFAULT_BREAK);
  const [loading, setLoading] = useState(true);
  const dayRefs = useRef<Record<string, HTMLElement | null>>({});
  const pendingScroll = useRef<string | null>(todayKey);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => weekStart.add(i, 'day').format('YYYY-MM-DD')),
    [weekStart]
  );

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setLoading(true);
    scheduleApi
      .board({
        from: days[0],
        to: days[6],
        workerId: user.id,
        includeCompleted: true,
      })
      .then(({ data }) => {
        if (cancelled) return;
        setOps(data.operations || []);
        setWindows(data.workerDayWindows?.length ? data.workerDayWindows : data.shopDayWindows || []);
        if (data.shopBreak) setBrk(data.shopBreak);
      })
      .catch((err) => !cancelled && message.error(getErrorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [days, user?.id]);

  const agenda = useMemo(
    () =>
      days.map((key) => {
        const w = dayWindow(windows, key);
        return { key, ...w, slots: slotsForDay(ops, key, brk, w) };
      }),
    [days, windows, ops, brk]
  );

  // Bring the chosen day into view once its section exists.
  useEffect(() => {
    const key = pendingScroll.current;
    if (loading || !key) return;
    pendingScroll.current = null;
    if (key === days[0]) return;
    const el = dayRefs.current[key];
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [loading, days]);

  // The strip follows the day at the top of the screen while scrolling.
  useEffect(() => {
    if (loading) return;
    const root = document.querySelector('.w-main');
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const key = top?.target.getAttribute('data-day');
        if (key) setSelected(key);
      },
      { root, rootMargin: '-170px 0px -55% 0px' }
    );
    for (const key of days) {
      const el = dayRefs.current[key];
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [loading, days]);

  const choose = (key: string) => {
    setSelected(key);
    const el = dayRefs.current[key];
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const shiftWeek = (dir: -1 | 1) => {
    const next = weekStart.add(dir * 7, 'day');
    setWeekStart(next);
    const key = next.format('YYYY-MM-DD');
    setSelected(key);
    pendingScroll.current = null;
    const scroller = document.querySelector('.w-main');
    if (scroller) scroller.scrollTo({ top: 0 });
  };

  const goToday = () => {
    if (!weekStart.isSame(mondayOf(today), 'day')) {
      setWeekStart(mondayOf(today));
      pendingScroll.current = todayKey;
      setSelected(todayKey);
    } else {
      choose(todayKey);
    }
  };

  const opCount = new Set(
    agenda.flatMap((d) => d.slots.flatMap((s) => (s.kind === 'op' ? [s.op.id] : [])))
  ).size;
  const isThisWeek = weekStart.isSame(mondayOf(today), 'day');

  return (
    <div>
      <WorkerPageHeader
        title="Schedule"
        subtitle={`${weekStart.format('MMM D')} – ${weekStart.add(6, 'day').format('MMM D')}`}
      />

      <div className="w-sched-strip">
        <div className="w-week" role="tablist" aria-label="Days of the week">
          <button type="button" className="w-week__arrow" onClick={() => shiftWeek(-1)} aria-label="Previous week">
            <LeftOutlined />
          </button>
          {agenda.map((d) => {
            const date = dayjs.tz(d.key, SHOP_TZ);
            const cls = [
              'w-week__day',
              d.slots.some((s) => s.kind === 'op') ? 'has-work' : '',
              d.working ? '' : 'is-off',
              d.key === todayKey ? 'is-today' : '',
              d.key === selected ? 'is-selected' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <button
                key={d.key}
                type="button"
                role="tab"
                aria-selected={d.key === selected}
                className={cls}
                onClick={() => choose(d.key)}
              >
                <span className="w-week__dow">{date.format('dd').charAt(0)}</span>
                <span className="w-week__num">{date.format('D')}</span>
                <span className="w-week__dot" />
              </button>
            );
          })}
          <button type="button" className="w-week__arrow" onClick={() => shiftWeek(1)} aria-label="Next week">
            <RightOutlined />
          </button>
        </div>
        <div className="w-week__foot">
          <span>
            {loading ? 'Loading…' : opCount ? `${opCount} ${opCount === 1 ? 'operation' : 'operations'} this week` : 'Nothing planned this week'}
          </span>
          {(!isThisWeek || selected !== todayKey) && (
            <button type="button" className="w-link" onClick={goToday}>
              Today
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <PageSkeleton variant="list" />
      ) : (
        <div className="w-page">
          {agenda.map((d) => {
            const date = dayjs.tz(d.key, SHOP_TZ);
            const isToday = d.key === todayKey;
            const hasOps = d.slots.some((s) => s.kind === 'op');
            return (
              <section
                key={d.key}
                className="w-day"
                data-day={d.key}
                ref={(el) => {
                  dayRefs.current[d.key] = el;
                }}
              >
                <div className="w-day__head">
                  <span className={`w-day__date${isToday ? ' is-today' : ''}`}>
                    {isToday ? 'Today · ' : ''}
                    {date.format('ddd, MMM D')}
                  </span>
                  <span className="w-day__hours">
                    {d.working ? formatRange(d.start, d.end) || 'Working day' : 'Day off'}
                  </span>
                </div>
                <div className="w-card w-card--flush">
                  {!hasOps ? (
                    <div className="w-dayoff">{d.working ? 'Nothing planned.' : 'No work scheduled.'}</div>
                  ) : (
                    <div className="w-rows">
                      {d.slots.map((slot) =>
                        slot.kind === 'lunch' ? (
                          <div key={slot.key} className="w-lunch">
                            <div className="w-row__time">
                              {slot.start.format('h:mm A')}
                              <span>{slot.end.format('h:mm A')}</span>
                            </div>
                            <CoffeeOutlined />
                            <span>Lunch break</span>
                          </div>
                        ) : (
                          <ScheduleRow
                            key={slot.key}
                            slot={slot}
                            onOpen={() => navigate(`/my-assignments/${slot.op.jobOrderId}`)}
                          />
                        )
                      )}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScheduleRow({ slot, onOpen }: { slot: Extract<Slot, { kind: 'op' }>; onOpen: () => void }) {
  const { op } = slot;
  const pill = opStatusPill(op as unknown as Operation);
  const color = op.waitingForMaterials ? 'var(--tone-amber-solid)' : OPERATION_BAR_COLOR[op.status] || '#94a3b8';
  return (
    <button type="button" className="w-row w-slot" onClick={onOpen}>
      <div className="w-row__time">
        {slot.start.format('h:mm A')}
        <span>{slot.end.format('h:mm A')}</span>
      </div>
      <span className="w-slot__bar" style={{ background: color }} aria-hidden />
      <div className="w-slot__main">
        <div className="w-row__title">
          {opTitle(op)}
          {slot.continued ? <span className="w-muted" style={{ fontWeight: 500 }}> · continued</span> : null}
        </div>
        <div className="w-row__sub">
          {[op.jobNumber, op.clientName, op.machineUnitLabel || op.machineTypeName].filter(Boolean).join(' · ')}
        </div>
        {pill.label !== 'Scheduled' && (
          <div className="w-slot__pills">
            <StatusPill tone={pill.tone} compact>
              {pill.label}
            </StatusPill>
          </div>
        )}
      </div>
    </button>
  );
}
