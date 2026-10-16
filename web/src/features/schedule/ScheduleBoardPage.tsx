import { OPERATION_BAR_COLOR, OPERATION_STATUS, TONE_BAR_FILL } from '../../theme/statuses';
import { Legend, StatCard, StatGrid, type LegendItem } from '../../components/ui';
import InfoTip from '../../components/InfoTip';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  DatePicker,
  Drawer,
  Grid,
  Select,
  Segmented,
  Skeleton,
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
  CalendarOutlined,
  DashboardOutlined,
  WarningOutlined,
  InboxOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import {
  crewIdsOf,
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
  buildMonthTimelineLayout,
  buildWeekTimelineLayout,
  clipSegmentToPeriod,
  dayColumnsForView,
  defaultShopDayWindows,
  leftPx,
  periodBounds,
  pxPerHour,
  fitDayPxPerHour,
  scaleWeekTimelineLayout,
  scheduleOpTitle,
  MATERIAL_WAIT_BAR_IMAGE,
  layoutRowBars,
  timelineWidth,
  widthPx,
  type TimelineViewMode,
  type WeekTimelineLayout,
} from './scheduleTimelineUtils';
import { formatShopDateTime, SHOP_TZ } from '../../utils/shopTime';
import ScheduleExpandShell from './ScheduleExpandShell';
import WorkerPersonalSchedule from './WorkerPersonalSchedule';
import ScheduleAgenda from './ScheduleAgenda';
import { capacityLine } from './capacityText';
import { TOUCH_QUERY, useMediaQuery } from '../../hooks/useViewport';
import { PersonAvatar, crewNames } from '../../components/PersonAvatar';
import { personLabel } from '../../utils/people';
import './scheduleBoard.css';

const { Text } = Typography;

type ViewMode = TimelineViewMode;
type RowMode = 'machine' | 'worker';

const STATUS_COLOR = OPERATION_BAR_COLOR;
const CLASH_COLOR = '#DC2626';
const DOWN_COLOR = '#C45A6A';
const STALLED_COLOR = '#D97706';
const DOWN_OVERLAY_IMAGE =
  'repeating-linear-gradient(-45deg, rgba(196,90,106,0.75) 0 3px, transparent 3px 9px)';
const BAR_GAP = 2;
const MIN_BAR_W = adminPx(16);

const SCHEDULE_LEGEND: LegendItem[] = [
  ...(['PENDING', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'REWORK'] as const).map((k) => ({
    label: OPERATION_STATUS[k].label,
    color: OPERATION_BAR_COLOR[k],
  })),
  { label: 'Waiting for materials', pattern: `${MATERIAL_WAIT_BAR_IMAGE}, ${OPERATION_BAR_COLOR.SCHEDULED}` },
  { label: 'At risk of missing date', color: '#fff', border: `2px solid ${TONE_BAR_FILL.red}` },
  {
    label: 'Machine breakdown',
    pattern: 'repeating-linear-gradient(-45deg, #E8C5CB, #E8C5CB 3px, #F5E6E9 3px, #F5E6E9 6px)',
    border: '1px solid #C45A6A',
  },
  { label: 'Clash (double-booked)', color: '#fff', border: `2px solid ${CLASH_COLOR}` },
  { label: 'Booked on a down machine', color: '#fff', border: `2px dashed ${DOWN_COLOR}` },
  { label: 'Stalled (paused over a day)', color: '#fff', border: `2px dotted ${STALLED_COLOR}` },
];

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
  personName?: string;
  photoVersion?: number | null;
  noMachine?: boolean;
};

const NOW_COLOR = '#2563eb';

const BAR_TEXT_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  flex: 1,
  minWidth: 0,
  gap: 1,
  lineHeight: 1.2,
} as const;

const BAR_LINE_STYLE = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

const BAR_PILL_STYLE = {
  flexShrink: 0,
  border: '1px solid rgba(255,255,255,0.85)',
  background: 'rgba(255,255,255,0.12)',
  borderRadius: 999,
  padding: '0 7px',
  fontSize: 10,
  fontWeight: 600,
  lineHeight: '16px',
  whiteSpace: 'nowrap',
} as const;

