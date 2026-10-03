import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, DatePicker, Segmented, Spin } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  scheduleApi,
  type ScheduleBoardDowntime,
  type ScheduleBoardOperation,
  type ShopDayWindow,
} from '../../api/schedule.api';
import { getErrorMessage } from '../../api/client';
import ScheduleTimelineBoard, { type TimelineRow } from '../schedule/ScheduleTimelineBoard';
import {
  periodBounds,
  weekStartFromIsoDates,
  WORKING_HOURS_NOTE,
  type TimelineViewMode,
} from '../schedule/scheduleTimelineUtils';
import type { MachineUnitInfo, ProposedOperation } from '../../types';
import { SHOP_TZ } from '../../utils/shopTime';
import JobScheduleColorPicker from './JobScheduleColorPicker';

type RowMode = 'machine' | 'worker';
type BoardWorker = { id: string; fullName: string };

const NO_DOWNTIMES: ScheduleBoardDowntime[] = [];

function buildMachineRows(units: MachineUnitInfo[]): TimelineRow[] {
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
  rows.push({ key: '__none__', label: 'No machine', noMachine: true });
  return rows;
}

function buildWorkerRows(workers: BoardWorker[], ops: ScheduleBoardOperation[]): TimelineRow[] {
  const byId = new Map<string, string>();
  for (const w of workers) {
    byId.set(w.id, w.fullName);
  }
  for (const op of ops) {
    if (op.assignedWorkerId && !byId.has(op.assignedWorkerId)) {
      byId.set(op.assignedWorkerId, op.assignedWorkerName || 'Worker');
    }
  }
  return [...byId.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, name]) => ({
      key: id,
      label: name,
      workerId: id,
    }));
}

function segmentsForOp(op: ProposedOperation) {
  // Prefer scheduler working segments (already split across days). Fall back to
  // the overnight envelope — ScheduleTimelineBoard splits that for week view.
  if (op.segments && op.segments.length > 0) return op.segments;
  if (op.scheduledStart && op.scheduledEnd) {
    return [{ start: op.scheduledStart, end: op.scheduledEnd }];
  }
  return [];
}

function proposedToBoardOp(
  op: ProposedOperation,
  jobId: string,
  jobNumber?: string | null,
  jobTitle?: string,
  scheduleColor?: string | null,
  workerName?: string | null
): ScheduleBoardOperation {
  return {
    id: op.id || `proposed-${op.sequenceNo}`,
    jobOrderId: jobId,
    jobNumber: jobNumber || undefined,
    jobTitle,
    sequenceNo: op.sequenceNo,
    operationName: op.operationName || `Operation ${op.sequenceNo}`,
    status: 'SCHEDULED',
    estimatedHours: op.estimatedHours ?? undefined,
    scheduledStart: op.scheduledStart || null,
    scheduledEnd: op.scheduledEnd || null,
    segments: segmentsForOp(op),
    machineTypeId: op.machineTypeId,
    machineUnitId: op.machineUnitId,
    machineUnitLabel: op.machineUnitLabel,
    assignedWorkerId: op.assignedWorkerId,
    assignedWorkerName: workerName || undefined,
    scheduleColor: scheduleColor || null,
  };
}

type Props = {
  jobId: string;
  jobNumber?: string | null;
  jobTitle: string;
  operations: ProposedOperation[];
  machineUnits: MachineUnitInfo[];
  expandButton?: ReactNode;
  scheduleColor?: string | null;
  onScheduleColorChange?: (hex: string) => void;
  colorPickerDisabled?: boolean;
};

