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
import { inventoryApi } from '../../api/tools.api';
import type {
  AnalyticsDemandCapacity,
  AnalyticsSalesForecast,
  InventoryPurchaseSuggestions,
} from '../../types';
import { exportCsv } from '../../utils/csvExport';
import { SummaryCard } from './AnalyticsChrome';
import {
  AnalyticsGrid,
  AnalyticsSection,
  CHART_BOX,
  ComingSoon,
  ShowDetails,
  withoutAllZero,
} from './AnalyticsSection';
import { formatInt, formatMoney, formatNum, useAnalyticsPeriod } from './analyticsPeriod';

const { Text } = Typography;

const AXIS = { fontSize: 13, fill: '#334155' };
const GRID = '#e2e8f0';
const NORMAL = '#0f1c2e';
const CONSTRAINT = '#b45309';

export default function AnalyticsForecastPage() {
  const { params } = useAnalyticsPeriod();
  const [capacity, setCapacity] = useState<AnalyticsDemandCapacity | null>(null);
  const [forecast, setForecast] = useState<AnalyticsSalesForecast | null>(null);
  const [lowStock, setLowStock] = useState<InventoryPurchaseSuggestions | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [c, f] = await Promise.all([
          analyticsApi.demandCapacity(params),
          analyticsApi.salesForecast(params),
        ]);
        if (!cancelled) {
          setCapacity(c.data);
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
  }, [params.from, params.to]);

  useEffect(() => {
    let cancelled = false;
    inventoryApi
      .purchaseSuggestions()
      .then((res) => {
        if (!cancelled) setLowStock(res.data);
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

  if (loading && !capacity) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!capacity || !forecast) return null;

  const constraints = rows.filter((r) => r.above);
  const pipeline = forecast.committedPipeline;
  const projected = forecast.projectedRevenue;
  const pipelineMonths = withoutAllZero(pipeline.byExpectedCompletionMonth, (r) => [
    r.jobCount,
    r.amount,
  ]);
  const lowItems = lowStock?.items ?? [];

  return (
    <div>
      <AnalyticsGrid>
        <AnalyticsSection
          span={5}
          title="Accepted jobs and estimated income"
          description={
            <>
              Released jobs not yet completed or delivered are money already on the books; pending
              jobs that are still being planned are left out. Estimated income is a
              rough guess: average income per shop day from finished jobs in {forecast.period.from} →{' '}
              {forecast.period.to}, carried forward to {projected.horizon.from} →{' '}
              {projected.horizon.to}. Keep the two figures separate.
            </>
          }
          onExport={() =>
            exportCsv(
              `accepted-jobs-by-month-${forecast.period.from}_${forecast.period.to}.csv`,
              pipelineMonths,
              [
                { key: 'month', header: 'ExpectedMonth', value: (r) => r.month },
                { key: 'jobs', header: 'Jobs', value: (r) => r.jobCount },
                { key: 'amount', header: 'Amount', value: (r) => r.amount },
              ]
            )
          }
          exportDisabled={!pipelineMonths.length}
        >
          {forecast.thinSample ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="Not enough jobs yet — treat this guess as a rough guide"
              description={`Only ${forecast.sampleWeeks} weeks of shop days so far (we like at least 8). This guess is rough.`}
            />
          ) : null}
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
              label="Estimated income"
              value={formatMoney(projected.projectedAmount)}
              hint={`About ${formatMoney(projected.revenuePerWorkingDay)} per shop day × ${projected.horizonWorkingDays} days, from ${formatInt(projected.sampleCompletedJobs)} finished jobs`}
            />
          </div>
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
      </AnalyticsGrid>

      <AnalyticsGrid>
        <AnalyticsSection
          span={8}
          title="Consumables running low"
          description={
            lowStock
              ? `Consumables at or below their minimum stock right now. Use per day comes from the last ${lowStock.workingDaysInSample} shop days (${lowStock.period.from} → ${lowStock.period.to}) and does not follow the date range above.`
              : 'Consumables at or below their minimum stock right now.'
          }
          onExport={() =>
            exportCsv(`consumables-running-low-${lowStock?.period.to ?? ''}.csv`, lowItems, [
              { key: 'name', header: 'Item', value: (r) => r.name },
              { key: 'code', header: 'Code', value: (r) => r.code },
              { key: 'size', header: 'Size', value: (r) => r.sizeSpec },
              { key: 'unit', header: 'Unit', value: (r) => r.unit },
              { key: 'onHand', header: 'OnHand', value: (r) => r.quantityOnHand },
              { key: 'min', header: 'MinimumStock', value: (r) => r.minimumStock },
              { key: 'perDay', header: 'UsedPerShopDay', value: (r) => r.consumptionPerWorkingDay },
              { key: 'suggest', header: 'SuggestedOrder', value: (r) => r.suggestedOrderQuantity },
            ])
          }
          exportDisabled={!lowItems.length}
        >
          <Table
            size="small"
            pagination={false}
            rowKey="toolId"
            loading={!lowStock}
            dataSource={lowItems}
            locale={{ emptyText: 'No consumables are below their minimum stock.' }}
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
                title: 'On hand',
                dataIndex: 'quantityOnHand',
                width: 110,
                align: 'right',
                render: (v: number | null, r) => `${formatNum(v, 0)} ${r.unit}`,
              },
              {
                title: 'Minimum',
                dataIndex: 'minimumStock',
                width: 110,
                align: 'right',
                render: (v: number | null, r) => `${formatNum(v, 0)} ${r.unit}`,
              },
              {
                title: 'Used per shop day',
                dataIndex: 'consumptionPerWorkingDay',
                width: 150,
                align: 'right',
                render: (v: number | null) => formatNum(v, 1),
              },
              {
                title: 'Suggested order',
                dataIndex: 'suggestedOrderQuantity',
                width: 140,
                align: 'right',
                render: (v: number | null, r) => (v == null ? '—' : `${formatNum(v, 0)} ${r.unit}`),
              },
            ]}
          />
        </AnalyticsSection>
        <ComingSoon
          span={4}
          title="Demand forecast"
          description="Expected incoming jobs by type for the weeks ahead, based on past orders."
        />

      </AnalyticsGrid>
    </div>
  );
}
