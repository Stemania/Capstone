import { useEffect, useMemo, useState } from 'react';
import { Segmented, Spin, Table, Typography, message } from 'antd';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { analyticsApi } from '../../api/analytics.api';
import { getErrorMessage } from '../../api/client';
import type { AnalyticsSalesSummary } from '../../types';
import { exportCsv } from '../../utils/csvExport';
import {
  AnalyticsSection,
  CHART_BOX,
  ShowDetails,
  withoutAllZero,
  type AnalyticsSpan,
} from './AnalyticsSection';
import { formatInt, formatMoney, useAnalyticsPeriod } from './analyticsPeriod';

const { Text } = Typography;

type View = 'month' | 'client' | 'jobType';

const AXIS = { fontSize: 13, fill: '#334155' };
const GRID = '#e2e8f0';
const FULL = '#0f1c2e';
const PARTIAL = '#1d4ed8';
const JOB_TYPE = '#334155';

const JOB_TYPE_LABEL: Record<string, string> = {
  FABRICATION: 'Fabrication',
  MODIFICATION: 'Modification',
  REPAIR: 'Repair',
};

function stripHistSeed(name: string) {
  return name.replace(/^HIST-SEED\s+/i, '');
}

export default function SalesSection({ span }: { span?: AnalyticsSpan }) {
  const { params } = useAnalyticsPeriod();
  const [view, setView] = useState<View>('month');
  const [data, setData] = useState<AnalyticsSalesSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await analyticsApi.salesSummary(params);
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

  const monthRows = useMemo(
    () =>
      withoutAllZero(data?.byMonth ?? [], (m) => [m.amount, m.jobCount]).map((m) => ({
        month: m.month,
        amount: m.amount ?? 0,
        jobCount: m.jobCount,
        partial: m.partialPeriod,
        workingDays: m.workingDaysCovered,
        label: m.partialPeriod ? `${m.month} · partial · ${m.workingDaysCovered}d` : m.month,
      })),
    [data]
  );
  const clientRows = useMemo(
    () =>
      withoutAllZero(data?.byClient ?? [], (c) => [c.amount, c.jobCount]).map((c) => ({
        ...c,
        name: stripHistSeed(c.clientName || 'Unknown'),
        amount: c.amount ?? 0,
      })),
    [data]
  );
  const jobTypeRows = useMemo(
    () =>
      withoutAllZero(data?.byJobType ?? [], (j) => [j.amount, j.jobCount]).map((j) => ({
        ...j,
        jobTypeLabel: JOB_TYPE_LABEL[j.jobType] || j.jobType,
        amount: j.amount ?? 0,
      })),
    [data]
  );

  const onExport = () => {
    if (!data) return;
    const suffix = `${data.period.from}_${data.period.to}`;
    if (view === 'month') {
      exportCsv(`sales-by-month-${suffix}.csv`, monthRows, [
        { key: 'month', header: 'Month', value: (r) => r.month },
        { key: 'jobs', header: 'JobCount', value: (r) => r.jobCount },
        { key: 'amount', header: 'Amount', value: (r) => r.amount },
        { key: 'partial', header: 'PartialMonth', value: (r) => (r.partial ? 'yes' : 'no') },
        { key: 'days', header: 'WorkingDaysCovered', value: (r) => r.workingDays },
      ]);
    } else if (view === 'client') {
      exportCsv(`sales-by-client-${suffix}.csv`, clientRows, [
        { key: 'client', header: 'Client', value: (r) => r.clientName },
        { key: 'jobs', header: 'JobCount', value: (r) => r.jobCount },
        { key: 'amount', header: 'Amount', value: (r) => r.amount },
        { key: 'avg', header: 'AverageJobValue', value: (r) => r.averageJobValue },
      ]);
    } else {
      exportCsv(`sales-by-job-type-${suffix}.csv`, jobTypeRows, [
        { key: 'type', header: 'JobType', value: (r) => r.jobTypeLabel },
        { key: 'jobs', header: 'JobCount', value: (r) => r.jobCount },
        { key: 'amount', header: 'Amount', value: (r) => r.amount },
      ]);
    }
  };

  return (
    <AnalyticsSection
      span={span}
      title="Sales"
      description={
        data
          ? `Income from finished jobs only: ${formatMoney(data.totalAmount)} from ${formatInt(
              data.completedJobCount
            )} jobs over ${formatInt(data.workingDaysInPeriod)} working days.`
          : 'Income from finished jobs only.'
      }
      controls={
        <Segmented
          size="small"
          value={view}
          onChange={(v) => setView(v as View)}
          options={[
            { label: 'By month', value: 'month' },
            { label: 'By client', value: 'client' },
            { label: 'By job type', value: 'jobType' },
          ]}
        />
      }
      onExport={onExport}
      exportDisabled={!data}
    >
      {loading && !data ? (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : view === 'month' ? (
        <MonthView rows={monthRows} />
      ) : view === 'client' ? (
        <ClientView rows={clientRows} />
      ) : (
        <JobTypeView rows={jobTypeRows} />
      )}
    </AnalyticsSection>
  );
}

type MonthRow = {
  month: string;
  amount: number;
  jobCount: number;
  partial: boolean;
  workingDays: number;
  label: string;
};

function MonthView({ rows }: { rows: MonthRow[] }) {
  if (!rows.length) return <Text type="secondary">No finished-job income in this period.</Text>;
  return (
    <>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
        Solid navy = full month in period. Hatched blue = partial month (working-day count on the
        label).
      </div>
      <div style={{ ...CHART_BOX, padding: '16px 8px 8px', height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 12, right: 16, left: 8, bottom: 28 }}>
            <defs>
              <pattern
                id="partialMonthHatch"
                patternUnits="userSpaceOnUse"
                width="8"
                height="8"
                patternTransform="rotate(45)"
              >
                <rect width="8" height="8" fill={PARTIAL} />
                <line x1="0" y1="0" x2="0" y2="8" stroke="#fff" strokeWidth="3" />
              </pattern>
            </defs>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tick={AXIS}
              interval={0}
              angle={rows.length > 4 ? -20 : 0}
              textAnchor={rows.length > 4 ? 'end' : 'middle'}
              height={64}
              label={{ value: 'Month', position: 'insideBottom', offset: 0, style: AXIS }}
            />
            <YAxis
              tick={AXIS}
              tickFormatter={(v) => formatMoney(v, 0)}
              width={72}
              label={{ value: 'Income', angle: -90, position: 'insideLeft', style: AXIS }}
            />
            <Tooltip
              contentStyle={{ fontSize: 13 }}
              formatter={(value: number, _name, item) => {
                const row = item?.payload;
                const suffix = row?.partial ? ` (partial · ${row.workingDays} working days)` : '';
                return [`${formatMoney(value)}${suffix}`, 'Income'];
              }}
              labelFormatter={(label) => String(label)}
            />
            <Legend
              verticalAlign="top"
              wrapperStyle={{ fontSize: 13, paddingBottom: 6 }}
              payload={[
                { value: 'Full month', type: 'square', color: FULL, id: 'full' },
                { value: 'Partial month', type: 'square', color: PARTIAL, id: 'partial' },
              ]}
            />
            <Bar dataKey="amount" name="Income" barSize={40} radius={[3, 3, 0, 0]}>
              {rows.map((row) => (
                <Cell
                  key={row.month}
                  fill={row.partial ? 'url(#partialMonthHatch)' : FULL}
                  stroke={row.partial ? PARTIAL : FULL}
                  strokeWidth={row.partial ? 1 : 0}
                />
              ))}
              <LabelList
                dataKey="amount"
                position="top"
                formatter={(v: number) => formatMoney(v, 0)}
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
          rowKey="month"
          dataSource={rows}
          columns={[
            {
              title: 'Month',
              dataIndex: 'month',
              render: (v: string, r: MonthRow) =>
                r.partial ? `${v} (partial · ${r.workingDays} working days)` : v,
            },
            { title: 'Jobs', dataIndex: 'jobCount', width: 80, align: 'right' },
            {
              title: 'Income',
              dataIndex: 'amount',
              width: 140,
              align: 'right',
              render: (v: number) => formatMoney(v),
            },
          ]}
        />
      </ShowDetails>
    </>
  );
}

type ClientRow = AnalyticsSalesSummary['byClient'][number] & { name: string; amount: number };

function ClientView({ rows }: { rows: ClientRow[] }) {
  if (!rows.length) return <Text type="secondary">No finished-job income in this period.</Text>;
  return (
    <>
      <div style={{ ...CHART_BOX, padding: '12px 8px 8px', height: Math.max(260, rows.length * 34 + 80) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart layout="vertical" data={rows} margin={{ top: 4, right: 56, left: 8, bottom: 4 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tick={AXIS}
              tickFormatter={(v) => formatMoney(v, 0)}
              label={{ value: 'Income', position: 'insideBottom', offset: -2, style: AXIS }}
              height={40}
            />
            <YAxis type="category" dataKey="name" width={150} tick={{ ...AXIS, fontSize: 12 }} />
            <Tooltip contentStyle={{ fontSize: 13 }} formatter={(value: number) => [formatMoney(value), 'Income']} />
            <Bar dataKey="amount" fill={FULL} barSize={16} radius={[0, 3, 3, 0]}>
              <LabelList
                dataKey="amount"
                position="right"
                formatter={(v: number) => formatMoney(v, 0)}
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
          rowKey="clientId"
          dataSource={rows}
          columns={[
            { title: 'Client', dataIndex: 'name' },
            { title: 'Jobs', dataIndex: 'jobCount', width: 72, align: 'right' },
            {
              title: 'Income',
              dataIndex: 'amount',
              width: 120,
              align: 'right',
              render: (v: number) => formatMoney(v),
            },
            {
              title: 'Avg job value',
              dataIndex: 'averageJobValue',
              width: 120,
              align: 'right',
              render: (v: number | null) => formatMoney(v),
            },
          ]}
        />
      </ShowDetails>
    </>
  );
}

type JobTypeRow = AnalyticsSalesSummary['byJobType'][number] & { jobTypeLabel: string; amount: number };

function JobTypeView({ rows }: { rows: JobTypeRow[] }) {
  if (!rows.length) return <Text type="secondary">No finished-job income in this period.</Text>;
  return (
    <>
      <div style={{ ...CHART_BOX, padding: '16px 8px 8px', height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 12, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis dataKey="jobTypeLabel" tick={AXIS} />
            <YAxis
              tick={AXIS}
              tickFormatter={(v) => formatMoney(v, 0)}
              width={72}
              label={{ value: 'Income', angle: -90, position: 'insideLeft', style: AXIS }}
            />
            <Tooltip contentStyle={{ fontSize: 13 }} formatter={(value: number) => [formatMoney(value), 'Income']} />
            <Bar dataKey="amount" fill={JOB_TYPE} barSize={48} radius={[3, 3, 0, 0]}>
              <LabelList
                dataKey="amount"
                position="top"
                formatter={(v: number) => formatMoney(v, 0)}
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
          rowKey="jobType"
          dataSource={rows}
          columns={[
            { title: 'Job type', dataIndex: 'jobTypeLabel' },
            { title: 'Jobs', dataIndex: 'jobCount', width: 80, align: 'right' },
            {
              title: 'Income',
              dataIndex: 'amount',
              width: 140,
              align: 'right',
              render: (v: number) => formatMoney(v),
            },
          ]}
        />
      </ShowDetails>
    </>
  );
}
