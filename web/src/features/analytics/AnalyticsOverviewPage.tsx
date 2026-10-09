import { useEffect, useState } from 'react';
import { Spin, message } from 'antd';
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
import { exportCsv } from '../../utils/csvExport';
import { AnalyticsPeriodNote, SummaryCard } from './AnalyticsChrome';
import { AnalyticsGrid, AnalyticsSection, CHART_BOX } from './AnalyticsSection';
import PerformanceSection from './PerformanceSection';
import {
  formatDifferenceFromTarget,
  formatInt,
  formatPct,
  useAnalyticsPeriod,
} from './analyticsPeriod';

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

  const delivered = overview.jobs.onTime + overview.jobs.late;
  const onTimeRate = delivered > 0 ? (overview.jobs.onTime / delivered) * 100 : null;

  const chartData = trend.weeks.map((w) => ({
    week: w.weekStart.slice(5),
    weekFull: w.weekStart,
    variance: w.averageVariancePct,
    operations: w.operationCount,
    jobs: w.jobsFinished,
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
          marginBottom: 16,
        }}
      >
        <SummaryCard
          label="Jobs finished"
          value={formatInt(overview.jobs.completed)}
          hint={`${overview.jobs.onTime} on time · ${overview.jobs.late} late · ${overview.jobs.awaitingDelivery} not yet set For Delivery`}
        />
        <SummaryCard
          label="On time"
          value={formatPct(onTimeRate, 0)}
          hint="Share of jobs set For Delivery by the date required (excludes jobs not yet set For Delivery)"
        />
        <SummaryCard
          label="Average days late"
          value={
            overview.jobs.averageDaysLate == null
              ? '—'
              : `${overview.jobs.averageDaysLate.toFixed(1)} days`
          }
          hint={
            overview.jobs.late > 0
              ? `Longest ${formatInt(overview.jobs.maxDaysLate)} days · ${formatInt(overview.jobs.late)} late jobs`
              : 'No late jobs in this period'
          }
        />
        <SummaryCard
          label="Average difference from target"
          value={formatDifferenceFromTarget(null, overview.efficiency.averageVariancePct)}
          hint={`${overview.efficiency.completedOperationsWithVariance} finished operations that had a target time`}
        />
        <SummaryCard
          label="Redo share of hours"
          value={formatPct(overview.rework.shareOfTotalWorkedHoursPct)}
          hint={`${formatInt(overview.rework.count)} redo jobs · ${formatNumHours(overview.rework.workedHours)} h`}
        />
        <SummaryCard
          label="Redo rate"
          value={formatPct(overview.rework.redoRatePct)}
          hint={`${formatInt(overview.rework.finishedRedoOperationCount)} redo of ${formatInt(overview.rework.finishedOperationCount)} finished operations`}
        />
        <SummaryCard
          label="Machines broken down now"
          value={formatInt(overview.downtime.openCount)}
          hint="Machine units currently stopped for breakdown"
        />
      </div>

      <AnalyticsGrid>
        <AnalyticsSection
          span={12}
          title="Weekly difference from target"
          description="Bars show how many operations and job orders finished that week (weeks start Monday, Manila time). The line shows how far those operations ran from their target time. Weeks with no target times are left blank on the line."
          onExport={() =>
            exportCsv(
              `weekly-difference-from-target-${overview.period.from}_${overview.period.to}.csv`,
              trend.weeks,
              [
                { key: 'week', header: 'WeekStarting', value: (r) => r.weekStart },
                { key: 'ops', header: 'FinishedOperations', value: (r) => r.operationCount },
                { key: 'jobs', header: 'JobsFinished', value: (r) => r.jobsFinished },
                { key: 'var', header: 'DifferenceFromTargetPct', value: (r) => r.averageVariancePct },
              ]
            )
          }
          exportDisabled={!trend.weeks.length}
        >
          <div style={{ ...CHART_BOX, padding: '16px 8px 8px', height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                <XAxis
                  dataKey="week"
                  tick={AXIS}
                  label={{ value: 'Week starting', position: 'insideBottom', offset: -2, style: AXIS }}
                  height={48}
                />
                <YAxis
                  yAxisId="var"
                  tick={AXIS}
                  tickFormatter={(v) => `${v}%`}
                  label={{ value: 'Percent vs target', angle: -90, position: 'insideLeft', style: AXIS }}
                  width={64}
                />
                <YAxis
                  yAxisId="ops"
                  orientation="right"
                  tick={AXIS}
                  allowDecimals={false}
                  label={{ value: 'Finished count', angle: 90, position: 'insideRight', style: AXIS }}
                  width={56}
                />
                <Tooltip
                  contentStyle={{ fontSize: 13 }}
                  formatter={(value: number, name: string) => {
                    if (name === 'variance')
                      return [formatDifferenceFromTarget(null, value), 'Average difference from target'];
                    if (name === 'operations') return [value, 'Finished operations'];
                    if (name === 'jobs') return [value, 'Jobs finished'];
                    return [value, name];
                  }}
                  labelFormatter={(_, payload) =>
                    payload?.[0]?.payload?.weekFull ? `Week of ${payload[0].payload.weekFull}` : ''
                  }
                />
                <Legend
                  verticalAlign="top"
                  wrapperStyle={{ fontSize: 13, paddingBottom: 6 }}
                  formatter={(value) =>
                    value === 'variance'
                      ? 'Average difference from target'
                      : value === 'operations'
                        ? 'Finished operations'
                        : value === 'jobs'
                          ? 'Jobs finished'
                          : value
                  }
                />
                <Bar
                  yAxisId="ops"
                  dataKey="operations"
                  name="operations"
                  fill="#94a3b8"
                  barSize={18}
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  yAxisId="ops"
                  dataKey="jobs"
                  name="jobs"
                  fill="#c9a227"
                  barSize={18}
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
        </AnalyticsSection>
      </AnalyticsGrid>

      <AnalyticsGrid>
        <PerformanceSection span={12} />
      </AnalyticsGrid>
    </div>
  );
}

function formatNumHours(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toFixed(1);
}
