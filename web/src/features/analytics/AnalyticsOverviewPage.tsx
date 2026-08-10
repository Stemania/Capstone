import { useEffect, useState } from 'react';
import { Spin, Typography, message } from 'antd';
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Bar,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { analyticsApi } from '../../api/analytics.api';
import { getErrorMessage } from '../../api/client';
import type { AnalyticsOverview, AnalyticsTrend } from '../../types';
import { AnalyticsPeriodNote, SummaryCard } from './AnalyticsChrome';
import { formatInt, formatPct, useAnalyticsPeriod } from './analyticsPeriod';

const { Title } = Typography;

const AXIS = { fontSize: 13, fill: '#334155' };
const GRID = '#e2e8f0';

export default function AnalyticsOverviewPage() {
  const { params } = useAnalyticsPeriod();
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [trend, setTrend] = useState<AnalyticsTrend | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [o, t] = await Promise.all([
          analyticsApi.overview(params),
          analyticsApi.trend(params),
        ]);
        if (!cancelled) {
          setOverview(o.data);
          setTrend(t.data);
        }
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

  if (loading && !overview) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!overview || !trend) return null;

  const completed = overview.jobs.completed;
  const onTimeRate =
    completed > 0 ? (overview.jobs.onTime / completed) * 100 : null;

  const chartData = trend.weeks.map((w) => ({
    week: w.weekStart.slice(5),
    weekFull: w.weekStart,
    variance: w.averageVariancePct,
    operations: w.operationCount,
  }));

  return (
    <div>
      <AnalyticsPeriodNote
        from={overview.period.from}
        to={overview.period.to}
        excludedOperationCount={overview.excludedOperationCount}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <SummaryCard
          label="Jobs completed"
          value={formatInt(overview.jobs.completed)}
          hint={`${overview.jobs.onTime} on time · ${overview.jobs.late} late`}
        />
        <SummaryCard
          label="On-time rate"
          value={formatPct(onTimeRate, 0).replace('+', '')}
          hint="vs date required"
        />
        <SummaryCard
          label="Avg variance"
          value={formatPct(overview.efficiency.averageVariancePct)}
          hint={`${overview.efficiency.completedOperationsWithVariance} ops with estimate`}
        />
        <SummaryCard
          label="Rework share"
          value={formatPct(overview.rework.shareOfTotalWorkedHoursPct).replace('+', '')}
          hint={`${formatInt(overview.rework.count)} follow-ons · ${formatNumHours(overview.rework.workedHours)}h`}
        />
        <SummaryCard
          label="Open downtime"
          value={formatInt(overview.downtime.openCount)}
          hint="machine units currently down"
        />
      </div>

      <Title level={5} style={{ marginTop: 0, marginBottom: 8, color: '#0f1c2e' }}>
        Weekly variance trend
      </Title>
      <div
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          padding: '16px 8px 8px',
          height: 360,
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis dataKey="week" tick={AXIS} label={{ value: 'Week starting', position: 'insideBottom', offset: -2, style: AXIS }} height={48} />
            <YAxis
              yAxisId="var"
              tick={AXIS}
              tickFormatter={(v) => `${v}%`}
              label={{ value: 'Avg variance %', angle: -90, position: 'insideLeft', style: AXIS }}
              width={64}
            />
            <YAxis
              yAxisId="ops"
              orientation="right"
              tick={AXIS}
              label={{ value: 'Operations', angle: 90, position: 'insideRight', style: AXIS }}
              width={56}
            />
            <Tooltip
              contentStyle={{ fontSize: 13 }}
              formatter={(value: number, name: string) => {
                if (name === 'variance') return [`${value?.toFixed?.(1) ?? '—'}%`, 'Avg variance'];
                if (name === 'operations') return [value, 'Operations'];
                return [value, name];
              }}
              labelFormatter={(_, payload) =>
                payload?.[0]?.payload?.weekFull
                  ? `Week of ${payload[0].payload.weekFull}`
                  : ''
              }
            />
            <Legend wrapperStyle={{ fontSize: 13 }} />
            <Bar
              yAxisId="ops"
              dataKey="operations"
              name="operations"
              fill="#94a3b8"
              barSize={28}
              radius={[3, 3, 0, 0]}
            />
            <Line
              yAxisId="var"
              type="monotone"
              dataKey="variance"
              name="variance"
              stroke="#0f1c2e"
              strokeWidth={2.5}
              dot={{ r: 4, fill: '#0f1c2e' }}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
        Bars = operation count (sample size). Line = average variance % (null weeks omitted from the line).
      </div>
    </div>
  );
}

function formatNumHours(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toFixed(1);
}
