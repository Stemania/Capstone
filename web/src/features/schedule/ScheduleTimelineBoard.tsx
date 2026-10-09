import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Tooltip } from 'antd';
import type { Dayjs } from 'dayjs';
import {
  crewIdsOf,
  type ScheduleBoardDowntime,
  type ScheduleBoardOperation,
  type ShopDayWindow,
} from '../../api/schedule.api';
import { formatShopDateTime } from '../../utils/shopTime';
import { adminPx } from '../../theme/adminTheme';
import { PersonAvatar, crewNames } from '../../components/PersonAvatar';
import { personLabel } from '../../utils/people';
import {
  HOUR_END,
  HOUR_START,
  TIMELINE_BORDER,
  TIMELINE_NAVY,
  WORKING_HOURS_NOTE,
  assignOverlapLanes,
  buildWeekTimelineLayout,
  clipSegmentToPeriod,
  dayColumnsForView,
  defaultShopDayWindows,
  leftPx,
  pxPerHour,
  fitDayPxPerHour,
  scaleWeekTimelineLayout,
  scheduleBarLabelParts,
  scheduleBarTextStyle,
  scheduleOpTitle,
  SCHEDULE_BAR_LABEL_SPAN_STYLE,
  SCHEDULE_BAR_META_STYLE,
  MATERIAL_WAIT_BAR_IMAGE,
  SCHEDULE_BAR_TITLE_STYLE,
  mergeAdjacentWeekPieces,
  splitSegmentAcrossWeekDays,
  timelineWidth,
  widthPx,
  type TimelineViewMode,
  type WeekTimelineLayout,
} from './scheduleTimelineUtils';

export type TimelineRow = {
  key: string;
  label: string;
  group?: string;
  machineUnitId?: string | null;
  workerId?: string | null;
  personName?: string;
  photoVersion?: number | null;
  noMachine?: boolean;
};

const STATUS_COLOR: Record<string, string> = {
  SCHEDULED: '#2563eb',
  IN_PROGRESS: '#0d9488',
  COMPLETED: '#64748b',
  REWORK: '#d97706',
  PENDING: '#94a3b8',
};

const OTHER_JOB_COLOR = '#e2e8f0';
const THIS_JOB_COLOR = '#2563eb';
const NO_MACHINE_KEY = '__none__';
const EMPTY: never[] = [];

