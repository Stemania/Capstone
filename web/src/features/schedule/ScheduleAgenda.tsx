import { useMemo } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { RightOutlined, ToolOutlined, WarningOutlined, InboxOutlined } from '@ant-design/icons';
import type { ScheduleBoardDowntime, ScheduleBoardOperation } from '../../api/schedule.api';
import { OPERATION_BAR_COLOR, OPERATION_STATUS } from '../../theme/statuses';
import StatusPill from '../../components/StatusPill';
import { PersonAvatar, crewNames } from '../../components/PersonAvatar';
import { personLabel } from '../../utils/people';
import { SHOP_TZ } from '../../utils/shopTime';
import { scheduleOpTitle } from './scheduleTimelineUtils';

type Props = {
  operations: ScheduleBoardOperation[];
  downtimes: ScheduleBoardDowntime[];
  from: Dayjs;
  to: Dayjs;
  groupBy?: 'machine' | 'worker';
  onOpenJob: (jobOrderId: string) => void;
};

type AgendaItem = { op: ScheduleBoardOperation; start: Dayjs; end: Dayjs };
type AgendaDowntime = { dt: ScheduleBoardDowntime; start: Dayjs; end: Dayjs };
type AgendaDay = { key: string; date: Dayjs; items: AgendaItem[]; downtimes: AgendaDowntime[] };

function opSegments(op: ScheduleBoardOperation) {
  if (op.segments.length > 0) return op.segments;
  if (op.scheduledStart && op.scheduledEnd) return [{ start: op.scheduledStart, end: op.scheduledEnd }];
  return [];
}

/** Earliest start and latest end of a set of time ranges inside one shop day. */
function pieceOnDay(ranges: { start: string; end: string }[], day: Dayjs) {
  const dayStart = day.startOf('day');
  const dayEnd = day.endOf('day');
  let start: Dayjs | null = null;
  let end: Dayjs | null = null;
  for (const r of ranges) {
    const s = dayjs(r.start).tz(SHOP_TZ);
    const e = dayjs(r.end).tz(SHOP_TZ);
    if (!s.isValid() || !e.isValid() || !e.isAfter(dayStart) || !s.isBefore(dayEnd)) continue;
    const cs = s.isBefore(dayStart) ? dayStart : s;
    const ce = e.isAfter(dayEnd) ? dayEnd : e;
    if (!start || cs.isBefore(start)) start = cs;
    if (!end || ce.isAfter(end)) end = ce;
  }
  return start && end ? { start, end } : null;
}

function timeRange(start: Dayjs, end: Dayjs) {
  const allDay = start.hour() === 0 && start.minute() === 0 && end.hour() === 23 && end.minute() === 59;
  if (allDay) return 'All day';
  return `${start.format('h:mm A')} – ${end.format('h:mm A')}`;
}

/** Phone view of the schedule board: one list per day, in time order. */
function groupLabel(op: ScheduleBoardOperation, groupBy: 'machine' | 'worker') {
  if (groupBy === 'worker') {
    return op.assignedWorkerName
      ? personLabel(op.assignedWorkerName, op.assignedWorkerNickname)
      : 'No worker';
  }
  return op.machineUnitLabel || op.machineTypeName || 'No machine';
}

