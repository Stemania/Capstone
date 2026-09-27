import { useEffect, useState } from 'react';
import { Button, Spin, Table, Typography, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
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
import type { AnalyticsPurchasing } from '../../types';
import { exportCsv } from '../../utils/csvExport';
import { SummaryCard } from './AnalyticsChrome';
import { formatInt, formatMoney, useAnalyticsPeriod } from './analyticsPeriod';

const { Title, Text } = Typography;
const AXIS = { fontSize: 13, fill: '#334155' };
const BAR = '#0f1c2e';

export default function AnalyticsPurchasingPage() {
  const { params } = useAnalyticsPeriod();
  const [data, setData] = useState<AnalyticsPurchasing | null>(null);
  const [loading, setLoading] = useState(true);

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

  const topMaterials = data.materialsByCount.slice(0, 10).map((r) => ({
    name: r.materialName,
    count: r.purchaseCount,
    spend: r.totalSpend ?? 0,
  }));

  return (
    <div>
      <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 16 }}>
        Period {data.period.from} → {data.period.to} · purchases by date ordered.
      </Text>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <SummaryCard label="Purchase lines" value={formatInt(data.purchaseCount)} />
        <SummaryCard label="Total spend" value={formatMoney(data.totalSpend)} />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <Title level={5} style={{ margin: 0, color: '#0f1c2e' }}>
          Most purchased materials (by count)
        </Title>
        <Button
          size="small"
          icon={<DownloadOutlined />}
          disabled={!data.materialsByCount.length}
          onClick={() =>
            exportCsv(
              `materials-by-count-${data.period.from}_${data.period.to}.csv`,
              data.materialsByCount,
              [
                { key: 'materialName', header: 'Material', value: (r) => r.materialName },
                { key: 'purchaseCount', header: 'PurchaseCount', value: (r) => r.purchaseCount },
                { key: 'totalQuantity', header: 'TotalQuantity', value: (r) => r.totalQuantity },
                { key: 'unit', header: 'Unit', value: (r) => r.unit },
                { key: 'totalSpend', header: 'TotalSpend', value: (r) => r.totalSpend },
              ]
            )
          }
        >
          CSV
        </Button>
      </div>
      {topMaterials.length === 0 ? (
        <Text type="secondary">No purchases in this period.</Text>
      ) : (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: 12,
            height: Math.max(260, topMaterials.length * 36 + 80),
            marginBottom: 12,
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={topMaterials}
              margin={{ top: 8, right: 48, left: 8, bottom: 8 }}
            >
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={AXIS} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={160} tick={AXIS} />
              <Tooltip contentStyle={{ fontSize: 13 }} />
              <Bar dataKey="count" name="Purchases" fill={BAR} barSize={14}>
                <LabelList dataKey="count" position="right" style={{ fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <Table
        size="small"
        pagination={false}
        rowKey="materialName"
        style={{ marginBottom: 28 }}
        dataSource={data.materialsByCount}
        columns={[
          { title: 'Material', dataIndex: 'materialName' },
          {
            title: 'Purchases',
            dataIndex: 'purchaseCount',
            width: 100,
            align: 'right',
          },
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

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <Title level={5} style={{ margin: 0, color: '#0f1c2e' }}>
          Materials by spend
        </Title>
        <Button
          size="small"
          icon={<DownloadOutlined />}
          disabled={!data.materialsBySpend.length}
          onClick={() =>
            exportCsv(
              `materials-by-spend-${data.period.from}_${data.period.to}.csv`,
              data.materialsBySpend,
              [
                { key: 'materialName', header: 'Material', value: (r) => r.materialName },
                { key: 'totalSpend', header: 'TotalSpend', value: (r) => r.totalSpend },
                { key: 'purchaseCount', header: 'PurchaseCount', value: (r) => r.purchaseCount },
                { key: 'totalQuantity', header: 'TotalQuantity', value: (r) => r.totalQuantity },
                { key: 'unit', header: 'Unit', value: (r) => r.unit },
              ]
            )
          }
        >
          CSV
        </Button>
      </div>
      <Table
        size="small"
        pagination={false}
        rowKey={(r) => `spend-${r.materialName}`}
        style={{ marginBottom: 28 }}
        dataSource={data.materialsBySpend}
        columns={[
          { title: 'Material', dataIndex: 'materialName' },
          {
            title: 'Spend',
            dataIndex: 'totalSpend',
            width: 120,
            align: 'right',
            render: (v: number | null) => formatMoney(v),
          },
          {
            title: 'Purchases',
            dataIndex: 'purchaseCount',
            width: 100,
            align: 'right',
          },
        ]}
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <Title level={5} style={{ margin: 0, color: '#0f1c2e' }}>
          Spend by supplier
        </Title>
        <Button
          size="small"
          icon={<DownloadOutlined />}
          disabled={!data.spendBySupplier.length}
          onClick={() =>
            exportCsv(
              `spend-by-supplier-${data.period.from}_${data.period.to}.csv`,
              data.spendBySupplier,
              [
                { key: 'supplierName', header: 'Supplier', value: (r) => r.supplierName },
                { key: 'purchaseCount', header: 'PurchaseCount', value: (r) => r.purchaseCount },
                { key: 'totalSpend', header: 'TotalSpend', value: (r) => r.totalSpend },
              ]
            )
          }
        >
          CSV
        </Button>
      </div>
      <Table
        size="small"
        pagination={false}
        rowKey="supplierId"
        style={{ marginBottom: 28 }}
        dataSource={data.spendBySupplier}
        columns={[
          { title: 'Supplier', dataIndex: 'supplierName' },
          {
            title: 'Purchases',
            dataIndex: 'purchaseCount',
            width: 100,
            align: 'right',
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

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <Title level={5} style={{ margin: 0, color: '#0f1c2e' }}>
          Supplier lead time
        </Title>
        <Button
          size="small"
          icon={<DownloadOutlined />}
          disabled={!data.supplierLeadTime.length}
          onClick={() =>
            exportCsv(
              `supplier-lead-time-${data.period.from}_${data.period.to}.csv`,
              data.supplierLeadTime,
              [
                { key: 'supplierName', header: 'Supplier', value: (r) => r.supplierName },
                {
                  key: 'stated',
                  header: 'StatedLeadTimeDays',
                  value: (r) => r.statedLeadTimeDays,
                },
                {
                  key: 'actual',
                  header: 'AverageActualDays',
                  value: (r) => r.averageActualDays,
                },
                { key: 'variance', header: 'VarianceDays', value: (r) => r.varianceDays },
                { key: 'samples', header: 'SampleCount', value: (r) => r.sampleCount },
              ]
            )
          }
        >
          CSV
        </Button>
      </div>
      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
        Average actual days from order to receipt vs each supplier’s stated lead time. Negative
        variance means faster than stated.
      </Text>
      <Table
        size="small"
        pagination={false}
        rowKey="supplierId"
        dataSource={data.supplierLeadTime}
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
          {
            title: 'Samples',
            dataIndex: 'sampleCount',
            width: 90,
            align: 'right',
          },
        ]}
      />
    </div>
  );
}
