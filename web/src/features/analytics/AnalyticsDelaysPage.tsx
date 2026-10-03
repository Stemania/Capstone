import { useEffect, useState } from 'react';
import { Spin, Table, Tag, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import { SHOP_TZ } from '../../utils/shopTime';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
} from 'recharts';
import { analyticsApi } from '../../api/analytics.api';
import { getErrorMessage } from '../../api/client';
import type { AnalyticsDelays, AnalyticsLateJobCause } from '../../types';
import { exportCsv } from '../../utils/csvExport';
import { AnalyticsPeriodNote } from './AnalyticsChrome';
import {
  AnalyticsGrid,
  AnalyticsSection,
  CHART_BOX,
  ShowDetails,
  withoutAllZero,
} from './AnalyticsSection';
import { formatInt, useAnalyticsPeriod } from './analyticsPeriod';

const { Text } = Typography;
const AXIS = { fontSize: 13, fill: '#334155' };
const HOURS = '#0f1c2e';
const OPEN = '#b45309';
const CLOSED = '#0f1c2e';
const CUMULATIVE = '#b45309';

const CAUSE_TYPE_LABEL: Record<string, string> = {
  PAUSE: 'Pause',
  DOWNTIME: 'Downtime',
  REWORK: 'Rework',
  MATERIAL: 'Material',
};

const fmtShop = (iso: string) => dayjs(iso).tz(SHOP_TZ).format('MMM D, HH:mm');
const fmtDay = (iso: string) => dayjs(iso).format('MMM D, YYYY');

