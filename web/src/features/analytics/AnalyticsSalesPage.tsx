import { useEffect, useMemo, useState } from 'react';
import { Spin, Table, Typography, message } from 'antd';
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
import { SummaryCard } from './AnalyticsChrome';
import { formatInt, formatMoney, useAnalyticsPeriod } from './analyticsPeriod';

const { Title, Text } = Typography;

const AXIS = { fontSize: 13, fill: '#334155' };
const GRID = '#e2e8f0';
const FULL = '#0f1c2e';
const PARTIAL = '#1d4ed8';
const JOB_TYPE = '#334155';

export default function AnalyticsSalesPage() {
  const { params } = useAnalyticsPeriod();
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

  if (loading && !data) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!data) return null;

  return (
    <div>
      <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 16 }}>
        Period {data.period.from} → {data.period.to} · {data.workingDaysInPeriod} working days ·
        completed revenue only.
      </Text>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <SummaryCard
          label="Completed revenue"
          value={formatMoney(data.totalAmount)}
          hint={`${formatInt(data.completedJobCount)} jobs`}
        />
        <SummaryCard
          label="Working days"
          value={formatInt(data.workingDaysInPeriod)}
          hint="in selected period"
        />
        <SummaryCard
          label="Clients"
          value={formatInt(data.byClient.length)}
          hint="with completed jobs"
        />
      </div>

      <MonthSection data={data} />
      <ClientSection data={data} />
      <JobTypeSection data={data} />
    </div>
  );
}

function MonthSection({ data }: { data: AnalyticsSalesSummary }) {
  const rows = useMemo(
    () =>
      data.byMonth.map((m) => ({
        month: m.month,
        amount: m.amount ?? 0,
        jobCount: m.jobCount,
        partial: m.partialPeriod,
        workingDays: m.workingDaysCovered,
        label: m.partialPeriod
          ? `${m.month} · partial · ${m.workingDaysCovered}d`
          : m.month,
      })),
    [data.byMonth],
  );

  return (
    <section style={{ marginBottom: 28 }}>
      <Title level={5} style={{ marginTop: 0, marginBottom: 8, color: '#0f1c2e' }}>
        Revenue by month
      </Title>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
        Solid navy = full month in period. Hatched blue = partial month (working-day count on the
        label).
      </div>
      <div
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          padding: '16px 8px 8px',
          height: 340,
        }}
      >
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
              label={{ value: 'Month', position: 'insideBottom', offset: -18, style: AXIS }}
            />
            <YAxis
              tick={AXIS}
              tickFormatter={(v) => formatMoney(v, 0)}
              width={72}
              label={{ value: 'Revenue', angle: -90, position: 'insideLeft', style: AXIS }}
            />
            <Tooltip
              contentStyle={{ fontSize: 13 }}
              formatter={(value: number, _name, item) => {
                const row = item?.payload;
                const suffix = row?.partial
                  ? ` (partial · ${row.workingDays} working days)`
                  : '';
                return [`${formatMoney(value)}${suffix}`, 'Revenue'];
              }}
              labelFormatter={(label) => String(label)}
            />
            <Legend
              wrapperStyle={{ fontSize: 13 }}
              payload={[
                { value: 'Full month', type: 'square', color: FULL, id: 'full' },
                { value: 'Partial month', type: 'square', color: PARTIAL, id: 'partial' },
              ]}
            />
            <Bar dataKey="amount" name="Revenue" barSize={40} radius={[3, 3, 0, 0]}>
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
    </section>
  );
}

function ClientSection({ data }: { data: AnalyticsSalesSummary }) {
  const rows = useMemo(
    () =>
      data.byClient.map((c) => ({
        ...c,
        name: stripHistSeed(c.clientName || 'Unknown'),
        amount: c.amount ?? 0,
      })),
    [data.byClient],
  );

  return (
    <section style={{ marginBottom: 28 }}>
      <Title level={5} style={{ marginTop: 0, marginBottom: 8, color: '#0f1c2e' }}>
        Revenue by client
      </Title>
      <div
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          padding: '12px 8px 8px',
          height: Math.max(280, rows.length * 36 + 80),
          marginBottom: 12,
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={rows}
            margin={{ top: 4, right: 56, left: 8, bottom: 4 }}
          >
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tick={AXIS}
              tickFormatter={(v) => formatMoney(v, 0)}
              label={{ value: 'Revenue', position: 'insideBottom', offset: -2, style: AXIS }}
              height={40}
            />
            <YAxis type="category" dataKey="name" width={150} tick={{ ...AXIS, fontSize: 12 }} />
            <Tooltip
              contentStyle={{ fontSize: 13 }}
              formatter={(value: number) => [formatMoney(value), 'Revenue']}
            />
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
      <Table
        size="small"
        pagination={false}
        rowKey="clientId"
        dataSource={rows}
        columns={[
          { title: 'Client', dataIndex: 'name' },
          { title: 'Jobs', dataIndex: 'jobCount', width: 72, align: 'right' },
          {
            title: 'Revenue',
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
    </section>
  );
}

function JobTypeSection({ data }: { data: AnalyticsSalesSummary }) {
  const rows = useMemo(
    () =>
      data.byJobType.map((j) => ({
        ...j,
        amount: j.amount ?? 0,
      })),
    [data.byJobType],
  );

  return (
    <section style={{ marginBottom: 8 }}>
      <Title level={5} style={{ marginTop: 0, marginBottom: 8, color: '#0f1c2e' }}>
        Revenue by job type
      </Title>
      <div
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          padding: '16px 8px 8px',
          height: 280,
          marginBottom: 12,
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 12, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis dataKey="jobType" tick={AXIS} />
            <YAxis
              tick={AXIS}
              tickFormatter={(v) => formatMoney(v, 0)}
              width={72}
              label={{ value: 'Revenue', angle: -90, position: 'insideLeft', style: AXIS }}
            />
            <Tooltip
              contentStyle={{ fontSize: 13 }}
              formatter={(value: number) => [formatMoney(value), 'Revenue']}
            />
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
      <Table
        size="small"
        pagination={false}
        rowKey="jobType"
        dataSource={rows}
        columns={[
          { title: 'Job type', dataIndex: 'jobType' },
          { title: 'Jobs', dataIndex: 'jobCount', width: 80, align: 'right' },
          {
            title: 'Revenue',
            dataIndex: 'amount',
            width: 140,
            align: 'right',
            render: (v: number) => formatMoney(v),
          },
        ]}
      />
    </section>
  );
}

function stripHistSeed(name: string) {
  return name.replace(/^HIST-SEED\s+/i, '');
}
