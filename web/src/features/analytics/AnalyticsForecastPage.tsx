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
        Sample window {data.period.from} → {data.period.to} · {data.workingDaysInSample}{' '}
        working days ({data.sampleWeeks} weeks). Committed pipeline and projected revenue are
        separate figures — not interchangeable.
      </Text>

      {data.thinSample ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Thin sample — treat the projection as illustrative"
          description={
            projected.thinSampleNote ||
            `Only ${data.sampleWeeks} weeks of working days in the sample (threshold 8). The trailing-average estimate is less reliable.`
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
          Committed pipeline
        </Title>
        <Text style={{ display: 'block', marginBottom: 12, fontSize: 13, color: '#334155' }}>
          {pipeline.description}
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
          Projected revenue
        </Title>
        <Text style={{ display: 'block', marginBottom: 12, fontSize: 13, color: '#334155' }}>
          {projected.description}
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
          <SampleChip label="Sample jobs" value={formatInt(projected.sampleCompletedJobs)} />
          <SampleChip
            label="Sample working days"
            value={formatInt(projected.sampleWorkingDays)}
          />
          <SampleChip label="Sample weeks" value={String(projected.sampleWeeks)} />
          <SampleChip label="Data window" value={`${data.period.from} → ${data.period.to}`} />
          <SampleChip
            label="Horizon"
            value={`${projected.horizon.from} → ${projected.horizon.to} (${projected.horizonWorkingDays} workdays)`}
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
            label="Projected amount (estimate)"
            value={formatMoney(projected.projectedAmount)}
            hint={`Trailing avg ${formatMoney(projected.revenuePerWorkingDay)}/working day × ${projected.horizonWorkingDays} days`}
          />
          <SummaryCard
            label="Revenue per working day"
            value={formatMoney(projected.revenuePerWorkingDay)}
            hint={`From ${formatInt(projected.sampleCompletedJobs)} completed jobs`}
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
        No open jobs in the committed pipeline.
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
            formatter={(value: number) => [formatMoney(value), 'Committed amount']}
            labelFormatter={(label, payload) => {
              const jobs = payload?.[0]?.payload?.jobs;
              return jobs != null ? `${label} · ${jobs} jobs` : String(label);
            }}
          />
          <Bar
            dataKey="amount"
            name="Committed"
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