/** Shop time, refreshed every minute for the board's "now" line. */
function useShopNow(): Dayjs {
  const [now, setNow] = useState(() => dayjs().tz(SHOP_TZ));
  useEffect(() => {
    const id = window.setInterval(() => setNow(dayjs().tz(SHOP_TZ)), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

type PhoneView = 'list' | 'board';
const PHONE_VIEW_KEY = 'schedule.phoneView';

function readPhoneView(): PhoneView {
  try {
    return localStorage.getItem(PHONE_VIEW_KEY) === 'board' ? 'board' : 'list';
  } catch {
    return 'list';
  }
}

const NO_MACHINE_KEY = '__none__';
const NO_OPS: ScheduleBoardOperation[] = [];
const NO_DOWNTIMES: ScheduleBoardDowntime[] = [];

function opSegments(op: ScheduleBoardOperation) {
  if (op.segments.length > 0) return op.segments;
  return op.scheduledStart && op.scheduledEnd ? [{ start: op.scheduledStart, end: op.scheduledEnd }] : [];
}

function opGroupKeys(op: ScheduleBoardOperation, rowMode: RowMode) {
  return rowMode === 'worker' ? crewIdsOf(op) : [op.machineUnitId || NO_MACHINE_KEY];
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

function groupByMany<T>(items: T[], keysOf: (item: T) => (string | null | undefined)[]) {
  const map = new Map<string | null | undefined, T[]>();
  for (const item of items) {
    for (const key of keysOf(item)) {
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
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
  const isTouch = useMediaQuery(TOUCH_QUERY);
  // Bars are rowH - 8 tall; touch screens get 44px bars.
  const rowH = isTouch ? 52 : isMobile ? adminPx(40) : adminPx(44);
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [rowMode, setRowMode] = useState<RowMode>('machine');
  // Keep the pills snappy; rebuild the heavy board at lower priority.
  const boardViewMode = useDeferredValue(viewMode);
  const boardRowMode = useDeferredValue(rowMode);
  const boardPending = boardViewMode !== viewMode || boardRowMode !== rowMode;
  const [anchor, setAnchor] = useState(() => dayjs().tz(SHOP_TZ));
  const [includeCompleted, setIncludeCompleted] = useState(true);
  const [machineTypeId, setMachineTypeId] = useState<string | undefined>();
  const [workerId, setWorkerId] = useState<string | undefined>();
  const [clientId, setClientId] = useState<string | undefined>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [phoneView, setPhoneView] = useState<PhoneView>(readPhoneView);
  const changePhoneView = (next: PhoneView) => {
    setPhoneView(next);
    try {
      localStorage.setItem(PHONE_VIEW_KEY, next);
    } catch {
      /* storage unavailable */
    }
  };
  const [data, setData] = useState<ScheduleBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const { from, to } = useMemo(
    () => periodBounds(anchor, boardViewMode),
    [anchor, boardViewMode],
  );
  useOverdueCheck();

  useEffect(() => {
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
  }, [from, to, machineTypeId, workerId, clientId, includeCompleted]);

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
    if (boardRowMode === 'worker') {
      return data.workers.map((w) => ({
        key: w.id,
        label: personLabel(w.fullName, w.nickname),
        workerId: w.id,
        personName: w.fullName,
        photoVersion: w.photoVersion,
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
  }, [data, boardRowMode]);

  const shiftPeriod = (dir: -1 | 1) => {
    if (viewMode === 'day') setAnchor((a) => a.add(dir, 'day'));
    else if (viewMode === 'week') setAnchor((a) => a.add(dir * 7, 'day'));
    else setAnchor((a) => a.add(dir, 'month'));
  };

  const goToToday = () => {
    setViewMode('day');
    setAnchor(dayjs().tz(SHOP_TZ));
  };

  const jumpToDate = (d: Dayjs | null) => {
    if (!d) return;
    setAnchor(d.tz(SHOP_TZ));
  };

  const clearBoardFilters = () => {
    setMachineTypeId(undefined);
    setClientId(undefined);
    setWorkerId(undefined);
    setIncludeCompleted(true);
  };

  const opsByRowKey = useMemo(
    () => groupByMany(data?.operations ?? NO_OPS, (o) => opGroupKeys(o, boardRowMode)),
    [data, boardRowMode]
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
  }, [loading, data, phoneView]);

  const naturalWeekLayout = useMemo(() => {
    if (boardViewMode === 'day') return null;
    const windows =
      data?.shopDayWindows && data.shopDayWindows.length > 0
        ? data.shopDayWindows
        : defaultShopDayWindows(from, to);
    return boardViewMode === 'week'
      ? buildWeekTimelineLayout(from, to, windows, isMobile)
      : buildMonthTimelineLayout(from, to, windows, isMobile);
  }, [boardViewMode, data?.shopDayWindows, from, to, isMobile]);

  const weekLayout = useMemo(() => {
    if (!naturalWeekLayout) return null;
    const target = Math.max(naturalWeekLayout.totalWidth, Math.max(0, boardAvailW - labelW));
    return scaleWeekTimelineLayout(naturalWeekLayout, target);
  }, [naturalWeekLayout, boardAvailW, labelW]);

  const dayHourPx = useMemo(() => {
    if (boardViewMode !== 'day') return undefined;
    return fitDayPxPerHour(isMobile, Math.max(0, boardAvailW - labelW));
  }, [boardViewMode, isMobile, boardAvailW, labelW]);

  const boardW = timelineWidth(from, to, boardViewMode, isMobile, weekLayout, dayHourPx);
  const dayColumns = useMemo(
    () => dayColumnsForView(from, to, boardViewMode, isMobile, weekLayout, dayHourPx),
    [from, to, boardViewMode, isMobile, weekLayout, dayHourPx]
  );
  const pph = dayHourPx ?? pxPerHour(boardViewMode, isMobile);
  const now = useShopNow();
  const nowLeft = useMemo(() => {
    const hour = now.hour() + now.minute() / 60;
    if (hour < HOUR_START || hour > HOUR_END) return null;
    if (now.isBefore(from.startOf('day')) || now.isAfter(to.endOf('day'))) return null;
    const left = leftPx(now.toISOString(), from, boardViewMode, isMobile, weekLayout, dayHourPx);
    return left != null && left >= 0 && left <= boardW ? left : null;
  }, [now, from, to, boardViewMode, isMobile, weekLayout, dayHourPx, boardW]);
  const boardCollapsedMaxHeight = isPhoneBoard
      ? 'calc(100dvh - 340px)'
      : isMobile
        ? 'calc(100dvh - 260px)'
        : 'calc(100vh - 280px)';
  const today = dayjs().tz(SHOP_TZ).startOf('day');
  const showingToday = !today.isBefore(from, 'day') && !today.isAfter(to, 'day');
  const nearFull = summary?.machinesNearFullCapacity || [];
  const capacityRows = summary?.machineCapacity || [];
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
          className="sched-seg"
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
          label: personLabel(w.fullName, w.nickname),
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
      className={isPhoneBoard ? undefined : 'ui-page sched-page'}
      style={
        isPhoneBoard
          ? { display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, minWidth: 0 }
          : undefined
      }
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
                onClick={goToToday}
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
              <div className="sched-m__pills" role="tablist" aria-label="View">
                {([
                  ['list', 'List'],
                  ['board', 'Board'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={phoneView === value}
                    className={`sched-m__pill${phoneView === value ? ' is-on' : ''}`}
                    onClick={() => changePhoneView(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {phoneView === 'board' ? (
              <div className="sched-m__groups">
                <div className="sched-m__pills" role="tablist" aria-label="Rows">
                  {([
                    ['machine', 'By machine'],
                    ['worker', 'By worker'],
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
            ) : null}
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
                <span key={m.machineTypeId} className="sched-m__cap" title={capacityLine(m)}>
                  {m.machineTypeCode}
                  {m.projectedLoadPct != null ? ` ${m.projectedLoadPct}%` : ''}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <StatGrid min={200}>
          <StatCard
            icon={<CalendarOutlined />}
            tone="blue"
            label="JO scheduled"
            value={summary?.jobsScheduled ?? '—'}
            loading={loading && !data}
            hint={
              summary?.jobsScheduled
                ? `${summary.operationsScheduled} operation${
                    summary.operationsScheduled === 1 ? '' : 's'
                  } on the board`
                : 'No job orders in this period'
            }
          />
          <StatCard
            icon={<DashboardOutlined />}
            tone="amber"
            label={
              <>
                Near full capacity
                {capacityRows.length ? (
                  <InfoTip
                    label="How capacity is worked out"
                    title="Load this period"
                    content={
                      <>
                        <div>
                          Hours booked inside the period, less hours already worked, over the shop
                          hours (with overtime days) of units that are not down.
                        </div>
                        {capacityRows.map((c) => (
                          <div key={c.machineTypeId}>{capacityLine(c)}</div>
                        ))}
                      </>
                    }
                  />
                ) : null}
              </>
            }
            value={nearFull.length ? nearFull.map((m) => m.machineTypeCode).join(', ') : 'None'}
            loading={loading && !data}
            hint={
              nearFull.length
                ? nearFull.map((m) => `${m.machineTypeCode} ${m.projectedLoadPct ?? '—'}%`).join(' · ')
                : 'None at 80% load or more'
            }
          />
          <StatCard
            icon={<WarningOutlined />}
            tone="red"
            label="Jobs at risk"
            value={atRiskCount}
            valueTone={atRiskCount > 0 ? 'red' : undefined}
            loading={loading && !data}
            hint={
              atRiskCount
                ? (summary?.jobsAtRisk || [])
                    .slice(0, 4)
                    .map((j) => j.jobNumber || j.jobTitle)
                    .join(', ') + (atRiskCount > 4 ? '…' : '')
                : 'None past date required'
            }
          />
          <StatCard
            icon={<InboxOutlined />}
            tone="amber"
            label="Waiting for materials"
            value={waitingJobs.length}
            loading={loading && !data}
            hint={
              waitingJobs.length
                ? waitingJobs.slice(0, 4).join(', ') + (waitingJobs.length > 4 ? '…' : '')
                : 'All jobs have materials'
            }
          />
        </StatGrid>
      )}

      <div className={isPhoneBoard ? 'sched-page__phone-board' : 'ui-card sched-page__card'}>
      {!isPhoneBoard ? (
        <div className="sched-page__filters">
          <div className="sched-page__filters-left">{filterSelects}</div>
          <div className="sched-page__filters-right">{filterToggles}</div>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="sched-page__loading" aria-busy>
          <Skeleton active paragraph={{ rows: 8 }} title={false} />
        </div>
      ) : isPhoneBoard && phoneView === 'list' ? (
        <ScheduleAgenda
          operations={data?.operations ?? NO_OPS}
          downtimes={data?.downtimes ?? NO_DOWNTIMES}
          from={from}
          to={to}
          onOpenJob={openJob}
        />
      ) : (
        <ScheduleExpandShell
          collapsedMaxHeight={boardCollapsedMaxHeight}
          title={
            !isPhoneBoard ? (
              <Segmented
                className="sched-seg"
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
                <DatePicker
                  picker={viewMode === 'month' ? 'month' : 'date'}
                  value={anchor}
                  allowClear={false}
                  format={viewMode === 'month' ? 'MMM YYYY' : 'MMM D, YYYY'}
                  onChange={jumpToDate}
                  suffixIcon={<CalendarOutlined />}
                  aria-label={viewMode === 'month' ? 'Jump to month' : 'Jump to date'}
                  style={{ width: viewMode === 'month' ? 118 : 138 }}
                />
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
                onClick={goToToday}
              >
                Today
              </Button>
            ) : undefined
          }
        >
          <div
            ref={boardScrollRef}
            className={`sched-board-view${boardPending ? ' is-pending' : ''}`}
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
                zIndex: 5,
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
                {boardRowMode === 'machine' ? 'Machine' : 'Worker'}
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
                {nowLeft != null ? (
                  <>
                    <div
                      style={{
                        position: 'absolute',
                        left: nowLeft - 1,
                        bottom: 0,
                        width: 2,
                        height: 8,
                        background: NOW_COLOR,
                        pointerEvents: 'none',
                      }}
                    />
                    <div
                      aria-label="Now"
                      style={{
                        position: 'absolute',
                        left: nowLeft,
                        bottom: -8,
                        transform: 'translateX(-50%)',
                        background: NOW_COLOR,
                        color: '#fff',
                        fontSize: 10,
                        fontWeight: 600,
                        lineHeight: '16px',
                        padding: '0 7px',
                        borderRadius: 4,
                        whiteSpace: 'nowrap',
                        boxShadow: '0 1px 2px rgba(15,23,42,0.2)',
                        pointerEvents: 'none',
                      }}
                    >
                      Now
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            <BoardRows
              rows={rows}
              rowMode={boardRowMode}
              opsByRowKey={opsByRowKey}
              downtimesByUnit={downtimesByUnit}
              rowH={rowH}
              labelW={labelW}
              boardW={boardW}
              pph={pph}
              dayColumns={dayColumns}
              from={from}
              to={to}
              viewMode={boardViewMode}
              isMobile={isMobile}
              weekLayout={weekLayout}
              dayHourPx={dayHourPx}
              nowLeft={nowLeft}
              onOpenJob={openJob}
            />
          </div>
          <div className="sched-page__note">
            {weekLayout
              ? `${WORKING_HOURS_NOTE} Scroll sideways for more days.`
              : `${HOUR_START}:00–${HOUR_END}:00. Scroll sideways for more days.`}
          </div>
          </div>
        </ScheduleExpandShell>
      )}
      {!isPhoneBoard ? (
        <div className="sched-page__legend">
          <Legend items={SCHEDULE_LEGEND} />
          <InfoTip
            label="About bar colours"
            content="Bars take the job's own colour when one is set on the job; otherwise they show the operation status. Click a bar to open its job order."
          />
        </div>
      ) : null}
      </div>

      <Drawer
        className="sched-f-drawer"
        rootClassName="sched-f-drawer"
        placement="bottom"
        size="auto"
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        closable={false}
        title={null}
        styles={{
          section: {
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
                      label: personLabel(w.fullName, w.nickname),
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
  nowLeft: number | null;
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
  nowLeft,
  onOpenJob,
}: BoardRowsProps) {
  const columnFill = false;
  // Layout every row once per board change — not inline during JSX map.
  const prepared = useMemo(() => {
    const pos = { from, to, mode: viewMode, mobile: isMobile, weekLayout, hourPx: dayHourPx };
    const args = [from, viewMode, isMobile, weekLayout, dayHourPx] as const;
    return rows.map((row) => {
      const ops = opsByRowKey.get(rowGroupKey(row, rowMode)) ?? NO_OPS;
      const dts =
        (rowMode === 'machine' && row.machineUnitId
          ? downtimesByUnit.get(row.machineUnitId)
          : undefined) ?? NO_DOWNTIMES;
      const opById = new Map(ops.map((op) => [op.id, op]));
      const { bars, laneCount } = layoutRowBars(
        ops.map((op) => ({ id: op.id, segments: opSegments(op) })),
        pos,
        { markClashes: !row.noMachine, gap: BAR_GAP, minWidth: MIN_BAR_W },
      );
      const trackH = rowH * laneCount;
      const downRects = dts.flatMap((d) => {
        const clipped = clipSegmentToPeriod(d.segmentStart, d.segmentEnd, from, to);
        if (!clipped) return [];
        const left = leftPx(clipped.start, ...args);
        const width = widthPx(clipped.start, clipped.end, ...args);
        return left == null || width == null || width <= 0 ? [] : [{ d, left, width }];
      });
      return { row, opById, bars, laneCount, trackH, downRects };
    });
  }, [
    rows,
    rowMode,
    opsByRowKey,
    downtimesByUnit,
    rowH,
    from,
    to,
    viewMode,
    isMobile,
    weekLayout,
    dayHourPx,
  ]);

  return (
    <div style={{ position: 'relative' }}>
    {nowLeft != null ? (
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: labelW + nowLeft - 1,
          width: 2,
          background: NOW_COLOR,
          zIndex: 3,
          pointerEvents: 'none',
        }}
      />
    ) : null}
    {prepared.map(({ row, opById, bars, laneCount, trackH, downRects }) => {
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
                zIndex: 4,
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

              {downRects.map(({ d, left: barLeft, width: barW }) => (
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
                  </Tooltip>
              ))}

              {bars.flatMap((bar) => {
                const op = opById.get(bar.opId);
                if (!op) return [];
                const barTop = columnFill ? bar.lane * rowH : bar.lane * rowH + 4;
                const barHeight = columnFill ? rowH : rowH - 8;
                const barLeft = bar.left;
                const barW = bar.width;
                // Breakdown hatching drawn over the bar, so a down machine is never hidden.
                const downOverlays = downRects.flatMap(({ d, left, width }) => {
                  const l = Math.max(left, barLeft);
                  const r = Math.min(left + width, barLeft + barW);
                  return r > l ? [{ key: `${bar.key}-down-${d.id}`, left: l, width: r - l }] : [];
                });
                const onDown = !!op.onDownUnit || downOverlays.length > 0;
                const color =
                  op.scheduleColor || STATUS_COLOR[op.status] || '#2563eb';
                const late = !!op.isLate;
                const showText = barW >= 22;
                const showPill = barW >= adminPx(150) && !isMobile;
                const pill = onDown ? 'Machine down' : op.stalled ? 'Stalled' : statusLabel(op.status);
                const rings = [
                  late ? 'inset 0 0 0 2px #7A1528' : null,
                  bar.clash ? `0 0 0 2px ${CLASH_COLOR}` : '0 1px 2px rgba(15,23,42,0.18)',
                ].filter(Boolean).join(', ');
                  const opTitle = scheduleOpTitle(op.sequenceNo, op.operationName);
                  const title = op.jobNumber ? `Job ${op.jobNumber}` : opTitle;
                  const meta = [op.clientName, op.jobNumber ? opTitle : null]
                    .filter(Boolean)
                    .join(' · ');
                  return [
                    <Tooltip
                      key={bar.key}
                      title={
                        <div style={{ maxWidth: 260 }}>
                          {bar.clash ? (
                            <div style={{ color: '#FCA5A5', fontWeight: 700 }}>
                              <WarningOutlined /> Clash: overlaps other work on this{' '}
                              {rowMode === 'machine' ? 'machine' : 'worker'}
                            </div>
                          ) : null}
                          {onDown ? (
                            <div style={{ color: '#FCA5A5', fontWeight: 700 }}>
                              <ToolOutlined /> Machine down
                              {op.downtimeReason ? `: ${op.downtimeReason}` : ''}
                            </div>
                          ) : null}
                          {op.stalled ? (
                            <div style={{ color: '#FCD34D', fontWeight: 700 }}>
                              Stalled: paused since {formatShopDateTime(op.pausedAt)}. Resume it,
                              re-plan or reassign it.
                            </div>
                          ) : null}
                          <div style={{ fontWeight: 700 }}>
                            {opTitle}
                            {op.jobNumber ? ` · ${op.jobNumber}` : ''}
                          </div>
                          <div>
                            {op.jobNumber} · {op.jobTitle}
                          </div>
                          <div>Client: {op.clientName || '—'}</div>
                          <div>
                            {(op.crew?.length || 0) > 1 ? 'Crew' : 'Worker'}:{' '}
                            {crewNames(
                              op.crew,
                              op.assignedWorkerName
                                ? personLabel(op.assignedWorkerName, op.assignedWorkerNickname)
                                : null,
                            ) || '—'}
                          </div>
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
                        aria-label={bar.short ? `${opTitle}${op.jobNumber ? ` · ${op.jobNumber}` : ''}` : undefined}
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
                          border: '1px solid rgba(15,23,42,0.28)',
                          outline: onDown
                            ? `2px dashed ${DOWN_COLOR}`
                            : op.stalled
                              ? `2px dotted ${STALLED_COLOR}`
                              : undefined,
                          outlineOffset: onDown || op.stalled ? 1 : undefined,
                          borderRadius: adminPx(6),
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          gap: adminPx(6),
                          boxSizing: 'border-box',
                          margin: 0,
                          padding: barW < adminPx(64) ? `0 ${adminPx(4)}px` : `0 ${adminPx(8)}px`,
                          overflow: 'hidden',
                          textAlign: 'left',
                          cursor: 'pointer',
                          zIndex: 2,
                          boxShadow: rings,
                        }}
                      >
                        {bar.clash && barW >= 14 ? (
                          <WarningOutlined
                            aria-label="Clash"
                            style={{ color: '#fff', background: CLASH_COLOR, borderRadius: 3, padding: 1, flexShrink: 0 }}
                          />
                        ) : null}
                        {showText ? (
                          <span style={BAR_TEXT_STYLE}>
                            <span style={{ ...BAR_LINE_STYLE, fontSize: adminPx(isMobile ? 11 : 12), fontWeight: 700 }}>
                              {title}
                            </span>
                            {meta ? (
                              <span
                                style={{
                                  ...BAR_LINE_STYLE,
                                  fontSize: adminPx(isMobile ? 10 : 11),
                                  fontWeight: 500,
                                  opacity: 0.9,
                                }}
                              >
                                {meta}
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                        {showPill ? (
                          <span
                            style={
                              onDown
                                ? { ...BAR_PILL_STYLE, background: DOWN_COLOR }
                                : op.stalled
                                  ? { ...BAR_PILL_STYLE, background: STALLED_COLOR }
                                  : BAR_PILL_STYLE
                            }
                          >
                            {pill}
                          </span>
                        ) : null}
                      </button>
                    </Tooltip>,
                    ...downOverlays.map((o) => (
                      <div
                        key={o.key}
                        aria-hidden
                        style={{
                          position: 'absolute',
                          top: barTop,
                          height: barHeight,
                          left: o.left,
                          width: o.width,
                          backgroundImage: DOWN_OVERLAY_IMAGE,
                          borderRadius: adminPx(6),
                          zIndex: 3,
                          pointerEvents: 'none',
                        }}
                      />
                    )),
                  ];
              })}
            </div>
          </div>
        </div>
      );
    })}
    </div>
  );
});
