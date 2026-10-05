import { formatShop } from '../../utils/shopTime';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Spin, Table, Typography, message } from 'antd';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { analyticsApi } from '../../api/analytics.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import type {
  AnalyticsDemandCapacity,
  AnalyticsDemandForecast,
  AnalyticsSalesForecast,
  ConsumableRunOut,
  MovingAverageForecast,
} from '../../types';
import { exportCsv } from '../../utils/csvExport';
import { SummaryCard } from './AnalyticsChrome';
import {
  AnalyticsGrid,
  AnalyticsSection,
  CHART_BOX,
  ShowDetails,
  withoutAllZero,
} from './AnalyticsSection';
import { formatInt, formatMoney, formatNum, useAnalyticsPeriod } from './analyticsPeriod';

const { Text } = Typography;

const AXIS = { fontSize: 13, fill: '#334155' };
const GRID = '#e2e8f0';
const NORMAL = '#0f1c2e';
const CONSTRAINT = '#b45309';

const JOB_TYPE_LABEL: Record<string, string> = {
  FABRICATION: 'Fabrication',
  MODIFICATION: 'Modification',
  REPAIR: 'Repair',
};

type Fmt = (v: number | null | undefined) => string;

const monthLabel = (m: string) => formatShop(`${m}-01`, 'MMM YYYY');
const formatPct = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)}%`);
const formatCount: Fmt = (v) => formatNum(v, 1);

function estimateValue(f: MovingAverageForecast, fmt: Fmt) {
  return f.enoughHistory ? fmt(f.forecast) : 'Not enough history yet';
}

function estimateHint(f: MovingAverageForecast, fmt: Fmt) {
  if (!f.enoughHistory) {
    return `${f.monthsAvailable} complete month${f.monthsAvailable === 1 ? '' : 's'} of data; needs ${f.monthsNeeded}`;
  }
  return `Estimate · ${f.method} · MAE ${fmt(f.mae)} · MAPE ${formatPct(f.mapePct)} over ${f.backtestedMonths} tested months`;
}

function BacktestTable({ forecast, fmt }: { forecast: MovingAverageForecast; fmt: Fmt }) {
  return (
    <Table
      size="small"
      pagination={false}
      rowKey="month"
      dataSource={[...forecast.months].reverse()}
      locale={{ emptyText: 'No complete months yet.' }}
      columns={[
        { title: 'Month', dataIndex: 'month', render: (m: string) => monthLabel(m) },
        { title: 'Actual', dataIndex: 'actual', align: 'right', render: (v: number | null) => fmt(v) },
        {
          title: 'Moving average',
          dataIndex: 'forecast',
          align: 'right',
          render: (v: number | null) => (v == null ? '—' : fmt(v)),
        },
        {
          title: 'Error',
          dataIndex: 'absoluteError',
          align: 'right',
          render: (v: number | null) => (v == null ? '—' : fmt(v)),
        },
      ]}
    />
  );
}

export default function AnalyticsForecastPage() {
  const { params } = useAnalyticsPeriod();
  const isAdmin = useAuth().user?.role === 'ADMIN';
  const [capacity, setCapacity] = useState<AnalyticsDemandCapacity | null>(null);
  const [forecast, setForecast] = useState<AnalyticsSalesForecast | null>(null);
  const [demand, setDemand] = useState<AnalyticsDemandForecast | null>(null);
  const [runOut, setRunOut] = useState<ConsumableRunOut | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [c, f] = await Promise.all([
          isAdmin ? analyticsApi.demandCapacity(params) : Promise.resolve(null),
          analyticsApi.salesForecast(params),
        ]);
        if (!cancelled) {
          setCapacity(c?.data ?? null);
          setForecast(f.data);
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
  }, [params.from, params.to, isAdmin]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([analyticsApi.demandForecast(), analyticsApi.consumableRunOut()])
      .then(([d, r]) => {
        if (cancelled) return;
        setDemand(d.data);
        setRunOut(r.data);
      })
      .catch((err) => {
        if (!cancelled) message.error(getErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    if (!capacity) return [];
    return withoutAllZero(capacity.machineTypes, (t) => [
      t.activeUnitCount,
      t.availableHours,
      t.scheduledLoadHours,
      t.projectedLoadPct,
    ])
      .sort((a, b) => (b.projectedLoadPct ?? 0) - (a.projectedLoadPct ?? 0))
      .map((t) => ({
        code: t.machineTypeCode,
        name: t.machineTypeName || t.machineTypeCode,
        units: t.activeUnitCount,
        pct: t.projectedLoadPct ?? 0,
        load: t.scheduledLoadHours ?? 0,
        avail: t.availableHours ?? 0,
        above: t.above80Pct,
        yLabel: `${t.machineTypeCode} (${t.activeUnitCount} unit${t.activeUnitCount === 1 ? '' : 's'})`,
      }));
  }, [capacity]);

  if (loading && !forecast) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!forecast) return null;

  const constraints = rows.filter((r) => r.above);
  const pipeline = forecast.committedPipeline;
  const sales = forecast.salesForecast;
  const pipelineMonths = withoutAllZero(pipeline.byExpectedCompletionMonth, (r) => [
    r.jobCount,
    r.amount,
  ]);
  const runOutItems = runOut?.items ?? [];

  return (
    <div>
      <AnalyticsGrid>
        <AnalyticsSection
          span={capacity ? 5 : 12}
          title="Accepted jobs and sales forecast"
          description={
            <>
              Released jobs not yet completed or delivered are money already on the books; pending
              jobs that are still being planned are left out. The sales forecast is an estimate:
              income from completed and delivered jobs per completion month, and{' '}
              {monthLabel(sales.forecastMonth)} is the average of the previous 3 complete months.
              Its error comes from testing the same method on every past month that had 3 months
              before it. Both use all records, not the date range above. Keep the two figures
              separate.
            </>
          }
          onExport={() =>
            exportCsv(
              `accepted-jobs-and-sales-forecast-${sales.forecastMonth}.csv`,
              [
                ...pipelineMonths.map((r) => ({
                  kind: 'Accepted, expected completion',
                  month: r.month,
                  jobs: r.jobCount as number | null,
                  amount: r.amount,
                  forecast: null as number | null,
                  error: null as number | null,
                })),
                ...sales.months.map((r) => ({
                  kind: 'Sales by completion month',
                  month: r.month,
                  jobs: null as number | null,
                  amount: r.actual,
                  forecast: r.forecast,
                  error: r.absoluteError,
                })),
              ],
              [
                { key: 'kind', header: 'Series', value: (r) => r.kind },
                { key: 'month', header: 'Month', value: (r) => r.month },
                { key: 'jobs', header: 'Jobs', value: (r) => r.jobs },
                { key: 'amount', header: 'Amount', value: (r) => r.amount },
                { key: 'forecast', header: 'MovingAverage3Mo', value: (r) => r.forecast },
                { key: 'error', header: 'AbsoluteError', value: (r) => r.error },
              ]
            )
          }
          exportDisabled={!pipelineMonths.length && !sales.months.length}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <SummaryCard
              label="Accepted, not delivered"
              value={formatMoney(pipeline.totalAmount)}
              hint={`${formatInt(pipeline.jobCount)} released jobs, not yet completed`}
            />
            <SummaryCard
              label={`Sales estimate, ${monthLabel(sales.forecastMonth)}`}
              value={estimateValue(sales, formatMoney)}
              hint={estimateHint(sales, formatMoney)}
            />
          </div>
          <ShowDetails label="Show monthly sales and back-test">
            <BacktestTable forecast={sales} fmt={formatMoney} />
          </ShowDetails>
          <Text strong style={{ display: 'block', margin: '12px 0 6px' }}>
            Accepted jobs by expected completion month
          </Text>
          <Table
            size="small"
            pagination={false}
            rowKey="month"
            dataSource={pipelineMonths}
            locale={{ emptyText: 'No accepted jobs waiting to be delivered.' }}
            columns={[
              { title: 'Expected completion month', dataIndex: 'month' },
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
        </AnalyticsSection>
        {capacity ? (
        <AnalyticsSection
          span={7}
          title="Expected workload by machine type"
          description={
            <>
              Looking ahead {capacity.horizon.from} → {capacity.horizon.to} ·{' '}
              {capacity.horizonWorkingDays} shop days · {formatNum(capacity.availableHoursPerUnit, 0)}h
              available per machine · {formatInt(capacity.scheduledOperationsInHorizon)} scheduled
              operations ahead. Amber bars mark types running near full capacity (at or above 80%)
              {constraints.length ? `: ${constraints.map((c) => c.code).join(', ')}` : ' — none right now'}.
              Hours booked and percent full are both shown — 88% on one machine is not the same as 30%
              across eight.
            </>
          }
          onExport={() =>
            exportCsv(
              `expected-workload-${capacity.horizon.from}_${capacity.horizon.to}.csv`,
              rows,
              [
                { key: 'code', header: 'MachineType', value: (r) => r.code },
                { key: 'name', header: 'Name', value: (r) => r.name },
                { key: 'units', header: 'MachinesUp', value: (r) => r.units },
                { key: 'load', header: 'HoursBooked', value: (r) => r.load },
                { key: 'avail', header: 'HoursAvailable', value: (r) => r.avail },
                { key: 'pct', header: 'ExpectedWorkloadPct', value: (r) => r.pct },
                { key: 'above', header: 'NearFull', value: (r) => (r.above ? 'Yes' : 'No') },
              ]
            )
          }
          exportDisabled={!rows.length}
        >
          {capacity.thinSample ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="No scheduled operations in this time window"
              description="Expected workload is zero until open operations have scheduled times."
            />
          ) : null}
          {rows.length === 0 ? (
            <Text type="secondary">No machine types with hours available or booked.</Text>
          ) : (
            <>
              <div
                style={{ ...CHART_BOX, padding: '12px 8px 8px', height: Math.max(240, rows.length * 48 + 80) }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={rows} margin={{ top: 20, right: 180, left: 8, bottom: 8 }}>
                    <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, (max: number) => Math.max(100, Math.ceil(max / 10) * 10)]}
                      tick={AXIS}
                      tickFormatter={(v) => `${v}%`}
                      label={{
                        value: 'Expected workload %',
                        position: 'insideBottom',
                        offset: -2,
                        style: AXIS,
                      }}
                      height={40}
                    />
                    <YAxis type="category" dataKey="yLabel" width={150} tick={AXIS} />
                    <Tooltip
                      contentStyle={{ fontSize: 13 }}
                      formatter={(value: number, _name, item) => {
                        const row = item?.payload;
                        if (!row) return [`${value.toFixed(1)}%`, 'Hours booked'];
                        return [
                          `${value.toFixed(1)}% · ${formatNum(row.load, 0)}h of ${formatNum(row.avail, 0)}h`,
                          row.above ? 'Near full' : 'Hours booked',
                        ];
                      }}
                    />
                    <ReferenceLine
                      x={80}
                      stroke="#b45309"
                      strokeDasharray="4 4"
                      label={{ value: '80%', position: 'top', fill: '#b45309', fontSize: 12 }}
                    />
                    <Bar dataKey="pct" barSize={18} radius={[0, 3, 3, 0]}>
                      {rows.map((row) => (
                        <Cell key={row.code} fill={row.above ? CONSTRAINT : NORMAL} />
                      ))}
                      <LabelList
                        content={(props) => {
                          const { x, y, width, height, index } = props;
                          const row = rows[index as number];
                          if (!row || x == null || y == null || width == null || height == null) {
                            return null;
                          }
                          const label = `${row.pct.toFixed(1)}% · ${formatNum(row.load, 0)}h / ${formatNum(row.avail, 0)}h${
                            row.above ? ' · near full' : ''
                          }`;
                          return (
                            <text
                              x={Number(x) + Number(width) + 8}
                              y={Number(y) + Number(height) / 2}
                              dy={4}
                              fill="#334155"
                              fontSize={12}
                            >
                              {label}
                            </text>
                          );
                        }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ShowDetails>
                <Table
                  size="small"
                  pagination={false}
                  rowKey="code"
                  dataSource={rows}
                  rowClassName={(r) => (r.above ? 'analytics-capacity-constraint' : '')}
                  columns={[
                    { title: 'Machine type', dataIndex: 'code', width: 110 },
                    { title: 'Name', dataIndex: 'name' },
                    { title: 'Machines up', dataIndex: 'units', width: 100, align: 'right' },
                    {
                      title: 'Hours booked',
                      dataIndex: 'load',
                      width: 110,
                      align: 'right',
                      render: (v: number) => formatNum(v, 1),
                    },
                    {
                      title: 'Hours available',
                      dataIndex: 'avail',
                      width: 120,
                      align: 'right',
                      render: (v: number) => formatNum(v, 1),
                    },
                    {
                      title: 'Expected workload',
                      dataIndex: 'pct',
                      width: 150,
                      align: 'right',
                      render: (v: number, row) => (
                        <span
                          style={{
                            fontWeight: row.above ? 700 : 400,
                            color: row.above ? CONSTRAINT : undefined,
                          }}
                        >
                          {v.toFixed(1)}%{row.above ? ' · near full' : ''}
                        </span>
                      ),
                    },
                  ]}
                />
              </ShowDetails>
            </>
          )}
        </AnalyticsSection>
        ) : null}
      </AnalyticsGrid>

      <AnalyticsGrid>
        <AnalyticsSection
          span={7}
          title="Consumable run-out"
          description={
            <>
              Estimate for every consumable: daily usage is the moving average of its last 3
              stocktake periods (previous count + deliveries − current count, per shop day).
              Today’s quantity = last count + deliveries since − daily usage × shop days since the
              count. Days left = that estimate ÷ daily usage, counted forward from today on the shop
              calendar (Sundays and holidays skipped) to give the run-out date. Items with fewer
              than 2 stocktakes show “Not enough data”. Does not follow the date range above.
            </>
          }
          onExport={() =>
            exportCsv(`consumable-run-out-${runOut?.today ?? ''}.csv`, runOutItems, [
              { key: 'name', header: 'Item', value: (r) => r.name },
              { key: 'code', header: 'Code', value: (r) => r.code },
              { key: 'size', header: 'Size', value: (r) => r.sizeSpec },
              { key: 'unit', header: 'Unit', value: (r) => r.unit },
              { key: 'lastCount', header: 'LastCountedOn', value: (r) => r.lastCountedOn },
              { key: 'lastQty', header: 'LastCountQuantity', value: (r) => r.lastCountQuantity },
              { key: 'delivered', header: 'DeliveredSinceCount', value: (r) => r.deliveriesSinceCount },
              { key: 'daysSince', header: 'ShopDaysSinceCount', value: (r) => r.shopDaysSinceCount },
              { key: 'periods', header: 'StocktakePeriodsUsed', value: (r) => r.periodsUsed },
              { key: 'perDay', header: 'DailyUsageMovingAvg', value: (r) => r.dailyUsage },
              { key: 'estimate', header: 'EstimatedOnHandToday', value: (r) => r.estimatedOnHand },
              { key: 'daysLeft', header: 'ShopDaysLeft', value: (r) => r.daysLeft },
              {
                key: 'runOut',
                header: 'RunOutDate',
                value: (r) => (r.likelyOut ? 'Likely out' : r.runOutDate ?? r.notEnoughDataNote),
              },
            ])
          }
          exportDisabled={!runOutItems.length}
        >
          <Table
            size="small"
            pagination={runOutItems.length > 15 ? { pageSize: 15, size: 'small' } : false}
            rowKey="toolId"
            loading={!runOut}
            dataSource={runOutItems}
            locale={{ emptyText: 'No consumables yet.' }}
            columns={[
              {
                title: 'Item',
                dataIndex: 'name',
                render: (name: string, r) => (
                  <span>
                    {name}
                    {r.sizeSpec ? <Text type="secondary"> · {r.sizeSpec}</Text> : null}
                  </span>
                ),
              },
              {
                title: 'On hand today (est.)',
                dataIndex: 'estimatedOnHand',
                width: 130,
                align: 'right',
                render: (v: number | null, r) => (
                  <span
                    title={
                      r.enoughData
                        ? `Counted ${formatNum(r.lastCountQuantity, 0)} on ${r.lastCountedOn} + ${formatNum(r.deliveriesSinceCount, 0)} delivered − ${formatNum(r.dailyUsage, 2)}/day × ${r.shopDaysSinceCount} shop days`
                        : 'Quantity on hand recorded'
                    }
                  >
                    {formatNum(r.enoughData ? v : r.quantityOnHand, 0)} {r.unit}
                  </span>
                ),
              },
              {
                title: 'Used per shop day',
                dataIndex: 'dailyUsage',
                width: 130,
                align: 'right',
                render: (v: number | null, r) =>
                  r.enoughData ? `${formatNum(v, 2)} ${r.unit}` : <Text type="secondary">—</Text>,
              },
              {
                title: 'Shop days left',
                dataIndex: 'daysLeft',
                width: 110,
                align: 'right',
                render: (v: number | null) => formatNum(v, 1),
              },
              {
                title: 'Run-out date (estimate)',
                dataIndex: 'runOutDate',
                width: 170,
                render: (v: string | null, r) => {
                  if (!r.enoughData) return <Text type="secondary">Not enough data</Text>;
                  if (r.likelyOut) {
                    return <span style={{ color: CONSTRAINT, fontWeight: 700 }}>Likely out</span>;
                  }
                  if (!v) return <Text type="secondary">No usage recorded</Text>;
                  return (
                    <span
                      title={`${r.periodsUsed} stocktake period${r.periodsUsed === 1 ? '' : 's'} averaged`}
                    >
                      {formatShop(v, 'D MMM YYYY')}
                    </span>
                  );
                },
              },
            ]}
          />
        </AnalyticsSection>
        {demand ? (
          <AnalyticsSection
            span={5}
            title="Demand forecast"
            description={
              <>
                Estimate: job orders received per month by PO date (creation date when there is no
                PO date), and {monthLabel(demand.forecastMonth)} is the average of the previous 3
                complete months. Error comes from testing the same method on every past month that
                had 3 months before it. Uses all records, not the date range above.
              </>
            }
            onExport={() =>
              exportCsv(
                `demand-moving-average-${demand.forecastMonth}.csv`,
                [
                  { jobType: 'All', f: demand as MovingAverageForecast },
                  ...demand.byJobType.map((t) => ({
                    jobType: JOB_TYPE_LABEL[t.jobType] || t.jobType,
                    f: t as MovingAverageForecast,
                  })),
                ].flatMap(({ jobType, f }) => f.months.map((m) => ({ jobType, ...m }))),
                [
                  { key: 'type', header: 'JobType', value: (r) => r.jobType },
                  { key: 'month', header: 'Month', value: (r) => r.month },
                  { key: 'actual', header: 'JobOrders', value: (r) => r.actual },
                  { key: 'forecast', header: 'MovingAverage3Mo', value: (r) => r.forecast },
                  { key: 'error', header: 'AbsoluteError', value: (r) => r.absoluteError },
                ]
              )
            }
            exportDisabled={!demand.months.length}
          >
            <div style={{ marginBottom: 12 }}>
              <SummaryCard
                label={`Job orders expected, ${monthLabel(demand.forecastMonth)}`}
                value={estimateValue(demand, formatCount)}
                hint={estimateHint(demand, formatCount)}
              />
            </div>
            <Table
              size="small"
              pagination={false}
              rowKey="jobType"
              dataSource={demand.byJobType}
              columns={[
                {
                  title: 'Job type',
                  dataIndex: 'jobType',
                  render: (v: string) => JOB_TYPE_LABEL[v] || v,
                },
                {
                  title: 'Estimate',
                  dataIndex: 'forecast',
                  align: 'right',
                  render: (_v: number | null, r) =>
                    r.enoughHistory ? (
                      formatCount(r.forecast)
                    ) : (
                      <Text type="secondary">
                        Not enough history yet ({r.monthsAvailable} mo)
                      </Text>
                    ),
                },
                {
                  title: 'MAE',
                  dataIndex: 'mae',
                  align: 'right',
                  render: (v: number | null) => formatCount(v),
                },
                {
                  title: 'MAPE',
                  dataIndex: 'mapePct',
                  align: 'right',
                  render: (v: number | null) => formatPct(v),
                },
              ]}
            />
            <ShowDetails label="Show monthly job orders and back-test">
              <BacktestTable forecast={demand} fmt={formatCount} />
            </ShowDetails>
          </AnalyticsSection>
        ) : null}
      </AnalyticsGrid>
    </div>
  );
}