export default function ScheduleWeekView({
  jobId,
  jobNumber,
  jobTitle,
  operations,
  machineUnits,
  expandButton,
  scheduleColor,
  onScheduleColorChange,
  colorPickerDisabled,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [boardOps, setBoardOps] = useState<ScheduleBoardOperation[]>([]);
  const [boardWorkers, setBoardWorkers] = useState<BoardWorker[]>([]);
  const [downtimes, setDowntimes] = useState<ScheduleBoardDowntime[]>([]);
  const [shopDayWindows, setShopDayWindows] = useState<ShopDayWindow[]>([]);
  const [fetchError, setFetchError] = useState('');
  const [rowMode, setRowMode] = useState<RowMode>('machine');
  const [viewMode, setViewMode] = useState<TimelineViewMode>('week');
  const proposed = useMemo(
    () => operations.filter((o) => o.scheduled && o.scheduledStart && o.scheduledEnd),
    [operations]
  );

  const defaultWeekStart = useMemo(() => {
    const dates = proposed.flatMap((o) => segmentsForOp(o).map((s) => s.start));
    return weekStartFromIsoDates(dates);
  }, [proposed]);

  const defaultWeekKey = defaultWeekStart.format('YYYY-MM-DD');
  const [anchor, setAnchor] = useState<Dayjs>(defaultWeekStart);

  // When the proposal’s earliest week changes (new draft / big time edits), snap back.
  useEffect(() => {
    setAnchor(dayjs.tz(defaultWeekKey, SHOP_TZ).startOf('day'));
  }, [defaultWeekKey]);

  const { from, to } = useMemo(() => periodBounds(anchor, viewMode), [anchor, viewMode]);
  const fromKey = from.format('YYYY-MM-DD');
  const toKey = to.format('YYYY-MM-DD');
  const periodLabel =
    viewMode === 'day'
      ? from.format('ddd, MMM D, YYYY')
      : viewMode === 'month'
        ? from.format('MMMM YYYY')
        : `${from.format('MMM D')} – ${to.format('MMM D, YYYY')}`;

  const periodHint =
    viewMode === 'day' ? 'day' : viewMode === 'month' ? 'month' : 'week';

  const shiftPeriod = (dir: 1 | -1) => {
    if (viewMode === 'day') setAnchor((a) => a.add(dir, 'day'));
    else if (viewMode === 'week') setAnchor((a) => a.add(dir * 7, 'day'));
    else setAnchor((a) => a.add(dir, 'month'));
  };

  const workerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of boardWorkers) map.set(w.id, w.fullName);
    return map;
  }, [boardWorkers]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setFetchError('');
      try {
        const { data } = await scheduleApi.board({
          from: fromKey,
          to: toKey,
          includeCompleted: false,
        });
        if (cancelled) return;
        setBoardOps(data.operations.filter((op) => op.jobOrderId !== jobId));
        setBoardWorkers(data.workers || []);
        setDowntimes(data.downtimes || []);
        setShopDayWindows(data.shopDayWindows || []);
      } catch (err) {
        if (!cancelled) setFetchError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, fromKey, toKey]);

  const mergedOps = useMemo(() => {
    const thisJobOps = proposed.map((op) =>
      proposedToBoardOp(
        op,
        jobId,
        jobNumber,
        jobTitle,
        scheduleColor,
        op.assignedWorkerId ? workerNameById.get(op.assignedWorkerId) : null
      )
    );
    return [...boardOps, ...thisJobOps];
  }, [proposed, boardOps, jobId, jobNumber, jobTitle, scheduleColor, workerNameById]);

  const rows = useMemo(() => {
    if (rowMode === 'worker') return buildWorkerRows(boardWorkers, mergedOps);
    return buildMachineRows(machineUnits);
  }, [rowMode, boardWorkers, mergedOps, machineUnits]);

  if (!proposed.length) return null;

  const navTrailing =
    expandButton || onScheduleColorChange ? (
      <span className="jo-week-view__nav-expand">
        {onScheduleColorChange ? (
          <JobScheduleColorPicker
            value={scheduleColor}
            onChange={onScheduleColorChange}
            disabled={colorPickerDisabled}
          />
        ) : null}
        {expandButton}
      </span>
    ) : null;

  if (loading && boardOps.length === 0) {
    return (
      <div className="sched-expand__slot">
        {navTrailing ? <div className="jo-week-view__nav">{navTrailing}</div> : null}
        <div style={{ padding: 32, textAlign: 'center' }}>
          <Spin />
        </div>
      </div>
    );
  }

  return (
    <div className="sched-expand__slot">
      <div className="jo-week-view__nav">
        <div className="jo-week-view__nav-left">
          <Segmented
            value={rowMode}
            onChange={(v) => setRowMode(v as RowMode)}
            options={[
              { label: 'By machine', value: 'machine' },
              { label: 'By worker', value: 'worker' },
            ]}
          />
          <Segmented
            value={viewMode}
            onChange={(v) => setViewMode(v as TimelineViewMode)}
            options={[
              { label: 'Day', value: 'day' },
              { label: 'Week', value: 'week' },
              { label: 'Month', value: 'month' },
            ]}
          />
        </div>
        <div className="jo-week-view__nav-center">
          <Button
            type="text"
            size="small"
            className="sched-expand__btn"
            icon={<LeftOutlined />}
            aria-label={`Previous ${periodHint}`}
            onClick={() => shiftPeriod(-1)}
          />
          <DatePicker
            size="small"
            variant="borderless"
            allowClear={false}
            picker={viewMode === 'day' ? 'date' : viewMode}
            value={anchor}
            format={() => periodLabel}
            onChange={(v) => {
              if (v) setAnchor(dayjs.tz(v.format('YYYY-MM-DD'), SHOP_TZ).startOf('day'));
            }}
            className="jo-week-view__nav-label"
            aria-label={`Pick a ${periodHint}`}
          />
          <Button
            type="text"
            size="small"
            className="sched-expand__btn"
            icon={<RightOutlined />}
            aria-label={`Next ${periodHint}`}
            onClick={() => shiftPeriod(1)}
          />
        </div>
        <div className="jo-week-view__nav-right">
          {navTrailing}
        </div>
      </div>
      {fetchError ? (
        <div style={{ fontSize: 12, color: '#7A1528', marginBottom: 8 }}>
          Could not load shop schedule: {fetchError}
        </div>
      ) : null}
      <ScheduleTimelineBoard
        from={from}
        to={to}
        viewMode={viewMode}
        rowMode={rowMode}
        rows={rows}
        operations={mergedOps}
        downtimes={rowMode === 'machine' ? downtimes : NO_DOWNTIMES}
        highlightJobId={jobId}
        highlightColor={scheduleColor}
        shopDayWindows={shopDayWindows}
        showLegend
        footerNote={
          viewMode === 'week'
            ? `${WORKING_HOURS_NOTE} Week of ${from.format('MMM D')} – ${to.format('MMM D')}.`
            : viewMode === 'day'
              ? `${WORKING_HOURS_NOTE} ${from.format('ddd, MMM D')}.`
              : `${WORKING_HOURS_NOTE} ${from.format('MMMM YYYY')}.`
        }
      />
    </div>
  );
}
