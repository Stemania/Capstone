import { Tooltip } from 'antd';
import dayjs from 'dayjs';
import type { MachineUnitInfo, ProposedOperation, ScheduleSegment } from '../../types';
import '../../utils/shopTime';
import { SHOP_TZ, formatShopTime } from '../../utils/shopTime';

const NAVY = '#0f1c2e';
const HOUR_START = 6;
const HOUR_END = 22;
const HOUR_SPAN = HOUR_END - HOUR_START;
const DAY_WIDTH = 128;
const ROW_HEIGHT = 44;

type TimelineRow = {
  key: string;
  label: string;
  group?: string;
  machineUnitId?: string | null;
  noMachine?: boolean;
};

type BarSegment = {
  op: ProposedOperation;
  dayIndex: number;
  topPct: number;
  heightPct: number;
  startLabel: string;
  endLabel: string;
};

function buildRows(units: MachineUnitInfo[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let lastType = '';
  const sorted = [...units].sort((a, b) => {
    const ta = a.machineTypeName || '';
    const tb = b.machineTypeName || '';
    if (ta !== tb) return ta.localeCompare(tb);
    return a.label.localeCompare(b.label);
  });
  for (const u of sorted) {
    const group = u.machineTypeName || u.machineTypeCode || 'Machines';
    rows.push({
      key: u.id,
      label: u.label,
      group: group !== lastType ? group : undefined,
      machineUnitId: u.id,
    });
    lastType = group;
  }
  rows.push({ key: '__none__', label: 'Worker only', noMachine: true });
  return rows;
}

function segmentsForOp(op: ProposedOperation): ScheduleSegment[] {
  if (op.segments && op.segments.length > 0) return op.segments;
  if (op.scheduledStart && op.scheduledEnd) {
    return [{ start: op.scheduledStart, end: op.scheduledEnd }];
  }
  return [];
}

function weekStartFromOps(ops: ProposedOperation[]): dayjs.Dayjs {
  const starts = ops
    .flatMap((o) => segmentsForOp(o))
    .map((s) => dayjs(s.start).tz(SHOP_TZ).startOf('day'));
  if (!starts.length) return dayjs().tz(SHOP_TZ).startOf('week').add(1, 'day');
  return starts.reduce((a, b) => (a.isBefore(b) ? a : b));
}

function barsForRow(
  row: TimelineRow,
  ops: ProposedOperation[],
  weekStart: dayjs.Dayjs
): BarSegment[] {
  const rowOps = ops.filter((op) => {
    if (!op.scheduled || !op.scheduledStart || !op.scheduledEnd) return false;
    if (row.noMachine) return !op.machineTypeId;
    return op.machineUnitId === row.machineUnitId;
  });

  const segments: BarSegment[] = [];
  for (const op of rowOps) {
    for (const piece of segmentsForOp(op)) {
      const start = dayjs(piece.start).tz(SHOP_TZ);
      const end = dayjs(piece.end).tz(SHOP_TZ);
      for (let d = 0; d < 7; d += 1) {
        const day = weekStart.add(d, 'day');
        const dayStart = day.hour(HOUR_START).minute(0);
        const dayEnd = day.hour(HOUR_END).minute(0);
        const segStart = start.isAfter(dayStart) ? start : dayStart;
        const segEnd = end.isBefore(dayEnd) ? end : dayEnd;
        if (segEnd.isAfter(segStart) && start.isBefore(dayEnd) && end.isAfter(dayStart)) {
          const topH = segStart.diff(dayStart, 'minute') / 60;
          const heightH = segEnd.diff(segStart, 'minute') / 60;
          segments.push({
            op,
            dayIndex: d,
            topPct: (topH / HOUR_SPAN) * 100,
            heightPct: Math.max((heightH / HOUR_SPAN) * 100, 4),
            startLabel: formatShopTime(piece.start),
            endLabel: formatShopTime(piece.end),
          });
        }
      }
    }
  }
  return segments;
}

type Props = {
  jobTitle: string;
  operations: ProposedOperation[];
  machineUnits: MachineUnitInfo[];
};

export default function ScheduleWeekView({ jobTitle, operations, machineUnits }: Props) {
  const scheduled = operations.filter((o) => o.scheduled && o.scheduledStart && o.scheduledEnd);
  if (!scheduled.length) return null;

  const rows = buildRows(machineUnits);
  const weekStart = weekStartFromOps(scheduled);
  const weekDays = Array.from({ length: 7 }, (_, i) => weekStart.add(i, 'day'));

  return (
    <div
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        overflow: 'hidden',
        background: '#fff',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `160px repeat(7, ${DAY_WIDTH}px)`,
          borderBottom: '1px solid #e2e8f0',
          background: '#f8fafc',
          fontSize: 11,
          fontWeight: 600,
          color: '#64748b',
        }}
      >
        <div style={{ padding: '8px 10px' }}>Resource</div>
        {weekDays.map((d) => (
          <div key={d.format('YYYY-MM-DD')} style={{ padding: '8px 6px', textAlign: 'center' }}>
            {d.format('ddd M/D')}
          </div>
        ))}
      </div>

      {rows.map((row) => {
        const bars = barsForRow(row, scheduled, weekStart);
        return (
          <div key={row.key}>
            {row.group && (
              <div
                style={{
                  padding: '4px 10px',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                  color: '#94a3b8',
                  background: '#f1f5f9',
                  borderBottom: '1px solid #e2e8f0',
                }}
              >
                {row.group}
              </div>
            )}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `160px repeat(7, ${DAY_WIDTH}px)`,
                minHeight: ROW_HEIGHT,
                borderBottom: '1px solid #f1f5f9',
              }}
            >
              <div
                style={{
                  padding: '8px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  color: row.noMachine ? '#64748b' : NAVY,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {row.label}
              </div>
              {weekDays.map((_, dayIndex) => (
                <div
                  key={dayIndex}
                  style={{
                    position: 'relative',
                    borderLeft: '1px solid #f1f5f9',
                    background: dayIndex >= 5 ? '#fafafa' : '#fff',
                  }}
                >
                  {bars
                    .filter((b) => b.dayIndex === dayIndex)
                    .map((bar, i) => (
                      <Tooltip
                        key={`${bar.op.sequenceNo}-${bar.startLabel}-${i}`}
                        title={
                          <div>
                            <div style={{ fontWeight: 600 }}>{bar.op.operationName}</div>
                            <div>{jobTitle}</div>
                            <div>
                              {bar.startLabel} – {bar.endLabel}
                            </div>
                          </div>
                        }
                      >
                        <div
                          style={{
                            position: 'absolute',
                            left: 4,
                            right: 4,
                            top: `${bar.topPct}%`,
                            height: `${bar.heightPct}%`,
                            minHeight: 6,
                            borderRadius: 4,
                            background: row.noMachine ? '#64748b' : '#2563eb',
                            opacity: 0.88,
                            cursor: 'default',
                          }}
                        />
                      </Tooltip>
                    ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div style={{ padding: '6px 10px', fontSize: 10, color: '#94a3b8' }}>
        Times shown in Asia/Manila ({HOUR_START}:00–{HOUR_END}:00)
      </div>
    </div>
  );
}
