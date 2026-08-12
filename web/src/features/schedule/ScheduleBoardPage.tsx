import { useEffect, useMemo, useState } from 'react';
import {
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
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { scheduleApi, type ScheduleBoardOperation, type ScheduleBoardResponse } from '../../api/schedule.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { WorkerPageHeader } from '../../layouts/WorkerLayout';
import { SHOP_TZ, formatShopDateTime } from '../../utils/shopTime';

const { Text } = Typography;

const NAVY = '#0f1c2e';
const BORDER = '#e2e8f0';
const HOUR_START = 6;
const HOUR_END = 22;

type ViewMode = 'day' | 'week' | 'month';
type RowMode = 'machine' | 'worker';

const STATUS_COLOR: Record<string, string> = {
  SCHEDULED: '#2563eb',
  IN_PROGRESS: '#0d9488',
  COMPLETED: '#64748b',
  REWORK: '#d97706',
  PENDING: '#94a3b8',
};

function periodBounds(anchor: Dayjs, mode: ViewMode): { from: Dayjs; to: Dayjs } {
  const a = anchor.tz(SHOP_TZ);
  if (mode === 'day') {
    const d = a.startOf('day');
    return { from: d, to: d };
  }
  if (mode === 'week') {
    const dow = a.day();
    const start = a.startOf('day').subtract(dow === 0 ? 6 : dow - 1, 'day');
    return { from: start, to: start.add(6, 'day') };
  }
  const start = a.startOf('month');
  return { from: start, to: a.endOf('month').startOf('day') };
}

function pxPerHour(mode: ViewMode, mobile: boolean): number {
  if (mode === 'day') return mobile ? 40 : 56;
  if (mode === 'week') return mobile ? 12 : 18;
  return mobile ? 4 : 6;
}

function timelineWidth(from: Dayjs, to: Dayjs, mode: ViewMode, mobile: boolean): number {
  const hoursPerDay = HOUR_END - HOUR_START;
  const days = to.diff(from, 'day') + 1;
  return days * hoursPerDay * pxPerHour(mode, mobile);
}

function leftPx(iso: string, from: Dayjs, mode: ViewMode, mobile: boolean): number {
  const t = dayjs(iso).tz(SHOP_TZ);
  const dayIndex = t.startOf('day').diff(from.startOf('day'), 'day');
  const hour = t.hour() + t.minute() / 60;
  const clampedHour = Math.min(HOUR_END, Math.max(HOUR_START, hour));
  const hoursPerDay = HOUR_END - HOUR_START;
  const pph = pxPerHour(mode, mobile);
  return dayIndex * hoursPerDay * pph + (clampedHour - HOUR_START) * pph;
}

function widthPx(
  startIso: string,
  endIso: string,
  from: Dayjs,
  mode: ViewMode,
  mobile: boolean
): number {
  const left = leftPx(startIso, from, mode, mobile);
  const right = leftPx(endIso, from, mode, mobile);
  return Math.max(right - left, 4);
}

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

export default function ScheduleBoardPage() {
  const navigate = useNavigate();
  const { isWorker, user } = useAuth();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const labelW = isMobile ? 96 : 168;
  const rowH = isMobile ? 36 : 40;

  const [viewMode, setViewMode] = useState<ViewMode>(() => (isWorker ? 'day' : 'week'));
  const [rowMode, setRowMode] = useState<RowMode>('machine');
  const [anchor, setAnchor] = useState(() => dayjs().tz(SHOP_TZ));
  const [includeCompleted, setIncludeCompleted] = useState(true);
  const [machineTypeId, setMachineTypeId] = useState<string | undefined>();
  const [workerId, setWorkerId] = useState<string | undefined>(() =>
    isWorker ? user?.id : undefined
  );
  const [clientId, setClientId] = useState<string | undefined>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [data, setData] = useState<ScheduleBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const { from, to } = useMemo(() => periodBounds(anchor, viewMode), [anchor, viewMode]);

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

  const boardW = timelineWidth(from, to, viewMode, isMobile);
  const dayCount = to.diff(from, 'day') + 1;
  const hoursPerDay = HOUR_END - HOUR_START;
  const pph = pxPerHour(viewMode, isMobile);

  const shiftPeriod = (dir: -1 | 1) => {
    if (viewMode === 'day') setAnchor((a) => a.add(dir, 'day'));
    else if (viewMode === 'week') setAnchor((a) => a.add(dir * 7, 'day'));
    else setAnchor((a) => a.add(dir, 'month'));
  };

  const opsForRow = (row: RowDef): ScheduleBoardOperation[] => {
    const ops = data?.operations || [];
    if (rowMode === 'worker') {
      return ops.filter((o) => o.assignedWorkerId === row.workerId);
    }
    if (row.noMachine) {
      return ops.filter((o) => !o.machineUnitId);
    }
    return ops.filter((o) => o.machineUnitId === row.machineUnitId);
  };

  const downtimesForRow = (row: RowDef) => {
    if (rowMode !== 'machine' || !row.machineUnitId) return [];
    return (data?.downtimes || []).filter((d) => d.machineUnitId === row.machineUnitId);
  };

  const summary = data?.summary;
  const activeFilterCount = [machineTypeId, workerId && !(isWorker && workerId === user?.id) ? workerId : undefined, clientId]
    .filter(Boolean).length + (includeCompleted ? 0 : 1);

  const filterControls = (
    <>
      <Segmented
        block={isMobile}
        value={rowMode}
        onChange={(v) => setRowMode(v as RowMode)}
        options={[
          { label: 'By machine', value: 'machine' },
          { label: 'By worker', value: 'worker' },
        ]}
      />
      <Select
        allowClear
        placeholder="Machine type"
        style={{ width: isMobile ? '100%' : 160 }}
        value={machineTypeId}
        onChange={setMachineTypeId}
        options={machineTypes.map((t) => ({ value: t.id, label: t.name }))}
      />
      {!isWorker && (
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
      )}
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
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          width: isMobile ? '100%' : undefined,
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
        padding: isWorker ? (isMobile ? '12px 12px 8px' : '16px') : undefined,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: isMobile ? 'stretch' : 'center',
          justifyContent: 'space-between',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <Segmented
            value={viewMode}
            onChange={(v) => setViewMode(v as ViewMode)}
            size={isMobile ? 'middle' : 'middle'}
            options={[
              { label: 'Day', value: 'day' },
              { label: 'Week', value: 'week' },
              { label: 'Month', value: 'month' },
            ]}
          />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: isMobile ? 1 : undefined }}>
            <Button icon={<LeftOutlined />} onClick={() => shiftPeriod(-1)} />
            <Button
              icon={<AimOutlined />}
              onClick={() => setAnchor(dayjs().tz(SHOP_TZ))}
              style={{ flex: isMobile ? 1 : undefined }}
            >
              Today
            </Button>
            <Button icon={<RightOutlined />} onClick={() => shiftPeriod(1)} />
          </div>
          <Text strong style={{ color: NAVY, fontSize: isMobile ? 13 : 14 }}>
            {viewMode === 'day'
              ? from.format('ddd, MMM D')
              : `${from.format('MMM D')} – ${to.format('MMM D, YYYY')}`}
          </Text>
        </div>

        {isMobile ? (
          <Button icon={<FilterOutlined />} onClick={() => setFiltersOpen(true)} block>
            Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
          </Button>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {filterControls}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 10,
          overflowX: isMobile ? 'auto' : undefined,
          paddingBottom: isMobile ? 2 : 0,
        }}
      >
        <div
          style={{
            display: isMobile ? 'flex' : 'grid',
            gridTemplateColumns: isMobile ? undefined : 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10,
            minWidth: isMobile ? 'max-content' : undefined,
            width: isMobile ? undefined : '100%',
          }}
        >
          <SummaryChip
            label="Operations scheduled"
            value={String(summary?.operationsScheduled ?? '—')}
            compact={isMobile}
          />
          <SummaryChip
            label="Near full capacity"
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
          />
          <SummaryChip
            label="Jobs at risk"
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
          />
        </div>
      </div>

      {loading && !data ? (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <Spin size="large" />
        </div>
      ) : (
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            background: '#fff',
            overflow: 'auto',
            maxHeight: isWorker
              ? 'calc(100dvh - 280px)'
              : isMobile
                ? 'calc(100dvh - 260px)'
                : 'calc(100vh - 280px)',
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
                {Array.from({ length: dayCount }, (_, i) => {
                  const d = from.add(i, 'day');
                  const left = i * hoursPerDay * pph;
                  const w = hoursPerDay * pph;
                  return (
                    <div
                      key={d.format('YYYY-MM-DD')}
                      style={{
                        position: 'absolute',
                        left,
                        width: w,
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
                      {viewMode === 'day'
                        ? d.format(isMobile ? 'ddd D' : 'ddd MMM D')
                        : viewMode === 'week'
                          ? d.format('ddd D')
                          : d.format('D')}
                    </div>
                  );
                })}
              </div>
            </div>

            {rows.map((row) => {
              const ops = opsForRow(row);
              const dts = downtimesForRow(row);
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
                      minHeight: rowH,
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
                      {Array.from({ length: dayCount }, (_, i) => (
                        <div
                          key={i}
                          style={{
                            position: 'absolute',
                            left: i * hoursPerDay * pph,
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
                              top: 4,
                              height: rowH - 8,
                              left: leftPx(d.segmentStart, from, viewMode, isMobile),
                              width: widthPx(
                                d.segmentStart,
                                d.segmentEnd,
                                from,
                                viewMode,
                                isMobile
                              ),
                              background:
                                'repeating-linear-gradient(-45deg, #fecaca, #fecaca 4px, #fee2e2 4px, #fee2e2 8px)',
                              border: '1px solid #f87171',
                              borderRadius: 4,
                              opacity: 0.9,
                              zIndex: 1,
                            }}
                          />
                        </Tooltip>
                      ))}

                      {ops.flatMap((op) =>
                        (op.segments.length
                          ? op.segments
                          : op.scheduledStart && op.scheduledEnd
                            ? [{ start: op.scheduledStart, end: op.scheduledEnd }]
                            : []
                        ).map((seg, i) => {
                          const color = STATUS_COLOR[op.status] || '#2563eb';
                          const late = !!op.isLate;
                          return (
                            <Tooltip
                              key={`${op.id}-${i}`}
                              title={
                                <div style={{ maxWidth: 260 }}>
                                  <div style={{ fontWeight: 700 }}>{op.operationName}</div>
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
                                  {late ? (
                                    <div style={{ color: '#fecaca' }}>
                                      At risk of missing date required ({op.dueDate || '—'})
                                    </div>
                                  ) : null}
                                </div>
                              }
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  navigate(
                                    isWorker
                                      ? `/my-assignments/${op.jobOrderId}`
                                      : `/job-orders/${op.jobOrderId}`
                                  )
                                }
                                style={{
                                  position: 'absolute',
                                  top: 5,
                                  height: rowH - 10,
                                  left: leftPx(seg.start, from, viewMode, isMobile),
                                  width: widthPx(seg.start, seg.end, from, viewMode, isMobile),
                                  background: color,
                                  border: late ? '2px solid #dc2626' : 'none',
                                  borderRadius: 4,
                                  color: '#fff',
                                  fontSize: isMobile ? 9 : 10,
                                  fontWeight: 700,
                                  overflow: 'hidden',
                                  whiteSpace: 'nowrap',
                                  textOverflow: 'ellipsis',
                                  padding: '0 4px',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  zIndex: 2,
                                  boxShadow: late
                                    ? '0 0 0 1px rgba(220,38,38,0.35)'
                                    : undefined,
                                }}
                              >
                                {isMobile
                                  ? op.operationName
                                  : `${op.operationName}${op.jobNumber ? ` · ${op.jobNumber}` : ''}`}
                              </button>
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
          <div style={{ padding: '8px 12px', fontSize: 11, color: '#94a3b8' }}>
            Times in Asia/Manila ({HOUR_START}:00–{HOUR_END}:00). Scroll sideways for more days.
            {isWorker ? ' Read-only.' : ''}
          </div>
        </div>
      )}

      <Drawer
        title="Filters"
        placement="bottom"
        height="auto"
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 24 } }}
      >
        {filterControls}
        <Button type="primary" onClick={() => setFiltersOpen(false)} block>
          Apply
        </Button>
      </Drawer>
    </div>
  );

  if (isWorker) {
    return (
      <div>
        <WorkerPageHeader
          title="Schedule"
          subtitle="Shop-wide production board"
          onBack={() => navigate('/my-assignments')}
          showSchedule={false}
        />
        {board}
      </div>
    );
  }

  return board;
}

function SummaryChip({
  label,
  value,
  hint,
  danger,
  compact,
}: {
  label: string;
  value: string;
  hint?: string;
  danger?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: compact ? '10px 14px' : '10px 12px',
        minWidth: compact ? 140 : undefined,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: compact ? 18 : 16,
          fontWeight: 700,
          color: danger ? '#b91c1c' : NAVY,
          lineHeight: 1.3,
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