function groupBy<T>(items: T[], keyOf: (item: T) => string | null | undefined) {
  const map = new Map<string | null | undefined, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function statusLabel(s: string) {
  if (s === 'REWORK') return 'Redo';
  if (s === 'IN_PROGRESS') return 'In progress';
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
}

function segmentsForOp(
  op: ScheduleBoardOperation,
  weekLayout?: WeekTimelineLayout | null
) {
  const raw =
    op.segments?.length
      ? op.segments
      : op.scheduledStart && op.scheduledEnd
        ? [{ start: op.scheduledStart, end: op.scheduledEnd }]
        : [];
  if (!weekLayout || raw.length === 0) return raw;
  // Per-day working pieces, then merge overnight neighbors into one bar.
  const pieces = raw.flatMap((seg) =>
    splitSegmentAcrossWeekDays(seg.start, seg.end, weekLayout)
  );
  return mergeAdjacentWeekPieces(pieces);
}

type Props = {
  from: Dayjs;
  to: Dayjs;
  viewMode?: TimelineViewMode;
  rows: TimelineRow[];
  operations: ScheduleBoardOperation[];
  downtimes?: ScheduleBoardDowntime[];
  rowMode?: 'machine' | 'worker';
  highlightJobId?: string;
  /** Bar color for highlightJobId when set (planning week view). */
  highlightColor?: string | null;
  isMobile?: boolean;
  maxHeight?: string;
  onOperationClick?: (op: ScheduleBoardOperation) => void;
  footerNote?: string;
  showLegend?: boolean;
  shopDayWindows?: ShopDayWindow[];
};

export default memo(ScheduleTimelineBoard);

function ScheduleTimelineBoard({
  from,
  to,
  viewMode = 'week',
  rows,
  operations,
  downtimes = [],
  rowMode = 'machine',
  highlightJobId,
  highlightColor,
  isMobile = false,
  maxHeight,
  onOperationClick,
  footerNote,
  showLegend = false,
  shopDayWindows,
}: Props) {
  const labelW = isMobile ? adminPx(96) : adminPx(168);
  const rowH = isMobile ? adminPx(40) : adminPx(44);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [availW, setAvailW] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // A kept-alive page hidden with display:none reports 0; keep the last real width.
    const measure = () => {
      if (el.clientWidth > 0) setAvailW(el.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const naturalWeekLayout = useMemo(() => {
    if (viewMode !== 'week') return null;
    const windows =
      shopDayWindows && shopDayWindows.length > 0
        ? shopDayWindows
        : defaultShopDayWindows(from, to);
    return buildWeekTimelineLayout(from, to, windows, isMobile);
  }, [viewMode, shopDayWindows, from, to, isMobile]);

  const weekLayout = useMemo(() => {
    if (!naturalWeekLayout) return null;
    const target = Math.max(naturalWeekLayout.totalWidth, Math.max(0, availW - labelW));
    return scaleWeekTimelineLayout(naturalWeekLayout, target);
  }, [naturalWeekLayout, availW, labelW]);

  const dayHourPx = useMemo(() => {
    if (viewMode !== 'day') return undefined;
    return fitDayPxPerHour(isMobile, Math.max(0, availW - labelW));
  }, [viewMode, isMobile, availW, labelW]);

  const boardW = timelineWidth(from, to, viewMode, isMobile, weekLayout, dayHourPx);
  const dayColumns = dayColumnsForView(from, to, viewMode, isMobile, weekLayout, dayHourPx);
  const pph = dayHourPx ?? pxPerHour(viewMode, isMobile);
  const planningHighlight = Boolean(highlightJobId);
  const columnFill = true;
  const posArgs = [from, viewMode, isMobile, weekLayout, dayHourPx] as const;

  const opsByRowKey = useMemo(() => {
    if (rowMode !== 'worker') {
      return groupBy(operations, (o) => o.machineUnitId || NO_MACHINE_KEY);
    }
    const map = new Map<string | null | undefined, ScheduleBoardOperation[]>();
    for (const o of operations) {
      for (const wid of crewIdsOf(o)) {
        const list = map.get(wid);
        if (list) list.push(o);
        else map.set(wid, [o]);
      }
    }
    return map;
  }, [operations, rowMode]);
  const downtimesByUnit = useMemo(
    () => groupBy(downtimes, (d) => d.machineUnitId),
    [downtimes]
  );

  const opsForRow = (row: TimelineRow): ScheduleBoardOperation[] => {
    if (rowMode === 'worker') return opsByRowKey.get(row.workerId) ?? EMPTY;
    if (row.noMachine) return opsByRowKey.get(NO_MACHINE_KEY) ?? EMPTY;
    return opsByRowKey.get(row.machineUnitId) ?? EMPTY;
  };

  const downtimesForRow = (row: TimelineRow) => {
    if (rowMode !== 'machine' || !row.machineUnitId) return EMPTY;
    return downtimesByUnit.get(row.machineUnitId) ?? EMPTY;
  };

  const rowHasHighlight = (row: TimelineRow) => {
    if (!highlightJobId) return false;
    return opsForRow(row).some((op) => op.jobOrderId === highlightJobId);
  };

  return (
    <div
      ref={scrollRef}
      className="sched-timeline"
      style={{
        border: `1px solid ${TIMELINE_BORDER}`,
        borderRadius: 10,
        background: '#fff',
        overflow: 'auto',
        ...(maxHeight ? { maxHeight } : {}),
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div style={{ minWidth: labelW + boardW, width: '100%' }}>
        <div
          style={{
            display: 'flex',
            position: 'sticky',
            top: 0,
            zIndex: 3,
            background: '#f8fafc',
          }}
        >
          <div
            style={{
              width: labelW,
              flexShrink: 0,
              position: 'sticky',
              left: 0,
              zIndex: 4,
              background: '#f8fafc',
              borderBottom: `1px solid ${TIMELINE_BORDER}`,
              borderRight: `1px solid ${TIMELINE_BORDER}`,
              padding: '8px 8px',
              fontSize: 11,
              fontWeight: 700,
              color: '#64748b',
            }}
          >
            {rowMode === 'machine' ? 'Machine' : 'Worker'}
          </div>
          <div
            style={{
              position: 'relative',
              width: boardW,
              height: 36,
              borderBottom: `1px solid ${TIMELINE_BORDER}`,
            }}
          >
            {dayColumns.map((col, i) => (
                <div
                  key={col.key}
                  style={{
                    position: 'absolute',
                    left: col.left,
                    width: col.width,
                    top: 0,
                    bottom: 0,
                    borderLeft: i === 0 ? 'none' : `1px solid ${TIMELINE_BORDER}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: isMobile ? 10 : 11,
                    fontWeight: 600,
                    color: '#475569',
                  }}
                >
                  {col.label}
                </div>
              ))}
          </div>
        </div>

        <div style={{ position: 'relative' }}>
        {rows.map((row) => {
          const ops = opsForRow(row);
          const dts = downtimesForRow(row);
          const focused = rowHasHighlight(row);
          const stackLanes = Boolean(row.noMachine);
          const laneItems = stackLanes
            ? ops
                .map((op) => {
                  const segs = segmentsForOp(op, weekLayout);
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

          return (
            <div key={row.key}>
              {row.group ? (
                <div
                  style={{
                    position: 'sticky',
                    left: 0,
                    zIndex: 2,
                    background: '#f1f5f9',
                    padding: '4px 8px',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 0.5,
                    textTransform: 'uppercase',
                    color: '#94a3b8',
                    borderBottom: `1px solid ${TIMELINE_BORDER}`,
                  }}
                >
                  {row.group}
                </div>
              ) : null}
              <div
                style={{
                  display: 'flex',
                  minHeight: trackH,
                  borderBottom: '1px solid #f1f5f9',
                  background: focused ? '#f0f9ff' : undefined,
                }}
              >
                <div
                  style={{
                    width: labelW,
                    flexShrink: 0,
                    position: 'sticky',
                    left: 0,
                    zIndex: 2,
                    background: focused ? '#f0f9ff' : '#fff',
                    borderRight: `1px solid ${TIMELINE_BORDER}`,
                    padding: '6px 8px',
                    fontSize: isMobile ? 11 : 12,
                    fontWeight: focused ? 700 : 600,
                    color: row.noMachine ? '#64748b' : TIMELINE_NAVY,
                    display: 'flex',
                    alignItems: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minHeight: trackH,
                    gap: 6,
                  }}
                >
                  {row.workerId && row.personName ? (
                    <PersonAvatar
                      userId={row.workerId}
                      fullName={row.personName}
                      photoVersion={row.photoVersion}
                      size={isMobile ? 20 : 24}
                    />
                  ) : null}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.label}</span>
                </div>
                <div
                  style={{
                    position: 'relative',
                    width: boardW,
                    minHeight: trackH,
                    height: trackH,
                    backgroundImage:
                      viewMode === 'day'
                        ? `repeating-linear-gradient(90deg, transparent, transparent ${pph - 1}px, #f1f5f9 ${pph - 1}px, #f1f5f9 ${pph}px)`
                        : undefined,
                  }}
                >
                  {dayColumns.map((col, i) => (
                    <div
                      key={col.key}
                      style={{
                        position: 'absolute',
                        left: col.left,
                        top: 0,
                        bottom: 0,
                        width: 1,
                        background: i === 0 ? 'transparent' : '#f1f5f9',
                      }}
                    />
                  ))}

                  {laneCount > 1
                    ? Array.from({ length: laneCount - 1 }, (_, i) => (
                        <div
                          key={`lane-rule-${i}`}
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            top: rowH * (i + 1),
                            height: 1,
                            background: '#e2e8f0',
                            zIndex: 0,
                            pointerEvents: 'none',
                          }}
                        />
                      ))
                    : null}

                  {dts.flatMap((d) => {
                    const pieces =
                      weekLayout
                        ? mergeAdjacentWeekPieces(
                            splitSegmentAcrossWeekDays(
                              d.segmentStart,
                              d.segmentEnd,
                              weekLayout
                            )
                          )
                        : [{ start: d.segmentStart, end: d.segmentEnd }];
                    return pieces.flatMap((seg) => {
                    const clipped = clipSegmentToPeriod(
                      seg.start,
                      seg.end,
                      from,
                      to
                    );
                    if (!clipped) return [];
                    const barLeft = leftPx(clipped.start, ...posArgs);
                    const barW = widthPx(clipped.start, clipped.end, ...posArgs);
                    if (barLeft == null || barW == null || barW <= 0) return [];
                    return [
                      <Tooltip
                        key={`${d.id}-${clipped.start}`}
                        title={
                          <div>
                            <div style={{ fontWeight: 600 }}>Machine breakdown</div>
                            <div>{d.reason}</div>
                            <div>
                              {formatShopDateTime(d.startedAt)} →{' '}
                              {d.open ? 'still down' : formatShopDateTime(d.endedAt)}
                            </div>
                          </div>
                        }
                      >
                        <div
                          style={{
                            position: 'absolute',
                            top: columnFill ? 0 : 4,
                            height: columnFill ? trackH : trackH - 8,
                            left: barLeft,
                            width: barW,
                            background:
                              'repeating-linear-gradient(-45deg, #E8C5CB, #E8C5CB 4px, #F5E6E9 4px, #F5E6E9 8px)',
                            border: '1px solid #C45A6A',
                            borderRadius: columnFill ? 0 : 4,
                            opacity: 0.9,
                            zIndex: 1,
                          }}
                        />
                      </Tooltip>,
                    ];
                    });
                  })}

                  {ops.flatMap((op) => {
                    const lane = laneById.get(op.id) ?? 0;
                    const barTop = columnFill ? lane * rowH : lane * rowH + 4;
                    const barHeight = columnFill ? rowH : rowH - 8;

                    return segmentsForOp(op, weekLayout).flatMap((seg, i) => {
                      const clipped = clipSegmentToPeriod(seg.start, seg.end, from, to);
                      if (!clipped) return [];
                      const barLeft = leftPx(clipped.start, ...posArgs);
                      const barW = widthPx(clipped.start, clipped.end, ...posArgs);
                      if (barLeft == null || barW == null || barW <= 0) return [];

                      const isThisJob =
                        planningHighlight && op.jobOrderId === highlightJobId;
                      const color = isThisJob
                        ? highlightColor || op.scheduleColor || THIS_JOB_COLOR
                        : planningHighlight
                          ? OTHER_JOB_COLOR
                          : op.scheduleColor || STATUS_COLOR[op.status] || '#2563eb';
                      const late = !!op.isLate;
                      const showLabel =
                        barW >= 22 &&
                        (isThisJob || !planningHighlight);
                      const label = showLabel
                        ? scheduleBarLabelParts(
                            op.operationName,
                            op.jobNumber,
                            op.clientName,
                            barW,
                            isMobile,
                            op.sequenceNo
                          )
                        : null;
                      const textStyle = scheduleBarTextStyle({
                        mobile: isMobile,
                        barWidthPx: barW,
                        columnFill,
                      });
                      const metaFontSize = Math.max(
                        9,
                        Math.round((textStyle.fontSize as number) * 0.88)
                      );

                      const tooltip = (
                        <div style={{ maxWidth: 260 }}>
                          <div style={{ fontWeight: 700 }}>
                            {scheduleOpTitle(op.sequenceNo, op.operationName)}
                          </div>
                          {(op.jobNumber || op.jobTitle) && (
                            <div>
                              {op.jobNumber}
                              {op.jobTitle ? ` · ${op.jobTitle}` : ''}
                            </div>
                          )}
                          {op.clientName ? <div>Client: {op.clientName}</div> : null}
                          {op.assignedWorkerName || op.crew?.length ? (
                            <div>
                              {(op.crew?.length || 0) > 1 ? 'Crew' : 'Worker'}:{' '}
                              {crewNames(
                                op.crew,
                                personLabel(op.assignedWorkerName, op.assignedWorkerNickname),
                              )}
                            </div>
                          ) : null}
                          <div>
                            {formatShopDateTime(seg.start)} → {formatShopDateTime(seg.end)}
                          </div>
                          {!planningHighlight && (
                            <div>Status: {statusLabel(op.status)}</div>
                          )}
                          {op.waitingForMaterials ? (
                            <div style={{ color: '#FCD34D' }}>
                              Waiting for materials: {op.materialWaitReason}
                            </div>
                          ) : null}
                          {late ? (
                            <div style={{ color: '#E8C5CB' }}>
                              At risk of missing date required ({op.dueDate || '—'})
                            </div>
                          ) : null}
                        </div>
                      );

                      const labelNode = label ? (
                        <span style={SCHEDULE_BAR_LABEL_SPAN_STYLE}>
                          <span style={SCHEDULE_BAR_TITLE_STYLE}>{label.title}</span>
                          {label.meta ? (
                            <span
                              style={{
                                ...SCHEDULE_BAR_META_STYLE,
                                fontSize: metaFontSize,
                              }}
                            >
                              {label.meta}
                            </span>
                          ) : null}
                        </span>
                      ) : null;

                      const barStyle = {
                        position: 'absolute' as const,
                        top: barTop,
                        height: barHeight,
                        left: barLeft,
                        width: barW,
                        background: color,
                        backgroundImage:
                          op.waitingForMaterials && (isThisJob || !planningHighlight)
                            ? MATERIAL_WAIT_BAR_IMAGE
                            : undefined,
                        border: columnFill
                          ? 'none'
                          : isThisJob
                            ? '2px solid #1d4ed8'
                            : late
                              ? '2px solid #7A1528'
                              : planningHighlight
                                ? '1px solid #cbd5e1'
                                : 'none',
                        borderRadius: columnFill ? 0 : 4,
                        color: isThisJob || !planningHighlight ? '#fff' : '#475569',
                        ...textStyle,
                        cursor: onOperationClick ? 'pointer' : 'default',
                        zIndex: isThisJob ? 3 : 2,
                        boxShadow: columnFill
                          ? isThisJob
                            ? 'inset 0 0 0 2px #1d4ed8'
                            : late
                              ? 'inset 0 0 0 2px #7A1528'
                              : undefined
                          : late
                            ? '0 0 0 1px rgba(122,21,40,0.35)'
                            : undefined,
                      };

                      return (
                        <Tooltip key={`${op.id}-${i}`} title={tooltip}>
                          {onOperationClick ? (
                            <button
                              type="button"
                              onClick={() => onOperationClick(op)}
                              style={barStyle}
                            >
                              {labelNode}
                            </button>
                          ) : (
                            <div style={barStyle}>{labelNode}</div>
                          )}
                        </Tooltip>
                      );
                    });
                  })}
                </div>
              </div>
            </div>
          );
        })}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '8px 12px',
          borderTop: `1px solid ${TIMELINE_BORDER}`,
          background: '#fafafa',
        }}
      >
        {showLegend ? (
          <div className="jo-week-view__legend">
            <span className="jo-week-view__legend-item">
              <span
                className="jo-week-view__legend-swatch jo-week-view__legend-swatch--this"
                style={
                  highlightColor
                    ? { background: highlightColor, borderColor: highlightColor }
                    : undefined
                }
              />
              This job (labelled)
            </span>
            <span className="jo-week-view__legend-item">
              <span className="jo-week-view__legend-swatch jo-week-view__legend-swatch--other" />
              Other scheduled work
            </span>
            <span className="jo-week-view__legend-item">
              <span className="jo-week-view__legend-swatch jo-week-view__legend-swatch--breakdown" />
              Machine breakdown
            </span>
          </div>
        ) : (
          <span />
        )}
        <span style={{ fontSize: 11, color: '#94a3b8' }}>
          {footerNote ||
            (viewMode === 'week' && weekLayout
              ? `${WORKING_HOURS_NOTE} Scroll sideways for more detail.`
              : `${HOUR_START}:00–${HOUR_END}:00. Scroll sideways for more detail.`)}
        </span>
      </div>
    </div>
  );
}
