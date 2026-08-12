import { useEffect, useMemo, useState } from 'react';
import { Alert, Spin, Table, Typography, message } from 'antd';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { analyticsApi } from '../../api/analytics.api';
import { getErrorMessage } from '../../api/client';
import type { AnalyticsSalesForecast } from '../../types';
import { SummaryCard } from './AnalyticsChrome';
import { formatInt, formatMoney, useAnalyticsPeriod } from './analyticsPeriod';

const { Title, Text } = Typography;

const AXIS = { fontSize: 13, fill: '#334155' };
const GRID = '#e2e8f0';
const COMMITTED = '#0f1c2e';

export default function AnalyticsForecastPage() {
  const { params } = useAnalyticsPeriod();
  const [data, setData] = useState<AnalyticsSalesForecast | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await analyticsApi.salesForecast(params);
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

  const pipeline = data.committedPipeline;
  const projected = data.projectedRevenue;

  return (
    <div>
      <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
        Looking at jobs from {data.period.from} → {data.period.to} · {data.workingDaysInSample}{' '}
        shop days ({data.sampleWeeks} weeks). Accepted jobs not yet delivered and estimated income
        are separate figures — do not mix them.
      </Text>

      {data.thinSample ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Not enough jobs yet — treat this guess as a rough guide"
          description={
            `Only ${data.sampleWeeks} weeks of shop days so far (we like at least 8). This guess is rough.`
          }
        />
      ) : null}

      <section
        style={{
          background: '#fff',
          border: '2px solid #0f1c2e',
          borderRadius: 8,
          padding: 16,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: '#0f1c2e',
            marginBottom: 4,
          }}
        >
          Fact — not a forecast
        </div>
        <Title level={5} style={{ marginTop: 0, marginBottom: 6, color: '#0f1c2e' }}>
          Accepted jobs not yet delivered
        </Title>
        <Text style={{ display: 'block', marginBottom: 12, fontSize: 13, color: '#334155' }}>
          Jobs the shop has already accepted that are still open — money on the books, not a guess.
        </Text>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <SummaryCard
            label="Accepted, not delivered"
            value={formatMoney(pipeline.totalAmount)}
            hint={`${formatInt(pipeline.jobCount)} open jobs`}
          />
        </div>
        <Title level={5} style={{ marginTop: 0, marginBottom: 8, color: '#0f1c2e', fontSize: 14 }}>
          By expected completion month
        </Title>
        <PipelineMonthChart rows={pipeline.byExpectedCompletionMonth} />
        <Table
          style={{ marginTop: 12 }}
          size="small"
          pagination={false}
          rowKey="month"
          dataSource={pipeline.byExpectedCompletionMonth}
          columns={[
            { title: 'Expected month', dataIndex: 'month' },
            { title: 'Jobs', dataIndex: 'jobCount', width: 80, align: 'right' },
            {
              title: 'Amount',
              dataIndex: 'amount',
              width: 140,
              align: 'right',
              render: (v: number | null) => formatMoney(v),
            },
          ]}
        />
      </section>

      <section
        style={{
          background: '#f8fafc',
          border: '1px dashed #64748b',
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: '#64748b',
            marginBottom: 4,
          }}
        >
          Estimate only
        </div>
        <Title level={5} style={{ marginTop: 0, marginBottom: 6, color: '#0f1c2e' }}>
          Estimated income
        </Title>
        <Text style={{ display: 'block', marginBottom: 12, fontSize: 13, color: '#334155' }}>
          Rough guess from recent finished jobs: average income per shop day, carried forward for
          the next few weeks. Not the same as accepted jobs still open.
        </Text>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 14,
            fontSize: 13,
            color: '#0f1c2e',
          }}
        >
          <SampleChip label="Finished jobs used" value={formatInt(projected.sampleCompletedJobs)} />
          <SampleChip
            label="Shop days used"
            value={formatInt(projected.sampleWorkingDays)}
          />
          <SampleChip label="Weeks used" value={String(projected.sampleWeeks)} />
          <SampleChip label="Looked at" value={`${data.period.from} → ${data.period.to}`} />
          <SampleChip
            label="Looking ahead"
            value={`${projected.horizon.from} → ${projected.horizon.to} (${projected.horizonWorkingDays} shop days)`}
          />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
          }}
        >
          <SummaryCard
            label="Estimated income"
            value={formatMoney(projected.projectedAmount)}
            hint={`About ${formatMoney(projected.revenuePerWorkingDay)} per shop day × ${projected.horizonWorkingDays} days`}
          />
          <SummaryCard
            label="Income per shop day"
            value={formatMoney(projected.revenuePerWorkingDay)}
            hint={`From ${formatInt(projected.sampleCompletedJobs)} finished jobs`}
          />
        </div>
      </section>
    </div>
  );
}

function SampleChip({ label, value }: { label: string; value: string }) {
  return (
    <span
      style={{
        background: '#fff',
        border: '1px solid #cbd5e1',
        borderRadius: 6,
        padding: '6px 10px',
        lineHeight: 1.3,
      }}
    >
      <span style={{ color: '#64748b', fontWeight: 600 }}>{label}: </span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </span>
  );
}

function PipelineMonthChart({
  rows,
}: {
  rows: AnalyticsSalesForecast['committedPipeline']['byExpectedCompletionMonth'];
}) {
  const chartRows = useMemo(
    () => rows.map((r) => ({ month: r.month, amount: r.amount ?? 0, jobs: r.jobCount })),
    [rows],
  );

  if (!chartRows.length) {
    return (
      <Text type="secondary" style={{ fontSize: 13 }}>
        No accepted jobs waiting to be delivered.
      </Text>
    );
  }

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        padding: '12px 8px 8px',
        height: 260,
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartRows} margin={{ top: 12, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis
            dataKey="month"
            tick={AXIS}
            label={{
              value: 'Expected completion',
              position: 'insideBottom',
              offset: -2,
              style: AXIS,
            }}
            height={40}
          />
          <YAxis
            tick={AXIS}
            tickFormatter={(v) => formatMoney(v, 0)}
            width={72}
            label={{ value: 'Amount', angle: -90, position: 'insideLeft', style: AXIS }}
          />
          <Tooltip
            contentStyle={{ fontSize: 13 }}
            formatter={(value: number) => [formatMoney(value), 'Amount']}
            labelFormatter={(label, payload) => {
              const jobs = payload?.[0]?.payload?.jobs;
              return jobs != null ? `${label} · ${jobs} jobs` : String(label);
            }}
          />
          <Bar
            dataKey="amount"
            name="Accepted jobs"
            fill={COMMITTED}
            barSize={36}
            radius={[3, 3, 0, 0]}
          >
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
  );
}