export default function ScheduleAgenda({ operations, downtimes, from, to, groupBy = 'machine', onOpenJob }: Props) {
  const days = useMemo<AgendaDay[]>(() => {
    const out: AgendaDay[] = [];
    const last = to.tz(SHOP_TZ).startOf('day');
    for (let d = from.tz(SHOP_TZ).startOf('day'); !d.isAfter(last); d = d.add(1, 'day')) {
      const items: AgendaItem[] = [];
      for (const op of operations) {
        const piece = pieceOnDay(opSegments(op), d);
        if (piece) items.push({ op, ...piece });
      }
      items.sort((a, b) => a.start.valueOf() - b.start.valueOf() || a.op.sequenceNo - b.op.sequenceNo);
      const dts: AgendaDowntime[] = [];
      for (const dt of downtimes) {
        const piece = pieceOnDay([{ start: dt.segmentStart, end: dt.segmentEnd }], d);
        if (piece) dts.push({ dt, ...piece });
      }
      if (items.length || dts.length) {
        out.push({ key: d.format('YYYY-MM-DD'), date: d, items, downtimes: dts });
      }
    }
    return out;
  }, [operations, downtimes, from, to]);

  const today = dayjs().tz(SHOP_TZ).startOf('day');

  if (!days.length) {
    return <div className="sched-agenda__empty">Nothing scheduled in this period.</div>;
  }

  return (
    <div className="sched-agenda">
      {days.map((day) => {
        const isToday = day.date.isSame(today, 'day');
        return (
          <section key={day.key} className="sched-agenda__day" aria-label={day.date.format('dddd, MMMM D')}>
            <h3 className={`sched-agenda__date${isToday ? ' is-today' : ''}`}>
              <span>{day.date.format('ddd, MMM D')}</span>
              {isToday ? <span className="sched-agenda__today">Today</span> : null}
              <span className="sched-agenda__count">
                {day.items.length} op{day.items.length === 1 ? '' : 's'}
              </span>
            </h3>
            {day.downtimes.map(({ dt, start, end }) => (
              <div key={dt.id} className="sched-agenda__downtime">
                <ToolOutlined aria-hidden />
                <span>
                  <strong>{dt.machineUnitLabel || 'Machine'} down</strong>
                  {' · '}
                  {dt.open ? 'still down' : timeRange(start, end)}
                  {dt.reason ? ` · ${dt.reason}` : ''}
                </span>
              </div>
            ))}
            {Array.from(
              day.items.reduce((groups, item) => {
                const label = groupLabel(item.op, groupBy);
                const bucket = groups.get(label);
                if (bucket) bucket.push(item);
                else groups.set(label, [item]);
                return groups;
              }, new Map<string, AgendaItem[]>()),
            ).map(([label, items]) => (
              <div key={label} className="sched-agenda__group">
                <h4 className="sched-agenda__group-name">{label}</h4>
                {items.map(({ op, start, end }) => {
              const color = op.scheduleColor || OPERATION_BAR_COLOR[op.status] || '#2563eb';
              const crew =
                crewNames(
                  op.crew,
                  op.assignedWorkerName ? personLabel(op.assignedWorkerName, op.assignedWorkerNickname) : null,
                ) || 'No worker yet';
              const where = op.machineUnitLabel || op.machineTypeName || 'No machine';
              return (
                <button
                  key={`${op.id}-${day.key}`}
                  type="button"
                  className={`sched-agenda__item${op.isLate ? ' is-late' : ''}`}
                  onClick={() => onOpenJob(op.jobOrderId)}
                >
                  <span className="sched-agenda__body">
                    <span className="sched-agenda__row">
                      <span className="sched-agenda__time">
                        <span className="sched-agenda__dot" style={{ background: color }} aria-hidden />
                        {timeRange(start, end)}
                      </span>
                      <StatusPill status={op.status} map={OPERATION_STATUS} compact />
                    </span>
                    <span className="sched-agenda__title">
                      {scheduleOpTitle(op.sequenceNo, op.operationName)}
                    </span>
                    <span className="sched-agenda__meta">
                      {[op.jobNumber, op.clientName].filter(Boolean).join(' · ')}
                    </span>
                    <span className="sched-agenda__meta sched-agenda__who">
                      {op.assignedWorkerId ? (
                        <PersonAvatar
                          userId={op.assignedWorkerId}
                          fullName={op.assignedWorkerName || ''}
                          photoVersion={op.assignedWorkerPhotoVersion}
                          size={20}
                        />
                      ) : null}
                      <span>
                        {crew} · {where}
                      </span>
                    </span>
                    {op.waitingForMaterials || op.isLate ? (
                      <span className="sched-agenda__flags">
                        {op.waitingForMaterials ? (
                          <span className="sched-agenda__flag is-amber">
                            <InboxOutlined aria-hidden /> Waiting for materials
                          </span>
                        ) : null}
                        {op.isLate ? (
                          <span className="sched-agenda__flag is-red">
                            <WarningOutlined aria-hidden /> At risk{op.dueDate ? ` · due ${dayjs(op.dueDate).format('MMM D')}` : ''}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                  <RightOutlined className="sched-agenda__chev" aria-hidden />
                </button>
                );
                })}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
