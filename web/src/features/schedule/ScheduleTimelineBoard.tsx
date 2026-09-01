import { useMemo } from 'react';
import { Tooltip } from 'antd';
import type { Dayjs } from 'dayjs';
import type {
  ScheduleBoardDowntime,
  ScheduleBoardOperation,
  ShopDayWindow,
} from '../../api/schedule.api';
import { formatShopDateTime } from '../../utils/shopTime';
import {
  HOUR_END,
  HOUR_START,
  TIMELINE_BORDER,
  TIMELINE_NAVY,
  WORKING_HOURS_NOTE,
  buildWeekTimelineLayout,
  dayColumnsForView,
  defaultShopDayWindows,
  leftPx,
  pxPerHour,
  timelineWidth,
  widthPx,
  type TimelineViewMode,
} from './scheduleTimelineUtils';

export type TimelineRow = {
  key: string;
  label: string;
  group?: string;
  machineUnitId?: string | null;
  workerId?: string | null;
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

function statusLabel(s: string) {
  if (s === 'REWORK') return 'Redo';
  if (s === 'IN_PROGRESS') return 'In progress';
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
}

function segmentsForOp(op: ScheduleBoardOperation) {
  if (op.segments?.length) return op.segments;
  if (op.scheduledStart && op.scheduledEnd) {
    return [{ start: op.scheduledStart, end: op.scheduledEnd }];
  }
  return [];
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
  isMobile?: boolean;
  maxHeight?: string;
  onOperationClick?: (op: ScheduleBoardOperation) => void;
  footerNote?: string;
  showLegend?: boolean;
  shopDayWindows?: ShopDayWindow[];
};

export default function ScheduleTimelineBoard({
  from,
  to,
  viewMode = 'week',
  rows,
  operations,
  downtimes = [],
  rowMode = 'machine',
  highlightJobId,
  isMobile = false,
  maxHeight,
  onOperationClick,
  footerNote,
  showLegend = false,
  shopDayWindows,
}: Props) {
  const labelW = isMobile ? 96 : 168;
  const rowH = isMobile ? 36 : 40;
  const weekLayout = useMemo(() => {
    if (viewMode !== 'week') return null;
    const windows =
      shopDayWindows && shopDayWindows.length > 0
        ? shopDayWindows
        : defaultShopDayWindows(from, to);
    return buildWeekTimelineLayout(from, to, windows, isMobile);
  }, [viewMode, shopDayWindows, from, to, isMobile]);
  const boardW = timelineWidth(from, to, viewMode, isMobile, weekLayout);
  const dayColumns = dayColumnsForView(from, to, viewMode, isMobile, weekLayout);
  const pph = pxPerHour(viewMode, isMobile);
  const planningHighlight = Boolean(highlightJobId);
  const columnFill = viewMode === 'week' || viewMode === 'month';
  const posArgs = [from, viewMode, isMobile, weekLayout] as const;

  const opsForRow = (row: TimelineRow): ScheduleBoardOperation[] => {
    if (rowMode === 'worker') {
      return operations.filter((o) => o.assignedWorkerId === row.workerId);
    }
    if (row.noMachine) {
      return operations.filter((o) => !o.machineUnitId);
    }
    return operations.filter((o) => o.machineUnitId === row.machineUnitId);
  };

  const downtimesForRow = (row: TimelineRow) => {
    if (rowMode !== 'machine' || !row.machineUnitId) return [];
    return downtimes.filter((d) => d.machineUnitId === row.machineUnitId);
  };

  const rowHasHighlight = (row: TimelineRow) => {
    if (!highlightJobId) return false;
    return opsForRow(row).some((op) => op.jobOrderId === highlightJobId);
  };

  return (
    <div
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
      <div style={{ minWidth: labelW + boardW }}>
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

        {rows.map((row) => {
          const ops = opsForRow(row);
          const dts = downtimesForRow(row);
          const focused = rowHasHighlight(row);
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
                  minHeight: rowH,
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
                  }}
                >
                  {row.label}
                </div>
                <div
                  style={{
                    position: 'relative',
                    width: boardW,
                    minHeight: rowH,
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

                  {dts.map((d) => (
                    <Tooltip
                      key={d.id}
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
                          height: columnFill ? rowH : rowH - 8,
                          left: leftPx(d.segmentStart, ...posArgs),
                          width: widthPx(
                            d.segmentStart,
                            d.segmentEnd,
                            ...posArgs
                          ),
                          background:
                            'repeating-linear-gradient(-45deg, #fecaca, #fecaca 4px, #fee2e2 4px, #fee2e2 8px)',
                          border: '1px solid #f87171',
                          borderRadius: columnFill ? 0 : 4,
                          opacity: 0.9,
                          zIndex: 1,
                        }}
                      />
                    </Tooltip>
                  ))}

                  {ops.flatMap((op) =>
                    segmentsForOp(op).map((seg, i) => {
                      const isThisJob =
                        planningHighlight && op.jobOrderId === highlightJobId;
                      const barW = widthPx(seg.start, seg.end, ...posArgs);
                      const color = isThisJob
                        ? THIS_JOB_COLOR
                        : planningHighlight
                          ? OTHER_JOB_COLOR
                          : STATUS_COLOR[op.status] || '#2563eb';
                      const late = !!op.isLate;
                      const label =
                        isThisJob && barW >= 28
                          ? isMobile
                            ? op.operationName
                            : `${op.operationName}${op.jobNumber ? ` · ${op.jobNumber}` : ''}`
                          : !planningHighlight
                            ? isMobile
                              ? op.operationName
                              : `${op.operationName}${op.jobNumber ? ` · ${op.jobNumber}` : ''}`
                            : '';

                      const tooltip = (
                        <div style={{ maxWidth: 260 }}>
                          <div style={{ fontWeight: 700 }}>{op.operationName}</div>
                          {(op.jobNumber || op.jobTitle) && (
                            <div>
                              {op.jobNumber}
                              {op.jobTitle ? ` · ${op.jobTitle}` : ''}
                            </div>
                          )}
                          {op.clientName ? <div>Client: {op.clientName}</div> : null}
                          {op.assignedWorkerName ? (
                            <div>Worker: {op.assignedWorkerName}</div>
                          ) : null}
                          <div>
                            {formatShopDateTime(seg.start)} → {formatShopDateTime(seg.end)}
                          </div>
                          {!planningHighlight && (
                            <div>Status: {statusLabel(op.status)}</div>
                          )}
                          {late ? (
                            <div style={{ color: '#fecaca' }}>
                              At risk of missing date required ({op.dueDate || '—'})
                            </div>
                          ) : null}
                        </div>
                      );

                      const barStyle = {
                        position: 'absolute' as const,
                        top: columnFill ? 0 : 5,
                        height: columnFill ? rowH : rowH - 10,
                        left: leftPx(seg.start, ...posArgs),
                        width: barW,
                        background: color,
                        border: columnFill
                          ? 'none'
                          : isThisJob
                            ? '2px solid #1d4ed8'
                            : late
                              ? '2px solid #dc2626'
                              : planningHighlight
                                ? '1px solid #cbd5e1'
                                : 'none',
                        borderRadius: columnFill ? 0 : 4,
                        color: isThisJob || !planningHighlight ? '#fff' : '#475569',
                        fontSize: isMobile ? 9 : 10,
                        fontWeight: 700,
                        overflow: 'hidden',
                        whiteSpace: 'nowrap' as const,
                        textOverflow: 'ellipsis',
                        padding: columnFill ? '0 6px' : '0 4px',
                        cursor: onOperationClick ? 'pointer' : 'default',
                        textAlign: 'left' as const,
                        zIndex: isThisJob ? 3 : 2,
                        boxShadow: columnFill
                          ? isThisJob
                            ? 'inset 0 0 0 2px #1d4ed8'
                            : late
                              ? 'inset 0 0 0 2px #dc2626'
                              : undefined
                          : late
                            ? '0 0 0 1px rgba(220,38,38,0.35)'
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
                              {label}
                            </button>
                          ) : (
                            <div style={barStyle}>{label}</div>
                          )}
                        </Tooltip>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          );
        })}
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
              <span className="jo-week-view__legend-swatch jo-week-view__legend-swatch--this" />
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