function reasonLabel(reason: string) {
  const map: Record<string, string> = {
    END_OF_SHIFT: 'End of shift',
    BREAK: 'Break',
    MACHINE_DOWN: 'Machine down',
    WAITING_MATERIAL: 'Waiting for material',
    WAITING_PRIOR_OPERATION: 'Waiting on prior operation',
    OTHER: 'Other',
    MACHINE_DOWNTIME: 'Machine downtime',
    REWORK: 'Rework',
  };
  if (map[reason]) return map[reason];
  return reason
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

function causeLabel(c: AnalyticsLateJobCause) {
  return c.cause === c.label ? reasonLabel(c.cause) : c.label;
}

export default function AnalyticsDelaysPage() {
  const { params } = useAnalyticsPeriod();
  const [data, setData] = useState<AnalyticsDelays | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await analyticsApi.delays(params);
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
  }, [params.from, params.to]);

  if (loading && !data) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!data) return null;

  const causeRows = withoutAllZero(data.causes || [], (r) => [r.hours, r.occurrenceCount]).map(
    (r) => ({
      name: r.label || reasonLabel(r.cause),
      hours: r.hours ?? 0,
      share: r.shareOfTotalPct ?? 0,
      cumulative: r.cumulativePct ?? 0,
      count: r.occurrenceCount,
      causeType: r.causeType,
    })
  );

  const brokenUnits = withoutAllZero(data.machineDowntime, (d) => [
    d.occurrenceCount,
    d.totalDowntimeHours,
    d.openCount,
  ]);
  const downtimeRows = brokenUnits.map((d) => ({
    name: d.machineUnitLabel || d.machineUnitId.slice(0, 8),
    hours: d.totalDowntimeHours ?? 0,
    open: d.openCount > 0,
    type: d.machineTypeCode,
  }));

  const materialDelays = data.materialDelays ?? [];
  const lateJobs = data.lateJobs ?? [];
  const excluded = data.excludedNonWorkingPauses;
  const chartHeight = Math.max(320, causeRows.length * 28 + 120, downtimeRows.length * 40 + 80);

  return (
    <div>
      <AnalyticsPeriodNote
        from={data.period.from}
        to={data.period.to}
        excludedOperationCount={data.excludedOperationCount}
      />

      <AnalyticsGrid>
        <AnalyticsSection
          span={7}
          title="What causes delays"
          description="Delay hours from late materials, pause reasons, machine breakdowns, and redo work, largest first, with the running share."
          onExport={() =>
            exportCsv(`delay-causes-${data.period.from}_${data.period.to}.csv`, causeRows, [
              { key: 'cause', header: 'Cause', value: (r) => r.name },
              { key: 'type', header: 'Type', value: (r) => CAUSE_TYPE_LABEL[r.causeType] || r.causeType },
              { key: 'count', header: 'Occurrences', value: (r) => r.count },
              { key: 'hours', header: 'Hours', value: (r) => r.hours },
              { key: 'share', header: 'SharePct', value: (r) => r.share },
              { key: 'cum', header: 'CumulativePct', value: (r) => r.cumulative },
            ])
          }
          exportDisabled={!causeRows.length}
        >
          {causeRows.length === 0 ? (
            <Text type="secondary">No delay causes in this period.</Text>
          ) : (
            <>
              <div
                style={{ ...CHART_BOX, padding: 12, height: chartHeight }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={causeRows} margin={{ top: 8, right: 24, left: 8, bottom: 48 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="name"
                      tick={AXIS}
                      interval={0}
                      angle={-25}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis
                      yAxisId="hours"
                      tick={AXIS}
                      label={{ value: 'Hours', angle: -90, position: 'insideLeft', style: AXIS }}
                    />
                    <YAxis
                      yAxisId="pct"
                      orientation="right"
                      domain={[0, 100]}
                      tick={AXIS}
                      tickFormatter={(v) => `${v}%`}
                      label={{ value: 'Cumulative %', angle: 90, position: 'insideRight', style: AXIS }}
                    />
                    <Tooltip
                      contentStyle={{ fontSize: 13 }}
                      formatter={(value: number, name: string) => {
                        if (name === 'hours' || name === 'Hours') {
                          return [`${Number(value).toFixed(1)} h`, 'Hours'];
                        }
                        if (name === 'cumulative' || name === 'Cumulative %') {
                          return [`${Number(value).toFixed(1)}%`, 'Cumulative'];
                        }
                        return [value, name];
                      }}
                    />
                    <Legend verticalAlign="top" wrapperStyle={{ fontSize: 13, paddingBottom: 6 }} />
                    <Bar yAxisId="hours" dataKey="hours" name="Hours" fill={HOURS} barSize={28}>
                      <LabelList
                        dataKey="hours"
                        position="top"
                        formatter={(v: number) => `${Number(v).toFixed(1)}`}
                        style={{ fontSize: 11, fill: '#334155' }}
                      />
                    </Bar>
                    <Line
                      yAxisId="pct"
                      type="monotone"
                      dataKey="cumulative"
                      name="Cumulative %"
                      stroke={CUMULATIVE}
                      strokeWidth={2}
                      dot={{ r: 3, fill: CUMULATIVE }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <ShowDetails>
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(r) => `${r.causeType}-${r.name}`}
                  dataSource={causeRows}
                  columns={[
                    { title: 'Cause', dataIndex: 'name' },
                    {
                      title: 'Type',
                      dataIndex: 'causeType',
                      width: 110,
                      render: (t: string) => <Tag>{CAUSE_TYPE_LABEL[t] || t}</Tag>,
                    },
                    {
                      title: 'Occurrences',
                      dataIndex: 'count',
                      width: 110,
                      align: 'right',
                      render: (v: number) => formatInt(v),
                    },
                    {
                      title: 'Hours',
                      dataIndex: 'hours',
                      width: 100,
                      align: 'right',
                      render: (v: number) => `${v.toFixed(1)} h`,
                    },
                    {
                      title: 'Share',
                      dataIndex: 'share',
                      width: 90,
                      align: 'right',
                      render: (v: number) => `${v.toFixed(1)}%`,
                    },
                    {
                      title: 'Cumulative',
                      dataIndex: 'cumulative',
                      width: 110,
                      align: 'right',
                      render: (v: number) => `${v.toFixed(1)}%`,
                    },
                  ]}
                />
              </ShowDetails>
            </>
          )}
        </AnalyticsSection>

        <AnalyticsSection
          span={5}
          title="Machine breakdowns by unit"
          description={
            <>
              Only units that broke down in this period.{' '}
              <span style={{ color: OPEN, fontWeight: 600 }}>Amber</span> = still down.{' '}
              <span style={{ color: CLOSED, fontWeight: 600 }}>Navy</span> = back in use.
            </>
          }
          onExport={() =>
            exportCsv(`machine-breakdowns-${data.period.from}_${data.period.to}.csv`, brokenUnits, [
              { key: 'unit', header: 'Unit', value: (r) => r.machineUnitLabel || r.machineUnitId },
              { key: 'type', header: 'Type', value: (r) => r.machineTypeCode },
              { key: 'count', header: 'Occurrences', value: (r) => r.occurrenceCount },
              { key: 'hours', header: 'MachineBreakdownHours', value: (r) => r.totalDowntimeHours },
              { key: 'open', header: 'StillDown', value: (r) => r.openCount },
            ])
          }
          exportDisabled={!brokenUnits.length}
        >
          {downtimeRows.length === 0 ? (
            <Text type="secondary">No machine breakdowns in this period.</Text>
          ) : (
            <>
              <div
                style={{ ...CHART_BOX, padding: 12, height: chartHeight }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={downtimeRows} margin={{ top: 8, right: 48, left: 8, bottom: 8 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={AXIS}
                      label={{
                        value: 'Machine breakdown hours',
                        position: 'insideBottom',
                        offset: -2,
                        style: AXIS,
                      }}
                      height={40}
                    />
                    <YAxis type="category" dataKey="name" width={120} tick={AXIS} />
                    <Tooltip
                      contentStyle={{ fontSize: 13 }}
                      formatter={(value: number) => [
                        `${Number(value).toFixed(1)} h`,
                        'Machine breakdown hours',
                      ]}
                      labelFormatter={(label, payload) => {
                        const row = payload?.[0]?.payload as
                          | { name: string; open: boolean; type?: string | null }
                          | undefined;
                        if (!row) return String(label);
                        return `${row.name}${row.open ? ' · still down' : ''} · ${row.type || ''}`;
                      }}
                    />
                    <Bar dataKey="hours" name="Machine breakdown hours" barSize={16}>
                      {downtimeRows.map((r) => (
                        <Cell key={r.name} fill={r.open ? OPEN : CLOSED} />
                      ))}
                      <LabelList
                        dataKey="hours"
                        position="right"
                        formatter={(v: number) => `${v.toFixed(1)}h`}
                        style={{ fontSize: 11, fill: '#334155' }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ShowDetails>
                <Table
                  size="small"
                  pagination={false}
                  rowKey="machineUnitId"
                  dataSource={brokenUnits}
                  columns={[
                    {
                      title: 'Unit',
                      dataIndex: 'machineUnitLabel',
                      render: (label: string | null, row) => (
                        <span>
                          {label || row.machineUnitId.slice(0, 8)}{' '}
                          {row.openCount > 0 ? <Tag color="orange">Still down</Tag> : null}
                        </span>
                      ),
                    },
                    { title: 'Type', dataIndex: 'machineTypeCode', width: 100 },
                    { title: 'Occurrences', dataIndex: 'occurrenceCount', width: 110, align: 'right' },
                    {
                      title: 'Machine breakdown hours',
                      dataIndex: 'totalDowntimeHours',
                      width: 170,
                      align: 'right',
                      render: (v: number | null) => (v == null ? '—' : `${v.toFixed(1)} h`),
                    },
                  ]}
                />
              </ShowDetails>
            </>
          )}
        </AnalyticsSection>
      </AnalyticsGrid>

      <AnalyticsGrid>
        <AnalyticsSection
          title="Material delay by job"
          description="Jobs moved later because a supplier delivered late, or because materials were not ordered in time. Working hours already lost: from the planned start before the move to the first operation's actual start, or to now if it has not started. Moves made only because a start date passed are not counted."
          onExport={() =>
            exportCsv(`material-delay-${data.period.from}_${data.period.to}.csv`, materialDelays, [
              { key: 'job', header: 'JobOrder', value: (r) => r.jobNumber },
              { key: 'cause', header: 'Cause', value: (r) => r.causeLabel },
              { key: 'supplier', header: 'ResponsibleSupplier', value: (r) => r.supplierNames ?? '' },
              { key: 'po', header: 'PO', value: (r) => r.suppliers.map((s) => s.poNumber).filter(Boolean).join(' ') },
              { key: 'orig', header: 'OriginalStart', value: (r) => r.originalStart },
              { key: 'first', header: 'FirstStart', value: (r) => r.firstStart },
              { key: 'started', header: 'Started', value: (r) => (r.started ? 'Yes' : 'No') },
              { key: 'hours', header: 'WorkingHours', value: (r) => r.hours },
            ])
          }
          exportDisabled={!materialDelays.length}
        >
          {materialDelays.length === 0 ? (
            <Text type="secondary">No material delays in this period.</Text>
          ) : (
            <Table
              size="small"
              pagination={materialDelays.length > 10 ? { pageSize: 10 } : false}
              rowKey={(r) => `${r.jobOrderId}-${r.cause}`}
              dataSource={materialDelays}
              columns={[
                {
                  title: 'Job order',
                  dataIndex: 'jobNumber',
                  width: 140,
                  render: (v: string, r) => <Link to={`/job-orders/${r.jobOrderId}`}>{v}</Link>,
                },
                {
                  title: 'Cause',
                  dataIndex: 'cause',
                  width: 130,
                  render: (v: string) =>
                    v === 'SUPPLIER_LATE' ? <Tag color="red">Supplier late</Tag> : <Tag color="gold">Not ordered</Tag>,
                },
                {
                  title: 'Responsible supplier',
                  key: 'supplier',
                  render: (_: unknown, r) =>
                    r.cause !== 'SUPPLIER_LATE' ? (
                      <Text type="secondary">Materials not ordered in time</Text>
                    ) : r.suppliers.length ? (
                      r.suppliers.map((s) => (
                        <div key={s.supplierName}>
                          {s.supplierName}
                          {s.poNumber ? <Text type="secondary"> · {s.poNumber}</Text> : null}
                        </div>
                      ))
                    ) : (
                      <Text type="secondary">Materials not ordered</Text>
                    ),
                },
                {
                  title: 'Planned start',
                  dataIndex: 'originalStart',
                  width: 130,
                  render: (v: string) => fmtShop(v),
                },
                {
                  title: 'First start',
                  dataIndex: 'firstStart',
                  width: 150,
                  render: (v: string, r) => (
                    <span>
                      {fmtShop(v)}
                      {r.started ? null : <Text type="secondary"> (planned)</Text>}
                    </span>
                  ),
                },
                {
                  title: 'Delay',
                  dataIndex: 'hours',
                  width: 90,
                  align: 'right',
                  render: (v: number | null) => (v == null ? '—' : `${v.toFixed(1)} h`),
                },
              ]}
            />
          )}
        </AnalyticsSection>
      </AnalyticsGrid>

      <AnalyticsGrid>
        <AnalyticsSection
          title="Late job orders"
          description="Job orders delivered in this period after their required date, with the delay causes recorded against each over the whole job."
          onExport={() =>
            exportCsv(`late-job-orders-${data.period.from}_${data.period.to}.csv`, lateJobs, [
              { key: 'job', header: 'JobOrder', value: (r) => r.jobNumber },
              { key: 'client', header: 'Client', value: (r) => r.clientName },
              { key: 'due', header: 'RequiredDate', value: (r) => r.dueDate },
              { key: 'delivered', header: 'DeliveredDate', value: (r) => r.deliveredDate },
              { key: 'late', header: 'DaysLate', value: (r) => r.daysLate },
              {
                key: 'causes',
                header: 'Causes',
                value: (r) =>
                  r.causes.map((c) => `${causeLabel(c)} ${c.hours.toFixed(1)}h`).join('; ') ||
                  'None recorded',
              },
            ])
          }
          exportDisabled={!lateJobs.length}
        >
          {lateJobs.length === 0 ? (
            <Text type="secondary">No job orders delivered late in this period.</Text>
          ) : (
            <Table
              size="small"
              pagination={lateJobs.length > 10 ? { pageSize: 10 } : false}
              rowKey="jobOrderId"
              dataSource={lateJobs}
              columns={[
                {
                  title: 'Job order',
                  dataIndex: 'jobNumber',
                  width: 140,
                  render: (v: string, r) => <Link to={`/job-orders/${r.jobOrderId}`}>{v}</Link>,
                },
                { title: 'Client', dataIndex: 'clientName', width: 170, render: (v) => v || '—' },
                { title: 'Required', dataIndex: 'dueDate', width: 120, render: (v: string) => fmtDay(v) },
                {
                  title: 'Delivered',
                  dataIndex: 'deliveredDate',
                  width: 120,
                  render: (v: string) => fmtDay(v),
                },
                {
                  title: 'Days late',
                  dataIndex: 'daysLate',
                  width: 90,
                  align: 'right',
                  render: (v: number) => <span style={{ color: '#b91c1c', fontWeight: 600 }}>{v}</span>,
                },
                {
                  title: 'Causes',
                  key: 'causes',
                  render: (_: unknown, r) =>
                    r.causes.length ? (
                      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {r.causes.map((c) => (
                          <Tag key={c.cause} title={c.detail ?? undefined} style={{ marginInlineEnd: 0 }}>
                            {causeLabel(c)} {c.hours.toFixed(1)} h
                            {c.detail ? <span style={{ color: '#64748b' }}> · {c.detail}</span> : null}
                          </Tag>
                        ))}
                      </span>
                    ) : (
                      <Text type="secondary">None recorded</Text>
                    ),
                },
              ]}
            />
          )}
        </AnalyticsSection>
      </AnalyticsGrid>

      <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
        Machine breakdowns are measured in shop working hours. Where a &ldquo;Machine down&rdquo;
        pause overlaps a breakdown on the same machine, that time is counted once
        {data.breakdownOverlapHours ? ` (${data.breakdownOverlapHours.toFixed(1)} h overlap removed)` : ''}.
        Pause time inside the period is counted even if the operation has not finished.
      </Text>
      <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
        Breaks and end-of-shift pauses are normal non-working time and are not counted as delays
        {excluded && excluded.totalHours
          ? ` (${(excluded.totalHours ?? 0).toFixed(1)} h left out: ${(excluded.breakHours ?? 0).toFixed(1)} h breaks, ${(excluded.endOfShiftHours ?? 0).toFixed(1)} h end of shift).`
          : '.'}
      </Text>
    </div>
  );
}
