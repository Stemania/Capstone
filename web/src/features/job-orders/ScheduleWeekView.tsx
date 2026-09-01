import { useEffect, useMemo, useState } from 'react';
import { Spin } from 'antd';
import { scheduleApi, type ScheduleBoardDowntime, type ScheduleBoardOperation, type ShopDayWindow } from '../../api/schedule.api';
import { getErrorMessage } from '../../api/client';
import ScheduleTimelineBoard, { type TimelineRow } from '../schedule/ScheduleTimelineBoard';
import { periodBounds, weekStartFromIsoDates, WORKING_HOURS_NOTE } from '../schedule/scheduleTimelineUtils';
import type { MachineUnitInfo, ProposedOperation } from '../../types';
import '../../utils/shopTime';

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

function segmentsForOp(op: ProposedOperation) {
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
  jobTitle?: string
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
  };
}

type Props = {
  jobId: string;
  jobNumber?: string | null;
  jobTitle: string;
  operations: ProposedOperation[];
  machineUnits: MachineUnitInfo[];
};

export default function ScheduleWeekView({
  jobId,
  jobNumber,
  jobTitle,
  operations,
  machineUnits,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [boardOps, setBoardOps] = useState<ScheduleBoardOperation[]>([]);
  const [downtimes, setDowntimes] = useState<ScheduleBoardDowntime[]>([]);
  const [shopDayWindows, setShopDayWindows] = useState<ShopDayWindow[]>([]);
  const [fetchError, setFetchError] = useState('');

  const proposed = operations.filter((o) => o.scheduled && o.scheduledStart && o.scheduledEnd);

  const weekAnchor = useMemo(() => {
    const dates = proposed.flatMap((o) => segmentsForOp(o).map((s) => s.start));
    return weekStartFromIsoDates(dates);
  }, [proposed]);

  const { from, to } = useMemo(() => periodBounds(weekAnchor, 'week'), [weekAnchor]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setFetchError('');
      try {
        const { data } = await scheduleApi.board({
          from: from.format('YYYY-MM-DD'),
          to: to.format('YYYY-MM-DD'),
          includeCompleted: false,
        });
        if (cancelled) return;
        setBoardOps(data.operations.filter((op) => op.jobOrderId !== jobId));
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
  }, [jobId, from.format('YYYY-MM-DD'), to.format('YYYY-MM-DD')]);

  const mergedOps = useMemo(() => {
    const thisJobOps = proposed.map((op) => proposedToBoardOp(op, jobId, jobNumber, jobTitle));
    return [...boardOps, ...thisJobOps];
  }, [proposed, boardOps, jobId, jobNumber, jobTitle]);

  if (!proposed.length) return null;

  const rows = buildRows(machineUnits);

  if (loading && boardOps.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  return (
    <div className="sched-expand__slot">
      {fetchError ? (
        <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }}>
          Could not load shop schedule: {fetchError}
        </div>
      ) : null}
      <ScheduleTimelineBoard
        from={from}
        to={to}
        viewMode="week"
        rows={rows}
        operations={mergedOps}
        downtimes={downtimes}
        highlightJobId={jobId}
        shopDayWindows={shopDayWindows}
        showLegend
        footerNote={`${WORKING_HOURS_NOTE} Week of ${from.format('MMM D')} – ${to.format('MMM D')}.`}
      />
    </div>
  );
}
