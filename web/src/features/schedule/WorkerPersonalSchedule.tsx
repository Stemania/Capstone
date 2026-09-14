import { useEffect, useMemo, useState } from 'react';
import { Segmented, Spin, message } from 'antd';
import { AimOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import {
  scheduleApi,
  type ScheduleBoardOperation,
  type ScheduleBoardSegment,
  type ShopDayWindow,
} from '../../api/schedule.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { WorkerPageHeader, useWorkerTheme } from '../../layouts/WorkerLayout';
import { parseHm, periodBounds, scheduleOpTitle } from './scheduleTimelineUtils';
import { SHOP_TZ } from '../../utils/shopTime';

type ViewMode = 'day' | 'week';

const STATUS_COLOR: Record<string, string> = {
  SCHEDULED: '#2563eb',
  IN_PROGRESS: '#0d9488',
  COMPLETED: '#64748b',
  REWORK: '#d97706',
  PENDING: '#94a3b8',
};

const PX_PER_MIN = 1.15;
const HOUR_GUTTER = 52;
const DEFAULT_START = 8 * 60;
const DEFAULT_END = 17 * 60;

function shopMinutesFromDayjs(t: dayjs.Dayjs): number {
  return t.hour() * 60 + t.minute() + t.second() / 60;
}

function segmentsForOp(op: ScheduleBoardOperation): ScheduleBoardSegment[] {
  if (op.segments?.length) return op.segments;
  if (op.scheduledStart && op.scheduledEnd) {
    return [{ start: op.scheduledStart, end: op.scheduledEnd }];
  }
  return [];
}

function windowForDate(
  windows: ShopDayWindow[],
  dateKey: string
): { startMin: number; endMin: number; isWorking: boolean } {
  const w = windows.find((d) => d.date === dateKey);
  if (w?.isWorking && w.startTime && w.endTime) {
    const startMin = parseHm(w.startTime);
    const endMin = parseHm(w.endTime);
    if (endMin > startMin) return { startMin, endMin, isWorking: true };
  }
  if (w && !w.isWorking) {
    return { startMin: DEFAULT_START, endMin: DEFAULT_END, isWorking: false };
  }
  const dow = dayjs.tz(dateKey, SHOP_TZ).day();
  return {
    startMin: DEFAULT_START,
    endMin: DEFAULT_END,
    isWorking: dow !== 0,
  };
}

function hourLabels(startMin: number, endMin: number): number[] {
  const startH = Math.floor(startMin / 60);
  const endH = Math.ceil(endMin / 60);
  const out: number[] = [];
  for (let h = startH; h <= endH; h += 1) out.push(h);
  return out;
}

function formatHour(h: number): string {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${ampm}`;
}

type Block = {
  key: string;
  op: ScheduleBoardOperation;
  top: number;
  height: number;
  labelMain: string;
  labelSub: string;
};

function blocksForDay(
  ops: ScheduleBoardOperation[],
  dateKey: string,
  startMin: number,
  endMin: number
): Block[] {
  const windowStart = dayjs.tz(dateKey, SHOP_TZ).startOf('day').add(startMin, 'minute');
  const windowEnd = dayjs.tz(dateKey, SHOP_TZ).startOf('day').add(endMin, 'minute');
  const out: Block[] = [];

  for (const op of ops) {
    for (const [i, seg] of segmentsForOp(op).entries()) {
      const segStart = dayjs(seg.start).tz(SHOP_TZ);
      const segEnd = dayjs(seg.end).tz(SHOP_TZ);
      if (!segEnd.isAfter(segStart)) continue;
      const s = segStart.isAfter(windowStart) ? segStart : windowStart;
      const e = segEnd.isBefore(windowEnd) ? segEnd : windowEnd;
      if (!e.isAfter(s)) continue;
      if (s.format('YYYY-MM-DD') !== dateKey) continue;

      const sMin = shopMinutesFromDayjs(s);
      const eMin = shopMinutesFromDayjs(e);
      const machine = op.machineUnitLabel || 'No machine';
      const job = op.jobNumber || '';
      out.push({
        key: `${op.id}-${i}-${dateKey}`,
        op,
        top: (sMin - startMin) * PX_PER_MIN,
        height: Math.max((eMin - sMin) * PX_PER_MIN, 28),
        labelMain: scheduleOpTitle(op.sequenceNo, op.operationName),
        labelSub: [job, machine].filter(Boolean).join(' · '),
      });
    }
  }
  return out.sort((a, b) => a.top - b.top);
}

export default function WorkerPersonalSchedule() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { colors } = useWorkerTheme();
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [anchor, setAnchor] = useState(() => dayjs().tz(SHOP_TZ));
  const [ops, setOps] = useState<ScheduleBoardOperation[]>([]);
  const [windows, setWindows] = useState<ShopDayWindow[]>([]);
  const [loading, setLoading] = useState(true);

  const { from, to } = useMemo(() => periodBounds(anchor, viewMode), [anchor, viewMode]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await scheduleApi.board({
          from: from.format('YYYY-MM-DD'),
          to: to.format('YYYY-MM-DD'),
          workerId: user.id,
          includeCompleted: true,
        });
        if (cancelled) return;
        setOps(data.operations || []);
        setWindows(
          data.workerDayWindows?.length
            ? data.workerDayWindows
            : data.shopDayWindows || []
        );
      } catch (err) {
        if (!cancelled) message.error(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to, user?.id]);

  const dayKeys = useMemo(() => {
    const keys: string[] = [];
    let cur = from.startOf('day');
    const last = to.startOf('day');
    while (!cur.isAfter(last)) {
      keys.push(cur.format('YYYY-MM-DD'));
      cur = cur.add(1, 'day');
    }
    return keys;
  }, [from, to]);

  const gridRange = useMemo(() => {
    let startMin = DEFAULT_START;
    let endMin = DEFAULT_END;
    let anyWorking = false;
    for (const key of dayKeys) {
      const w = windowForDate(windows, key);
      if (!w.isWorking) continue;
      if (!anyWorking) {
        startMin = w.startMin;
        endMin = w.endMin;
        anyWorking = true;
      } else {
        startMin = Math.min(startMin, w.startMin);
        endMin = Math.max(endMin, w.endMin);
      }
    }
    if (!anyWorking) return { startMin: DEFAULT_START, endMin: DEFAULT_END };
    return { startMin, endMin };
  }, [dayKeys, windows]);

  const hours = hourLabels(gridRange.startMin, gridRange.endMin);
  const gridHeight = (gridRange.endMin - gridRange.startMin) * PX_PER_MIN;

  const todayKey = dayjs().tz(SHOP_TZ).format('YYYY-MM-DD');

  const periodOpsExist = useMemo(() => {
    if (viewMode === 'day') {
      return blocksForDay(ops, from.format('YYYY-MM-DD'), gridRange.startMin, gridRange.endMin)
        .length > 0;
    }
    return dayKeys.some(
      (k) => blocksForDay(ops, k, gridRange.startMin, gridRange.endMin).length > 0
    );
  }, [ops, viewMode, from, dayKeys, gridRange]);

  const focusWindow = windowForDate(windows, from.format('YYYY-MM-DD'));
  const emptyMessage =
    viewMode === 'day'
      ? from.isSame(dayjs().tz(SHOP_TZ), 'day')
        ? 'No operations scheduled for today'
        : `No operations scheduled for ${from.format('MMM D')}`
      : 'No operations scheduled this week';

  const shift = (dir: -1 | 1) => {
    if (viewMode === 'day') setAnchor((a) => a.add(dir, 'day'));
    else setAnchor((a) => a.add(dir * 7, 'day'));
  };

  const periodLabel =
    viewMode === 'day'
      ? from.format('ddd, MMM D')
      : `${from.format('MMM D')} – ${to.format('MMM D')}`;

  const openOp = (op: ScheduleBoardOperation) => {
    navigate(`/my-assignments/${op.jobOrderId}`);
  };

  const renderDayColumn = (dateKey: string, wide: boolean) => {
    const w = windowForDate(windows, dateKey);
    const d = dayjs.tz(dateKey, SHOP_TZ);
    const isToday = dateKey === todayKey;
    const blocks = w.isWorking
      ? blocksForDay(ops, dateKey, gridRange.startMin, gridRange.endMin)
      : [];

    return (
      <div
        key={dateKey}
        style={{
          flex: wide ? '1 1 0' : undefined,
          minWidth: wide ? 0 : 72,
          width: wide ? undefined : 72,
          borderLeft: '1px solid #e2e8f0',
          position: 'relative',
          background: isToday ? 'rgba(37,99,235,0.04)' : '#fff',
        }}
      >
        {!w.isWorking ? (
          <div
            style={{
              height: gridHeight,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94a3b8',
              fontSize: 11,
              fontWeight: 600,
              padding: 8,
              textAlign: 'center',
            }}
          >
            Off
          </div>
        ) : (
          <div style={{ position: 'relative', height: gridHeight }}>
            {hours.map((h) => {
              const top = (h * 60 - gridRange.startMin) * PX_PER_MIN;
              if (top < 0 || top > gridHeight) return null;
              return (
                <div
                  key={h}
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top,
                    borderTop: '1px solid #f1f5f9',
                    height: 0,
                    pointerEvents: 'none',
                  }}
                />
              );
            })}
            {blocks.map((b) => {
              const color = STATUS_COLOR[b.op.status] || '#2563eb';
              const showSub = b.height >= 44;
              const dayFill = viewMode === 'day';
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => openOp(b.op)}
                  style={{
                    position: 'absolute',
                    left: dayFill ? 0 : 3,
                    right: dayFill ? 0 : 3,
                    top: b.top,
                    height: b.height,
                    margin: 0,
                    padding: wide ? '4px 6px' : '3px 4px',
                    border: 'none',
                    borderRadius: dayFill ? 0 : 8,
                    background: color,
                    color: '#fff',
                    textAlign: 'left',
                    cursor: 'pointer',
                    overflow: 'hidden',
                    boxShadow: dayFill ? undefined : '0 1px 2px rgba(15,23,42,0.12)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-start',
                    gap: 1,
                    zIndex: 2,
                  }}
                >
                  <span
                    style={{
                      fontSize: wide ? 12 : 10,
                      fontWeight: 800,
                      lineHeight: 1.2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      width: '100%',
                    }}
                  >
                    {b.labelMain}
                  </span>
                  {showSub ? (
                    <span
                      style={{
                        fontSize: wide ? 11 : 9,
                        fontWeight: 600,
                        opacity: 0.92,
                        lineHeight: 1.2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        width: '100%',
                      }}
                    >
                      {b.labelSub}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
        {/* day header is outside for week — rendered separately */}
        <span style={{ display: 'none' }}>{d.format('D')}</span>
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100%', background: colors.bg }}>
      <WorkerPageHeader
        title="Schedule"
        subtitle="Your ops"
        onBack={() => navigate('/my-assignments')}
        showSchedule={false}
      />

      <div style={{ padding: '12px 14px 24px' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <div
            style={{
              flex: '1 1 160px',
              minWidth: 148,
              maxWidth: 220,
            }}
          >
            <Segmented
              block
              className="worker-seg"
              value={viewMode}
              onChange={(v) => setViewMode(v as ViewMode)}
              options={[
                { label: 'Day', value: 'day' },
                { label: 'Week', value: 'week' },
              ]}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginLeft: 'auto',
            }}
          >
            <button
              type="button"
              onClick={() => shift(-1)}
              aria-label="Previous"
              style={{
                border: 'none',
                borderRadius: 8,
                width: 28,
                height: 30,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                background: 'transparent',
                color: colors.text,
                fontSize: 12,
                padding: 0,
              }}
            >
              <LeftOutlined />
            </button>
            <button
              type="button"
              onClick={() => setAnchor(dayjs().tz(SHOP_TZ))}
              style={{
                border: 'none',
                borderRadius: 8,
                height: 30,
                padding: '0 10px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                cursor: 'pointer',
                background: colors.card,
                color: colors.text,
                fontWeight: 700,
                fontSize: 12,
                boxShadow: '0 1px 2px rgba(15, 23, 42, 0.1)',
              }}
            >
              <AimOutlined />
              Today
            </button>
            <button
              type="button"
              onClick={() => shift(1)}
              aria-label="Next"
              style={{
                border: 'none',
                borderRadius: 8,
                width: 28,
                height: 30,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                background: 'transparent',
                color: colors.text,
                fontSize: 12,
                padding: 0,
              }}
            >
              <RightOutlined />
            </button>
          </div>
        </div>

        <div
          style={{
            fontSize: 15,
            fontWeight: 800,
            color: colors.text,
            marginBottom: 10,
          }}
        >
          {periodLabel}
        </div>

        {loading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : viewMode === 'day' && !focusWindow.isWorking ? (
          <div
            style={{
              background: colors.card,
              border: `1px solid ${colors.cardBorder}`,
              borderRadius: 12,
              padding: '36px 20px',
              textAlign: 'center',
              color: colors.textSecondary,
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            You are not scheduled to work this day
          </div>
        ) : !periodOpsExist ? (
          <div
            style={{
              background: colors.card,
              border: `1px solid ${colors.cardBorder}`,
              borderRadius: 12,
              padding: '36px 20px',
              textAlign: 'center',
              color: colors.textSecondary,
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {emptyMessage}
          </div>
        ) : (
          <div
            style={{
              background: colors.card,
              border: `1px solid ${colors.cardBorder}`,
              borderRadius: 12,
              overflow: 'hidden',
              boxShadow: colors.shadow,
            }}
          >
            <div style={{ display: 'flex' }}>
              <div
                style={{
                  width: HOUR_GUTTER,
                  flexShrink: 0,
                  background: '#f8fafc',
                  borderRight: '1px solid #e2e8f0',
                }}
              >
                {viewMode === 'week' ? (
                  <div
                    style={{
                      height: 52,
                      borderBottom: '1px solid #e2e8f0',
                    }}
                  />
                ) : null}
                <div style={{ position: 'relative', height: gridHeight }}>
                  {hours.map((h) => {
                    const top = (h * 60 - gridRange.startMin) * PX_PER_MIN;
                    if (top < -4 || top > gridHeight - 4) return null;
                    return (
                      <div
                        key={h}
                        style={{
                          position: 'absolute',
                          top: Math.max(0, top - 7),
                          right: 6,
                          fontSize: 10,
                          fontWeight: 600,
                          color: '#94a3b8',
                          lineHeight: 1,
                        }}
                      >
                        {formatHour(h)}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 0, overflowX: viewMode === 'week' ? 'auto' : 'hidden' }}>
                {viewMode === 'week' ? (
                  <div
                    style={{
                      display: 'flex',
                      borderBottom: '1px solid #e2e8f0',
                      minWidth: dayKeys.length * 72,
                    }}
                  >
                    {dayKeys.map((key) => {
                      const d = dayjs.tz(key, SHOP_TZ);
                      const isToday = key === todayKey;
                      return (
                        <div
                          key={`h-${key}`}
                          style={{
                            flex: '1 1 0',
                            minWidth: 72,
                            padding: '8px 4px',
                            textAlign: 'center',
                            borderLeft: '1px solid #e2e8f0',
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: '#64748b',
                              textTransform: 'uppercase',
                            }}
                          >
                            {d.format('ddd')}
                          </div>
                          <div
                            style={{
                              fontSize: 16,
                              fontWeight: 800,
                              color: isToday ? '#2563eb' : '#0f172a',
                              marginTop: 2,
                            }}
                          >
                            {d.format('D')}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                <div
                  style={{
                    display: 'flex',
                    minWidth: viewMode === 'week' ? dayKeys.length * 72 : undefined,
                  }}
                >
                  {viewMode === 'day'
                    ? renderDayColumn(from.format('YYYY-MM-DD'), true)
                    : dayKeys.map((key) => renderDayColumn(key, true))}
                </div>
              </div>
            </div>

            <div
              style={{
                padding: '8px 12px',
                borderTop: '1px solid #e2e8f0',
                fontSize: 11,
                color: '#94a3b8',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
              }}
            >
              <span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: STATUS_COLOR.SCHEDULED,
                    marginRight: 4,
                  }}
                />
                Upcoming
              </span>
              <span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: STATUS_COLOR.IN_PROGRESS,
                    marginRight: 4,
                  }}
                />
                In progress
              </span>
              <span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: STATUS_COLOR.COMPLETED,
                    marginRight: 4,
                  }}
                />
                Completed
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
