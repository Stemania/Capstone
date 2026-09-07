import type { ScheduleBoardOperation } from '../../api/schedule.api';
import {
  assignOverlapLanes,
  clipSegmentToPeriod,
  leftPx,
  mergeAdjacentWeekPieces,
  splitSegmentAcrossWeekDays,
  widthPx,
  type TimelineViewMode,
  type WeekTimelineLayout,
} from './scheduleTimelineUtils';
import type { Dayjs } from 'dayjs';

/** Sticky machine-type group header height in the admin schedule board. */
export const SCHEDULE_GROUP_HEADER_H = 22;

export type JobBarAnchor = {
  opId: string;
  jobOrderId: string;
  sequenceNo: number;
  scheduledStart: string | null;
  color: string;
  xLeft: number;
  xRight: number;
  cy: number;
};

export type JobConnectorPath = {
  key: string;
  d: string;
  color: string;
};

type PosArgs = [
  Dayjs,
  TimelineViewMode,
  boolean,
  WeekTimelineLayout | null | undefined,
];

type RowLike = {
  key: string;
  label?: string;
  group?: string;
  noMachine?: boolean;
  machineUnitId?: string | null;
  workerId?: string | null;
};

/**
 * Collect one rectangle per visible operation for drawing stage connectors.
 * Y is relative to the top of the tracks block (below the sticky day header).
 */
export function collectJobBarAnchors(opts: {
  rows: RowLike[];
  opsForRow: (row: RowLike) => ScheduleBoardOperation[];
  rowH: number;
  columnFill: boolean;
  viewMode: TimelineViewMode;
  weekLayout: WeekTimelineLayout | null | undefined;
  from: Dayjs;
  to: Dayjs;
  posArgs: PosArgs;
  colorForOp: (op: ScheduleBoardOperation) => string;
}): JobBarAnchor[] {
  const {
    rows,
    opsForRow,
    rowH,
    columnFill,
    viewMode,
    weekLayout,
    from,
    to,
    posArgs,
    colorForOp,
  } = opts;

  const anchors: JobBarAnchor[] = [];
  let y = 0;

  for (const row of rows) {
    if (row.group) y += SCHEDULE_GROUP_HEADER_H;

    const ops = opsForRow(row);
    const stackLanes = Boolean(row.noMachine);
    const laneItems = stackLanes
      ? ops
          .map((op) => {
            const segs =
              op.segments.length > 0
                ? op.segments
                : op.scheduledStart && op.scheduledEnd
                  ? [{ start: op.scheduledStart, end: op.scheduledEnd }]
                  : [];
            if (!segs.length) return null;
            let start = segs[0].start;
            let end = segs[0].end;
            for (const seg of segs) {
              if (seg.start < start) start = seg.start;
              if (seg.end > end) end = seg.end;
            }
            return { id: op.id, start, end };
          })
          .filter((x): x is { id: string; start: string; end: string } => x != null)
      : [];
    const { laneById, laneCount } = stackLanes
      ? assignOverlapLanes(laneItems)
      : { laneById: new Map<string, number>(), laneCount: 1 };
    const trackH = rowH * laneCount;

    for (const op of ops) {
      const lane = laneById.get(op.id) ?? 0;
      const barTop = columnFill ? lane * rowH : lane * rowH + 4;
      const barHeight = columnFill ? rowH : rowH - 8;
      const rawSegs =
        op.segments.length > 0
          ? op.segments
          : op.scheduledStart && op.scheduledEnd
            ? [{ start: op.scheduledStart, end: op.scheduledEnd }]
            : [];
      const dayPieces = rawSegs.flatMap((seg) =>
        viewMode === 'week' && weekLayout
          ? splitSegmentAcrossWeekDays(seg.start, seg.end, weekLayout)
          : [seg]
      );
      const spans =
        viewMode === 'week' && weekLayout
          ? mergeAdjacentWeekPieces(dayPieces)
          : dayPieces;

      let xLeft: number | null = null;
      let xRight: number | null = null;
      for (const seg of spans) {
        const clipped = clipSegmentToPeriod(seg.start, seg.end, from, to);
        if (!clipped) continue;
        const barLeft = leftPx(clipped.start, ...posArgs);
        const barW = widthPx(clipped.start, clipped.end, ...posArgs);
        if (barLeft == null || barW == null || barW <= 0) continue;
        if (xLeft == null || barLeft < xLeft) xLeft = barLeft;
        const right = barLeft + barW;
        if (xRight == null || right > xRight) xRight = right;
      }
      if (xLeft == null || xRight == null) continue;

      anchors.push({
        opId: op.id,
        jobOrderId: op.jobOrderId,
        sequenceNo: op.sequenceNo ?? 0,
        scheduledStart: op.scheduledStart ?? null,
        color: colorForOp(op),
        xLeft,
        xRight,
        cy: y + barTop + barHeight / 2,
      });
    }

    y += trackH;
  }

  return anchors;
}

/** Cubic curves between consecutive stages of each job (sequence order). */
export function buildJobConnectorPaths(anchors: JobBarAnchor[]): JobConnectorPath[] {
  const byJob = new Map<string, JobBarAnchor[]>();
  for (const a of anchors) {
    const list = byJob.get(a.jobOrderId) || [];
    list.push(a);
    byJob.set(a.jobOrderId, list);
  }

  const paths: JobConnectorPath[] = [];
  for (const [, list] of byJob) {
    if (list.length < 2) continue;
    list.sort((a, b) => {
      if (a.sequenceNo !== b.sequenceNo) return a.sequenceNo - b.sequenceNo;
      return String(a.scheduledStart || '').localeCompare(String(b.scheduledStart || ''));
    });
    for (let i = 0; i < list.length - 1; i++) {
      const from = list[i];
      const to = list[i + 1];
      const x1 = from.xRight;
      const y1 = from.cy;
      const x2 = to.xLeft;
      const y2 = to.cy;
      const dx = Math.max(28, Math.min(96, Math.abs(x2 - x1) * 0.4 + 16));
      const d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + dx).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
      paths.push({
        key: `${from.opId}->${to.opId}`,
        d,
        color: from.color || to.color || '#64748b',
      });
    }
  }
  return paths;
}

export function tracksBlockHeight(
  rows: RowLike[],
  opsForRow: (row: RowLike) => ScheduleBoardOperation[],
  rowH: number
): number {
  let y = 0;
  for (const row of rows) {
    if (row.group) y += SCHEDULE_GROUP_HEADER_H;
    const ops = opsForRow(row);
    if (!row.noMachine) {
      y += rowH;
      continue;
    }
    const laneItems = ops
      .map((op) => {
        const segs =
          op.segments.length > 0
            ? op.segments
            : op.scheduledStart && op.scheduledEnd
              ? [{ start: op.scheduledStart, end: op.scheduledEnd }]
              : [];
        if (!segs.length) return null;
        let start = segs[0].start;
        let end = segs[0].end;
        for (const seg of segs) {
          if (seg.start < start) start = seg.start;
          if (seg.end > end) end = seg.end;
        }
        return { id: op.id, start, end };
      })
      .filter((x): x is { id: string; start: string; end: string } => x != null);
    const { laneCount } = assignOverlapLanes(laneItems);
    y += rowH * laneCount;
  }
  return y;
}
