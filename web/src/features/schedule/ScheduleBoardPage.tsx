import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Drawer,
  Grid,
  Select,
  Segmented,
  Spin,
  Switch,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  LeftOutlined,
  RightOutlined,
  AimOutlined,
  FilterOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import {
  scheduleApi,
  type ScheduleBoardDowntime,
  type ScheduleBoardOperation,
  type ScheduleBoardResponse,
} from '../../api/schedule.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useOverdueCheck } from '../../hooks/useOverdueCheck';
import { adminPx } from '../../theme/adminTheme';
import {
  HOUR_END,
  HOUR_START,
  TIMELINE_BORDER as BORDER,
  TIMELINE_NAVY as NAVY,
  WORKING_HOURS_NOTE,
  assignOverlapLanes,
  buildWeekTimelineLayout,
  clipSegmentToPeriod,
  dayColumnsForView,
  defaultShopDayWindows,
  leftPx,
  periodBounds,
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
import { formatShopDateTime, SHOP_TZ } from '../../utils/shopTime';
import ScheduleExpandShell from './ScheduleExpandShell';
import WorkerPersonalSchedule from './WorkerPersonalSchedule';

const { Text } = Typography;

type ViewMode = TimelineViewMode;
type RowMode = 'machine' | 'worker';

const STATUS_COLOR: Record<string, string> = {
  SCHEDULED: '#2563eb',
  IN_PROGRESS: '#0d9488',
  COMPLETED: '#64748b',
  REWORK: '#d97706',
  PENDING: '#94a3b8',
};

function statusLabel(s: string) {
  if (s === 'REWORK') return 'Redo';
  if (s === 'IN_PROGRESS') return 'In progress';
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
}

type RowDef = {
  key: string;
  label: string;
  group?: string;
  machineUnitId?: string | null;
  workerId?: string | null;
  noMachine?: boolean;
};

const NO_MACHINE_KEY = '__none__';
const NO_OPS: ScheduleBoardOperation[] = [];
const NO_DOWNTIMES: ScheduleBoardDowntime[] = [];

function opGroupKey(op: ScheduleBoardOperation, rowMode: RowMode) {
  return rowMode === 'worker' ? op.assignedWorkerId : op.machineUnitId || NO_MACHINE_KEY;
}

function rowGroupKey(row: RowDef, rowMode: RowMode) {
  if (rowMode === 'worker') return row.workerId;
  return row.noMachine ? NO_MACHINE_KEY : row.machineUnitId;
}

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

export default function ScheduleBoardPage() {
  const { isWorker } = useAuth();
  if (isWorker) return <WorkerPersonalSchedule />;
  return <AdminOfficeScheduleBoard />;
}

function AdminOfficeScheduleBoard() {
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const labelW = isMobile ? adminPx(96) : adminPx(168);
  const rowH = isMobile ? adminPx(40) : adminPx(44);
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [rowMode, setRowMode] = useState<RowMode>('machine');
  const [anchor, setAnchor] = useState(() => dayjs().tz(SHOP_TZ));
  const [includeCompleted, setIncludeCompleted] = useState(true);
  const [machineTypeId, setMachineTypeId] = useState<string | undefined>();
  const [workerId, setWorkerId] = useState<string | undefined>();
  const [clientId, setClientId] = useState<string | undefined>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [data, setData] = useState<ScheduleBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const { from, to } = useMemo(() => periodBounds(anchor, viewMode), [anchor, viewMode]);
  const overdueChecked = useOverdueCheck();

  useEffect(() => {
    if (!overdueChecked) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await scheduleApi.board({
          from: from.format('YYYY-MM-DD'),
          to: to.format('YYYY-MM-DD'),
          machineTypeId,
          workerId,
          clientId,
          includeCompleted,
        });
        if (!cancelled) setData(res.data);
      } catch (err) {
        if (!cancelled) message.error(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to, machineTypeId, workerId, clientId, includeCompleted, overdueChecked]);

  const machineTypes = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of data?.machineUnits || []) {
      if (u.machineTypeId) {
        map.set(u.machineTypeId, u.machineTypeName || u.machineTypeCode || u.machineTypeId);
      }
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [data]);

  const rows: RowDef[] = useMemo(() => {
    if (!data) return [];
    if (rowMode === 'worker') {
      return data.workers.map((w) => ({
        key: w.id,
        label: w.fullName,
        workerId: w.id,
      }));
    }
    const out: RowDef[] = [];
    let lastType = '';
    const sorted = [...data.machineUnits].sort((a, b) => {
      const ta = a.machineTypeName || a.machineTypeCode || '';
      const tb = b.machineTypeName || b.machineTypeCode || '';
      if (ta !== tb) return ta.localeCompare(tb);
      return a.label.localeCompare(b.label);
    });
    for (const u of sorted) {
      const group = u.machineTypeName || u.machineTypeCode || 'Machines';
      out.push({
        key: u.id,
        label: u.label,
        group: group !== lastType ? group : undefined,
        machineUnitId: u.id,
      });
      lastType = group;
    }
    out.push({ key: '__none__', label: 'No machine', noMachine: true });
    return out;
  }, [data, rowMode]);

  const shiftPeriod = (dir: -1 | 1) => {
    if (viewMode === 'day') setAnchor((a) => a.add(dir, 'day'));
    else if (viewMode === 'week') setAnchor((a) => a.add(dir * 7, 'day'));
    else setAnchor((a) => a.add(dir, 'month'));
  };

  const clearBoardFilters = () => {
    setMachineTypeId(undefined);
    setClientId(undefined);
    setWorkerId(undefined);
    setIncludeCompleted(true);
  };

  const opsByRowKey = useMemo(
    () => groupBy(data?.operations ?? NO_OPS, (o) => opGroupKey(o, rowMode)),
    [data, rowMode]
  );
  const downtimesByUnit = useMemo(
    () => groupBy(data?.downtimes ?? NO_DOWNTIMES, (d) => d.machineUnitId),
    [data]
  ) as Map<string, ScheduleBoardDowntime[]>;

  // navigate changes identity on every route change; keep the bars' click handler stable.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const openJob = useCallback(
    (jobOrderId: string) => navigateRef.current(`/job-orders/${jobOrderId}`),
    []
  );

  const summary = data?.summary;
  const isPhoneBoard = isMobile;
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const [boardAvailW, setBoardAvailW] = useState(0);

  useEffect(() => {
    const el = boardScrollRef.current;
    if (!el) return;
    // A kept-alive page hidden with display:none reports 0; keep the last real width.
    const measure = () => {
      if (el.clientWidth > 0) setBoardAvailW(el.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading, data]);

  const naturalWeekLayout = useMemo(() => {
    if (viewMode !== 'week') return null;
    const windows =
      data?.shopDayWindows && data.shopDayWindows.length > 0
        ? data.shopDayWindows
        : defaultShopDayWindows(from, to);
    return buildWeekTimelineLayout(from, to, windows, isMobile);
  }, [viewMode, data?.shopDayWindows, from, to, isMobile]);

  const weekLayout = useMemo(() => {
    if (!naturalWeekLayout) return null;
    const target = Math.max(naturalWeekLayout.totalWidth, Math.max(0, boardAvailW - labelW));
    return scaleWeekTimelineLayout(naturalWeekLayout, target);
  }, [naturalWeekLayout, boardAvailW, labelW]);

  const dayHourPx = useMemo(() => {
    if (viewMode !== 'day') return undefined;
    return fitDayPxPerHour(isMobile, Math.max(0, boardAvailW - labelW));
  }, [viewMode, isMobile, boardAvailW, labelW]);

  const boardW = timelineWidth(from, to, viewMode, isMobile, weekLayout, dayHourPx);
  const dayColumns = useMemo(
    () => dayColumnsForView(from, to, viewMode, isMobile, weekLayout, dayHourPx),
    [from, to, viewMode, isMobile, weekLayout, dayHourPx]
  );
  const pph = dayHourPx ?? pxPerHour(viewMode, isMobile);
  const boardCollapsedMaxHeight = isPhoneBoard
      ? 'calc(100dvh - 340px)'
      : isMobile
        ? 'calc(100dvh - 260px)'
        : 'calc(100vh - 280px)';
  const today = dayjs().tz(SHOP_TZ).startOf('day');
  const showingToday = !today.isBefore(from, 'day') && !today.isAfter(to, 'day');
  const nearFull = summary?.machinesNearFullCapacity || [];
  const atRiskCount = summary?.jobsAtRisk?.length ?? 0;
  const waitingJobs = useMemo(() => {
    const seen = new Map<string, string>();
    for (const op of data?.operations || []) {
      if (op.waitingForMaterials && !seen.has(op.jobOrderId)) {
        seen.set(op.jobOrderId, op.jobNumber || op.jobTitle || op.jobOrderId.slice(0, 8));
      }
    }
    return [...seen.values()];
  }, [data]);
  const activeFilterCount =
    [machineTypeId, workerId, clientId].filter(Boolean).length + (includeCompleted ? 0 : 1);

  const periodLabel =
    viewMode === 'day'
      ? from.format('ddd, MMM D')
      : viewMode === 'month'
        ? from.format('MMMM YYYY')
        : `${from.format('MMM D')} – ${to.format('MMM D')}`;

  const filterSelects = (
    <>
      {!isPhoneBoard && (
        <Segmented
          block={isMobile}
          value={rowMode}
          onChange={(v) => setRowMode(v as RowMode)}
          options={[
            { label: 'By machine', value: 'machine' },
            { label: 'By worker', value: 'worker' },
          ]}
        />
      )}
      <Select
        allowClear
        placeholder="Machine type"
        style={{ width: isMobile ? '100%' : 160 }}
        value={machineTypeId}
        onChange={setMachineTypeId}
        options={machineTypes.map((t) => ({ value: t.id, label: t.name }))}
      />
      <Select
        allowClear
        showSearch
        optionFilterProp="label"
        placeholder="Worker"
        style={{ width: isMobile ? '100%' : 160 }}
        value={workerId}
        onChange={setWorkerId}
        options={(data?.workers || []).map((w) => ({
          value: w.id,
          label: w.fullName,
        }))}
      />
      <Select
        allowClear
        showSearch
        optionFilterProp="label"
        placeholder="Client"
        style={{ width: isMobile ? '100%' : 160 }}
        value={clientId}
        onChange={setClientId}
        options={(data?.clients || []).map((c) => ({ value: c.id, label: c.name }))}
      />
    </>
  );

  const filterToggles = (
    <>
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          whiteSpace: 'nowrap',
        }}
      >
        <Switch size="small" checked={includeCompleted} onChange={setIncludeCompleted} />
        Show completed
      </label>
    </>
  );

  const board = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: isMobile ? 10 : 12,
        minHeight: 0,
        minWidth: 0,
      }}
    >
      {isPhoneBoard ? (
        <div className="sched-m">
          <div className="sched-m__top">
            <div className="sched-m__nav">
              <button type="button" className="sched-m__icon" onClick={() => shiftPeriod(-1)} aria-label="Previous">
                <LeftOutlined />
              </button>
              <button
                type="button"
                className="sched-m__date"
                onClick={() => setAnchor(dayjs().tz(SHOP_TZ))}
                title="Jump to today"
              >
                <span className="sched-m__date-main">{periodLabel}</span>
                <span className="sched-m__date-sub">{showingToday ? 'Today' : 'Jump to today'}</span>
              </button>
              <button type="button" className="sched-m__icon" onClick={() => shiftPeriod(1)} aria-label="Next">
                <RightOutlined />
              </button>
              <Badge count={activeFilterCount} size="small" offset={[-4, 4]} className="sched-m__filter">
                <button type="button" className="sched-m__icon" onClick={() => setFiltersOpen(true)} aria-label="Filters">
                  <FilterOutlined />
                </button>
              </Badge>
            </div>
            <div className="sched-m__groups">
              <div className="sched-m__pills" role="tablist" aria-label="Period">
                {([
                  ['day', 'Day'],
                  ['week', 'Week'],
                  ['month', 'Month'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={viewMode === value}
                    className={`sched-m__pill${viewMode === value ? ' is-on' : ''}`}
                    onClick={() => setViewMode(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="sched-m__pills" role="tablist" aria-label="Rows">
                {([
                  ['machine', 'Machine'],
                  ['worker', 'Worker'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={rowMode === value}
                    className={`sched-m__pill${rowMode === value ? ' is-on' : ''}`}
                    onClick={() => setRowMode(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="sched-m__stats">
            <div className="sched-m__stat">
              <div className="sched-m__stat-n">{summary?.jobsScheduled ?? '—'}</div>
              <div className="sched-m__stat-l">JO scheduled</div>
            </div>
            <div className="sched-m__stat">
              <div className="sched-m__stat-n">{nearFull.length}</div>
              <div className="sched-m__stat-l">Near full</div>
            </div>
            <div className={`sched-m__stat${atRiskCount ? ' is-danger' : ''}`}>
              <div className="sched-m__stat-n">{atRiskCount}</div>
              <div className="sched-m__stat-l">At risk</div>
            </div>
            <div className="sched-m__stat">
              <div className="sched-m__stat-n">{waitingJobs.length}</div>
              <div className="sched-m__stat-l">No material</div>
            </div>
          </div>
          {nearFull.length ? (
            <div className="sched-m__caps">
              {nearFull.map((m) => (
                <span key={m.machineTypeId} className="sched-m__cap">
                  {m.machineTypeCode}
                  {m.projectedLoadPct != null ? ` ${m.projectedLoadPct}%` : ''}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: isMobile ? 'stretch' : 'center',
          justifyContent: 'flex-start',
        }}
      >
        {isMobile ? (
          <Button icon={<FilterOutlined />} onClick={() => setFiltersOpen(true)} block>
            Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
          </Button>
        ) : (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {filterSelects}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
              {filterToggles}
            </div>
          </div>
        )}
      </div>
      )}

      {!isPhoneBoard ? (
        <div
          className={isMobile ? 'sched-m__kpis' : undefined}
          style={
            isMobile
              ? undefined
              : {
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 10,
                  width: '100%',
                }
          }
        >
          <SummaryChip
            label="JO scheduled"
            value={String(summary?.jobsScheduled ?? '—')}
            hint={
              isMobile
                ? undefined
                : summary?.jobsScheduled
                  ? `${summary.operationsScheduled} operation${
                      summary.operationsScheduled === 1 ? '' : 's'
                    } on the board`
                  : 'No job orders in this period'
            }
            compact={isMobile}
            fit={isMobile}
          />
          <SummaryChip
            label={isMobile ? 'Near full' : 'Near full capacity'}
            value={
              summary?.machinesNearFullCapacity?.length
                ? summary.machinesNearFullCapacity.map((m) => m.machineTypeCode).join(', ')
                : 'None'
            }
            hint={
              isMobile
                ? undefined
                : summary?.machinesNearFullCapacity?.length
                  ? summary.machinesNearFullCapacity
                      .map((m) => `${m.machineTypeCode} ${m.projectedLoadPct ?? '—'}%`)
                      .join(' · ')
                  : 'No machine types at or above 80% in this period'
            }
            compact={isMobile}
            fit={isMobile}
          />
          <SummaryChip
            label={isMobile ? 'At risk' : 'Jobs at risk'}
            value={String(summary?.jobsAtRisk?.length ?? 0)}
            hint={
              isMobile
                ? undefined
                : summary?.jobsAtRisk?.length
                  ? summary.jobsAtRisk
                      .slice(0, 4)
                      .map((j) => j.jobNumber || j.jobTitle)
                      .join(', ') + (summary.jobsAtRisk.length > 4 ? '…' : '')
                  : 'No jobs past their date required'
            }
            danger={(summary?.jobsAtRisk?.length || 0) > 0}
            compact={isMobile}
            fit={isMobile}
          />
          <SummaryChip
            label={isMobile ? 'No material' : 'Waiting for materials'}
            value={String(waitingJobs.length)}
            hint={
              isMobile
                ? undefined
                : waitingJobs.length
                  ? waitingJobs.slice(0, 4).join(', ') + (waitingJobs.length > 4 ? '…' : '')
                  : 'Every job on the board has its materials'
            }
            compact={isMobile}
            fit={isMobile}
          />
        </div>
      ) : null}

      {loading && !data ? (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <Spin size="large" />
        </div>
      ) : (
        <ScheduleExpandShell
          collapsedMaxHeight={boardCollapsedMaxHeight}
          title={
            !isPhoneBoard ? (
              <Segmented
                value={viewMode}
                onChange={(v) => setViewMode(v as ViewMode)}
                size="middle"
                options={[
                  { label: 'Day', value: 'day' },
                  { label: 'Week', value: 'week' },
                  { label: 'Month', value: 'month' },
                ]}
              />
            ) : undefined
          }
          center={
            !isPhoneBoard ? (
              <>
                <Button
                  icon={<LeftOutlined />}
                  onClick={() => shiftPeriod(-1)}
                  aria-label="Previous period"
                />
                <Text
                  strong
                  style={{
                    color: NAVY,
                    fontSize: isMobile ? 13 : 14,
                    minWidth: isMobile ? '7.5rem' : '11rem',
                    textAlign: 'center',
                  }}
                >
                  {viewMode === 'day'
                    ? from.format('ddd, MMM D')
                    : viewMode === 'month'
                      ? from.format('MMMM YYYY')
                      : `${from.format('MMM D')} – ${to.format('MMM D, YYYY')}`}
                </Text>
                <Button
                  icon={<RightOutlined />}
                  onClick={() => shiftPeriod(1)}
                  aria-label="Next period"
                />
              </>
            ) : undefined
          }
          trailing={
            !isPhoneBoard ? (
              <Button
                icon={<AimOutlined />}
                onClick={() => setAnchor(dayjs().tz(SHOP_TZ))}
              >
                Today
              </Button>
            ) : undefined
          }
        >
          <div
            ref={boardScrollRef}
            className="sched-board-view"
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: 10,
              background: '#fff',
              overflow: 'auto',
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
                  borderBottom: `1px solid ${BORDER}`,
                  borderRight: `1px solid ${BORDER}`,
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
                  borderBottom: `1px solid ${BORDER}`,
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
                        borderLeft: i === 0 ? 'none' : `1px solid ${BORDER}`,
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

            <BoardRows
              rows={rows}
              rowMode={rowMode}
              opsByRowKey={opsByRowKey}
              downtimesByUnit={downtimesByUnit}
              rowH={rowH}
              labelW={labelW}
              boardW={boardW}
              pph={pph}
              dayColumns={dayColumns}
              from={from}
              to={to}
              viewMode={viewMode}
              isMobile={isMobile}
              weekLayout={weekLayout}
              dayHourPx={dayHourPx}
              onOpenJob={openJob}
            />
          </div>
          <div style={{ padding: '8px 12px', fontSize: 11, color: '#94a3b8' }}>
            {viewMode === 'week' && weekLayout
              ? `${WORKING_HOURS_NOTE} Scroll sideways for more days.`
              : `${HOUR_START}:00–${HOUR_END}:00. Scroll sideways for more days.`}
          </div>
          </div>
        </ScheduleExpandShell>
      )}

      <Drawer
        className="sched-f-drawer"
        rootClassName="sched-f-drawer"
        placement="bottom"
        height="auto"
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        closable={false}
        title={null}
        styles={{
          content: {
            padding: 0,
            borderRadius: '16px 16px 0 0',
            overflow: 'hidden',
            background: '#f1f5f9',
          },
          header: { display: 'none', padding: 0 },
          body: { padding: 0, background: '#f1f5f9' },
        }}
      >
        <div className="sched-f">
          <div className="sched-f__handle" />
          <div className="sched-f__head">
            <div>
              <div className="sched-f__title">Filters</div>
              <div className="sched-f__sub">
                {activeFilterCount ? `${activeFilterCount} on` : 'None on'}
              </div>
            </div>
            {activeFilterCount ? (
              <button type="button" className="sched-f__text" onClick={clearBoardFilters}>
                Clear
              </button>
            ) : null}
            <button
              type="button"
              className="sched-m__icon"
              onClick={() => setFiltersOpen(false)}
              aria-label="Close"
            >
              <CloseOutlined />
            </button>
          </div>

          {!isPhoneBoard ? (
            <div className="sched-f__card">
              <div className="sched-f__label">Rows</div>
              <div className="sched-m__pills" role="tablist" aria-label="Rows">
                {([
                  ['machine', 'Machine'],
                  ['worker', 'Worker'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`sched-m__pill${rowMode === value ? ' is-on' : ''}`}
                    onClick={() => setRowMode(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="sched-f__card">
            <div className="sched-f__label">Narrow by</div>
            <div className="sched-f__rows">
              <div className="sched-f__row">
                <span className="sched-f__row-k">Machine type</span>
                <Select
                  allowClear
                  variant="borderless"
                  placeholder="All"
                  className="sched-f__select"
                  value={machineTypeId}
                  onChange={setMachineTypeId}
                  options={machineTypes.map((t) => ({ value: t.id, label: t.name }))}
                />
              </div>
              <div className="sched-f__row">
                  <span className="sched-f__row-k">Worker</span>
                  <Select
                    allowClear
                    showSearch
                    variant="borderless"
                    optionFilterProp="label"
                    placeholder="All"
                    className="sched-f__select"
                    value={workerId}
                    onChange={setWorkerId}
                    options={(data?.workers || []).map((w) => ({
                      value: w.id,
                      label: w.fullName,
                    }))}
                  />
                </div>
              <div className="sched-f__row">
                <span className="sched-f__row-k">Client</span>
                <Select
                  allowClear
                  showSearch
                  variant="borderless"
                  optionFilterProp="label"
                  placeholder="All"
                  className="sched-f__select"
                  value={clientId}
                  onChange={setClientId}
                  options={(data?.clients || []).map((c) => ({ value: c.id, label: c.name }))}
                />
              </div>
            </div>
          </div>

          <div className="sched-f__card">
            <div className="sched-f__label">Operations</div>
            <div className="sched-m__pills" role="tablist" aria-label="Completed">
              <button
                type="button"
                className={`sched-m__pill${includeCompleted ? ' is-on' : ''}`}
                onClick={() => setIncludeCompleted(true)}
              >
                All
              </button>
              <button
                type="button"
                className={`sched-m__pill${!includeCompleted ? ' is-on' : ''}`}
                onClick={() => setIncludeCompleted(false)}
              >
                Hide done
              </button>
            </div>
          </div>

          <button type="button" className="sched-f__done" onClick={() => setFiltersOpen(false)}>
            Done
          </button>
        </div>
      </Drawer>
    </div>
  );

  return board;
}

function SummaryChip({
  label,
  value,
  hint,
  danger,
  compact,
  fit,
}: {
  label: string;
  value: string;
  hint?: string;
  danger?: boolean;
  compact?: boolean;
  fit?: boolean;
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: fit ? '8px 6px' : compact ? '10px 14px' : '10px 12px',
        minWidth: fit ? 0 : compact ? 140 : undefined,
        maxWidth: fit ? '100%' : undefined,
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          fontSize: fit ? 10 : 11,
          fontWeight: 600,
          color: '#64748b',
          marginBottom: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: fit ? 15 : compact ? 18 : 16,
          fontWeight: 700,
          color: danger ? '#7A1528' : NAVY,
          lineHeight: 1.2,
          overflow: 'hidden',
          display: fit ? '-webkit-box' : undefined,
          WebkitLineClamp: fit ? 2 : undefined,
          WebkitBoxOrient: fit ? 'vertical' : undefined,
          wordBreak: fit ? 'break-word' : undefined,
        }}
      >
        {value}
      </div>
      {hint ? (
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{hint}</div>
      ) : null}
    </div>
  );
}

type BoardRowsProps = {
  rows: RowDef[];
  rowMode: RowMode;
  opsByRowKey: Map<string | null | undefined, ScheduleBoardOperation[]>;
  downtimesByUnit: Map<string, ScheduleBoardDowntime[]>;
  rowH: number;
  labelW: number;
  boardW: number;
  pph: number;
  dayColumns: ReturnType<typeof dayColumnsForView>;
  from: Dayjs;
  to: Dayjs;
  viewMode: ViewMode;
  isMobile: boolean;
  weekLayout: WeekTimelineLayout | null;
  dayHourPx: number | undefined;
  onOpenJob: (jobOrderId: string) => void;
};

const BoardRows = memo(function BoardRows({
  rows,
  rowMode,
  opsByRowKey,
  downtimesByUnit,
  rowH,
  labelW,
  boardW,
  pph,
  dayColumns,
  from,
  to,
  viewMode,
  isMobile,
  weekLayout,
  dayHourPx,
  onOpenJob,
}: BoardRowsProps) {
  const columnFill = true;
  const posArgs = [from, viewMode, isMobile, weekLayout, dayHourPx] as const;
  return (
    <div style={{ position: 'relative' }}>
    {rows.map((row) => {
      const ops = opsByRowKey.get(rowGroupKey(row, rowMode)) ?? NO_OPS;
      const dts = (rowMode === 'machine' && row.machineUnitId ? downtimesByUnit.get(row.machineUnitId) : undefined) ?? NO_DOWNTIMES;
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
                borderBottom: `1px solid ${BORDER}`,
              }}
            >
              {row.group}
            </div>
          ) : null}
          <div
            style={{
              display: 'flex',
              minHeight: trackH,
              borderBottom: `1px solid #f1f5f9`,
            }}
          >
            <div
              style={{
                width: labelW,
                flexShrink: 0,
                position: 'sticky',
                left: 0,
                zIndex: 2,
                background: '#fff',
                borderRight: `1px solid ${BORDER}`,
                padding: '6px 8px',
                fontSize: isMobile ? 11 : 12,
                fontWeight: 600,
                color: row.noMachine ? '#64748b' : NAVY,
                display: 'flex',
                alignItems: 'center',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minHeight: trackH,
              }}
            >
              {row.label}
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
                const clipped = clipSegmentToPeriod(
                  d.segmentStart,
                  d.segmentEnd,
                  from,
                  to
                );
                if (!clipped) return [];
                const barLeft = leftPx(clipped.start, ...posArgs);
                const barW = widthPx(clipped.start, clipped.end, ...posArgs);
                if (barLeft == null || barW == null || barW <= 0) return [];
                return [
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
              })}

              {ops.flatMap((op) => {
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
                return spans.flatMap((seg, i) => {
                  const clipped = clipSegmentToPeriod(seg.start, seg.end, from, to);
                  if (!clipped) return [];
                  const barLeft = leftPx(clipped.start, ...posArgs);
                  const barW = widthPx(clipped.start, clipped.end, ...posArgs);
                  if (barLeft == null || barW == null || barW <= 0) return [];
                  const color =
                    op.scheduleColor || STATUS_COLOR[op.status] || '#2563eb';
                  const late = !!op.isLate;
                  const label =
                    barW >= 22
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
                  return [
                    <Tooltip
                      key={`${op.id}-${i}`}
                      title={
                        <div style={{ maxWidth: 260 }}>
                          <div style={{ fontWeight: 700 }}>
                            {scheduleOpTitle(op.sequenceNo, op.operationName)}
                          </div>
                          <div>
                            {op.jobNumber} · {op.jobTitle}
                          </div>
                          <div>Client: {op.clientName || '—'}</div>
                          <div>Worker: {op.assignedWorkerName || '—'}</div>
                          <div>
                            Target hours:{' '}
                            {op.estimatedHours != null ? op.estimatedHours : '—'}
                          </div>
                          <div>
                            Scheduled:{' '}
                            {formatShopDateTime(op.scheduledStart)} →{' '}
                            {formatShopDateTime(op.scheduledEnd)}
                          </div>
                          <div>Status: {statusLabel(op.status)}</div>
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
                      }
                    >
                      <button
                        type="button"
                        onClick={() => onOpenJob(op.jobOrderId)}
                        style={{
                          position: 'absolute',
                          top: barTop,
                          height: barHeight,
                          left: barLeft,
                          width: barW,
                          background: color,
                          backgroundImage: op.waitingForMaterials
                            ? MATERIAL_WAIT_BAR_IMAGE
                            : undefined,
                          border: columnFill ? 'none' : late ? '2px solid #7A1528' : 'none',
                          borderRadius: columnFill ? 0 : 4,
                          color: '#fff',
                          ...textStyle,
                          cursor: 'pointer',
                          zIndex: 2,
                          boxShadow: columnFill
                            ? late
                              ? 'inset 0 0 0 2px #7A1528'
                              : undefined
                            : late
                              ? '0 0 0 1px rgba(122,21,40,0.35)'
                              : undefined,
                        }}
                      >
                        {label ? (
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
                        ) : null}
                      </button>
                    </Tooltip>,
                  ];
                });
              })}
            </div>
          </div>
        </div>
      );
    })}
    </div>
  );
});
