import { useEffect, useState } from 'react';
import { Segmented, Spin, Table, Typography, message } from 'antd';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { analyticsApi } from '../../api/analytics.api';
import { getErrorMessage } from '../../api/client';
import { suppliersApi } from '../../api/suppliers.api';
import type { AnalyticsPurchasing, SupplierReliability } from '../../types';
import { exportCsv } from '../../utils/csvExport';
import {
  AnalyticsGrid,
  AnalyticsSection,
  CHART_BOX,
  ShowDetails,
  withoutAllZero,
} from './AnalyticsSection';
import { formatInt, formatMoney, useAnalyticsPeriod } from './analyticsPeriod';

const { Text } = Typography;
const AXIS = { fontSize: 13, fill: '#334155' };
const BAR = '#0f1c2e';
const STATED = '#94a3b8';

type MaterialSort = 'count' | 'spend';

export default function AnalyticsSuppliersPage() {
  const { params } = useAnalyticsPeriod();
  const [data, setData] = useState<AnalyticsPurchasing | null>(null);
  const [loading, setLoading] = useState(true);
  const [materialSort, setMaterialSort] = useState<MaterialSort>('count');
  const [reliability, setReliability] = useState<SupplierReliability[]>([]);

  useEffect(() => {
    suppliersApi
      .reliability({ from: params.from, to: params.to })
      .then(({ data: rows }) => setReliability(rows))
      .catch(() => setReliability([]));
  }, [params.from, params.to]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await analyticsApi.purchasing(params);
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

  const period = `${data.period.from}_${data.period.to}`;

  const spend = withoutAllZero(data.spendBySupplier, (r) => [r.purchaseCount, r.totalSpend]);
  const spendRank = new Map(spend.map((r, i) => [r.supplierId, i]));
  const rankOf = (id: string) => spendRank.get(id) ?? Number.MAX_SAFE_INTEGER;

  const leadTime = withoutAllZero(data.supplierLeadTime, (r) => [
    r.statedLeadTimeDays,
    r.averageActualDays,
    r.sampleCount,
  ]).sort((a, b) => rankOf(a.supplierId) - rankOf(b.supplierId));
  const leadChart = leadTime.map((r) => ({
    name: r.supplierName || '—',
    stated: r.statedLeadTimeDays,
    actual: r.averageActualDays,
  }));

  const spendChart = spend.map((r) => ({
    name: r.supplierName || '—',
    spend: r.totalSpend ?? 0,
  }));

  const supplierChartHeight = Math.max(220, Math.max(leadChart.length, spendChart.length) * 52 + 90);

  const materials = withoutAllZero(
    materialSort === 'count' ? data.materialsByCount : data.materialsBySpend,
    (r) => [r.purchaseCount, r.totalQuantity, r.totalSpend]
  );
  const topMaterials = materials.slice(0, 10).map((r) => ({
    name: r.materialName,
    value: materialSort === 'count' ? r.purchaseCount : r.totalSpend ?? 0,
  }));

  return (
    <div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: '4px 20px',
          marginBottom: 12,
          fontSize: 13,
        }}
      >
        <Text type="secondary">
          Period {data.period.from} → {data.period.to} · purchases by date ordered.
        </Text>
        <span>
          <Text type="secondary">Purchase lines </Text>
          <Text strong style={{ fontSize: 15, color: '#0f1c2e' }}>
            {formatInt(data.purchaseCount)}
          </Text>
        </span>
        <span>
          <Text type="secondary">Total spend </Text>
          <Text strong style={{ fontSize: 15, color: '#0f1c2e' }}>
            {formatMoney(data.totalSpend)}
          </Text>
        </span>
      </div>

      <AnalyticsGrid>
        <AnalyticsSection
          title="Supplier reliability"
          description="Deliveries received on or before the date promised when the order was issued, out of all deliveries that were due. A later date agreed with the supplier does not change the promise, and an overdue delivery not yet received counts as late. Ranked by reliability, then by average days late. Counts deliveries promised within the selected period; a supplier needs at least 3 due in it to be ranked."
          onExport={() =>
            exportCsv('supplier-reliability.csv', reliability, [
              { key: 'rank', header: 'Rank', value: (r) => r.rank },
              { key: 'supplier', header: 'Supplier', value: (r) => r.supplierName },
              { key: 'pct', header: 'ReliabilityPct', value: (r) => r.reliabilityPct ?? r.label },
              { key: 'due', header: 'DueDeliveries', value: (r) => r.dueDeliveries },
              { key: 'onTime', header: 'OnTime', value: (r) => r.onTimeDeliveries },
              { key: 'late', header: 'Late', value: (r) => r.lateDeliveries },
              { key: 'overdue', header: 'OverdueNotReceived', value: (r) => r.overdueDeliveries },
              { key: 'avg', header: 'AvgDaysLate', value: (r) => r.avgDaysLate },
            ])
          }
          exportDisabled={!reliability.length}
        >
          <Table
            size="small"
            pagination={false}
            rowKey="supplierId"
            dataSource={reliability}
            columns={[
              { title: '#', dataIndex: 'rank', width: 50, render: (v: number | null) => v ?? '—' },
              { title: 'Supplier', dataIndex: 'supplierName' },
              {
                title: 'Reliability',
                key: 'pct',
                width: 170,
                render: (_: unknown, r) =>
                  r.reliabilityPct == null ? (
                    <Text type="secondary">{r.label}</Text>
                  ) : (
                    <Text strong>{r.reliabilityPct.toFixed(1)}%</Text>
                  ),
              },
              {
                title: 'On time / due',
                key: 'ratio',
                width: 120,
                align: 'right',
                render: (_: unknown, r) => `${r.onTimeDeliveries} / ${r.dueDeliveries}`,
              },
              {
                title: 'Overdue now',
                dataIndex: 'overdueDeliveries',
                width: 110,
                align: 'right',
              },
              {
                title: 'Avg days late',
                dataIndex: 'avgDaysLate',
                width: 120,
                align: 'right',
                render: (v: number, r) => (r.lateDeliveries ? v.toFixed(1) : '—'),
              },
            ]}
          />
        </AnalyticsSection>
      </AnalyticsGrid>

      <AnalyticsGrid>
        <AnalyticsSection
          span={6}
          title="Supplier lead time"
          description="Stated lead time against the average actual days from issue date to received date on each supplier order (lines recorded without a PO still use ordered-to-received). Negative variance means faster than stated."
          onExport={() =>
            exportCsv(`supplier-lead-time-${period}.csv`, leadTime, [
              { key: 'supplierName', header: 'Supplier', value: (r) => r.supplierName },
              { key: 'stated', header: 'StatedLeadTimeDays', value: (r) => r.statedLeadTimeDays },
              { key: 'actual', header: 'AverageActualDays', value: (r) => r.averageActualDays },
              { key: 'variance', header: 'VarianceDays', value: (r) => r.varianceDays },
              { key: 'samples', header: 'SampleCount', value: (r) => r.sampleCount },
            ])
          }
          exportDisabled={!leadTime.length}
        >
          {leadChart.length === 0 ? (
            <Text type="secondary">No supplier deliveries in this period.</Text>
          ) : (
            <>
              <div
                style={{ ...CHART_BOX, padding: 12, height: supplierChartHeight }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={leadChart} margin={{ top: 8, right: 48, left: 8, bottom: 8 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={AXIS}
                      label={{ value: 'Days', position: 'insideBottom', offset: -2, style: AXIS }}
                      height={40}
                    />
                    <YAxis type="category" dataKey="name" width={160} tick={AXIS} />
                    <Tooltip
                      contentStyle={{ fontSize: 13 }}
                      formatter={(value: number, name: string) => [
                        value == null ? '—' : `${Number(value).toFixed(1)} days`,
                        name,
                      ]}
                    />
                    <Legend verticalAlign="top" wrapperStyle={{ fontSize: 13, paddingBottom: 4 }} />
                    <Bar dataKey="stated" name="Stated" fill={STATED} barSize={12} />
                    <Bar dataKey="actual" name="Avg actual" fill={BAR} barSize={12}>
                      <LabelList
                        dataKey="actual"
                        position="right"
                        formatter={(v: number | null) => (v == null ? '' : Number(v).toFixed(1))}
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
                  rowKey="supplierId"
                  dataSource={leadTime}
                  columns={[
                    { title: 'Supplier', dataIndex: 'supplierName' },
                    {
                      title: 'Stated (days)',
                      dataIndex: 'statedLeadTimeDays',
                      width: 110,
                      align: 'right',
                      render: (v: number | null) => (v == null ? '—' : v),
                    },
                    {
                      title: 'Avg actual (days)',
                      dataIndex: 'averageActualDays',
                      width: 130,
                      align: 'right',
                      render: (v: number | null) => (v == null ? '—' : v.toFixed(1)),
                    },
                    {
                      title: 'Variance',
                      dataIndex: 'varianceDays',
                      width: 100,
                      align: 'right',
                      render: (v: number | null) => {
                        if (v == null) return '—';
                        const sign = v > 0 ? '+' : '';
                        return `${sign}${v.toFixed(1)}`;
                      },
                    },
                    { title: 'Samples', dataIndex: 'sampleCount', width: 90, align: 'right' },
                  ]}
                />
              </ShowDetails>
            </>
          )}
        </AnalyticsSection>

        <AnalyticsSection
          span={6}
          title="Spend by supplier"
          description="Suppliers in the same order as the lead time chart, highest spend first."
          onExport={() =>
            exportCsv(`spend-by-supplier-${period}.csv`, spend, [
              { key: 'supplierName', header: 'Supplier', value: (r) => r.supplierName },
              { key: 'purchaseCount', header: 'PurchaseCount', value: (r) => r.purchaseCount },
              { key: 'totalSpend', header: 'TotalSpend', value: (r) => r.totalSpend },
            ])
          }
          exportDisabled={!spend.length}
        >
          {spendChart.length === 0 ? (
            <Text type="secondary">No purchases in this period.</Text>
          ) : (
            <>
              <div
                style={{ ...CHART_BOX, padding: 12, height: supplierChartHeight }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={spendChart} margin={{ top: 8, right: 80, left: 8, bottom: 8 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={AXIS} tickFormatter={(v) => formatMoney(v, 0)} />
                    <YAxis type="category" dataKey="name" width={160} tick={AXIS} />
                    <Tooltip
                      contentStyle={{ fontSize: 13 }}
                      formatter={(value: number) => [formatMoney(value), 'Spend']}
                    />
                    <Bar dataKey="spend" name="Spend" fill={BAR} barSize={14}>
                      <LabelList
                        dataKey="spend"
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
                  rowKey="supplierId"
                  dataSource={spend}
                  columns={[
                    { title: 'Supplier', dataIndex: 'supplierName' },
                    { title: 'Purchases', dataIndex: 'purchaseCount', width: 100, align: 'right' },
                    {
                      title: 'Spend',
                      dataIndex: 'totalSpend',
                      width: 120,
                      align: 'right',
                      render: (v: number | null) => formatMoney(v),
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
          title="Materials purchased"
          description={
            materialSort === 'count'
              ? 'Top 10 materials by number of purchases.'
              : 'Top 10 materials by spend.'
          }
          controls={
            <Segmented<MaterialSort>
              size="small"
              value={materialSort}
              onChange={setMaterialSort}
              options={[
                { label: 'By purchases', value: 'count' },
                { label: 'By spend', value: 'spend' },
              ]}
            />
          }
          onExport={() =>
            exportCsv(`materials-by-${materialSort}-${period}.csv`, materials, [
              { key: 'materialName', header: 'Material', value: (r) => r.materialName },
              { key: 'purchaseCount', header: 'PurchaseCount', value: (r) => r.purchaseCount },
              { key: 'totalQuantity', header: 'TotalQuantity', value: (r) => r.totalQuantity },
              { key: 'unit', header: 'Unit', value: (r) => r.unit },
              { key: 'totalSpend', header: 'TotalSpend', value: (r) => r.totalSpend },
            ])
          }
          exportDisabled={!materials.length}
        >
          {topMaterials.length === 0 ? (
            <Text type="secondary">No purchases in this period.</Text>
          ) : (
            <>
              <div
                style={{ ...CHART_BOX, padding: 12, height: Math.max(260, topMaterials.length * 36 + 80) }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={topMaterials} margin={{ top: 8, right: 80, left: 8, bottom: 8 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={AXIS}
                      allowDecimals={materialSort === 'spend'}
                      tickFormatter={(v) => (materialSort === 'spend' ? formatMoney(v, 0) : String(v))}
                    />
                    <YAxis type="category" dataKey="name" width={160} tick={AXIS} />
                    <Tooltip
                      contentStyle={{ fontSize: 13 }}
                      formatter={(value: number) =>
                        materialSort === 'spend'
                          ? [formatMoney(value), 'Spend']
                          : [value, 'Purchases']
                      }
                    />
                    <Bar
                      dataKey="value"
                      name={materialSort === 'spend' ? 'Spend' : 'Purchases'}
                      fill={BAR}
                      barSize={14}
                    >
                      <LabelList
                        dataKey="value"
                        position="right"
                        formatter={(v: number) =>
                          materialSort === 'spend' ? formatMoney(v, 0) : String(v)
                        }
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
                  rowKey="materialName"
                  dataSource={materials}
                  columns={[
                    { title: 'Material', dataIndex: 'materialName' },
                    { title: 'Purchases', dataIndex: 'purchaseCount', width: 100, align: 'right' },
                    {
                      title: 'Qty',
                      key: 'qty',
                      width: 120,
                      align: 'right',
                      render: (_: unknown, r) =>
                        r.totalQuantity == null
                          ? '—'
                          : `${r.totalQuantity}${r.unit ? ` ${r.unit}` : ''}`,
                    },
                    {
                      title: 'Spend',
                      dataIndex: 'totalSpend',
                      width: 120,
                      align: 'right',
                      render: (v: number | null) => formatMoney(v),
                    },
                  ]}
                />
              </ShowDetails>
            </>
          )}
        </AnalyticsSection>
      </AnalyticsGrid>
    </div>
  );
}
