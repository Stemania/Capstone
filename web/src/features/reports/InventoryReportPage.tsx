import { shopNow, shopToday } from '../../utils/shopTime';
import { useEffect, useMemo, useState } from 'react';
import { Button, DatePicker, Table, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { downloadCsv, rowsToCsv } from '../../utils/csvExport';
import { analyticsApi } from '../../api/analytics.api';
import { inventoryApi, toolsApi } from '../../api/tools.api';
import { getErrorMessage } from '../../api/client';
import { useShopDetails } from '../../hooks/useShopDetails';
import type {
  ConsumableRunOut,
  InventoryUsageByWorker,
  MaterialPurchase,
  MaterialPurchaseList,
  Tool,
  ToolType,
} from '../../types';
import {
  defaultAnalyticsRange,
  formatNum,
  rangeToParams,
  type AnalyticsRange,
} from '../analytics/analyticsPeriod';
import { ReportSection, ReportToolbar, displayOrDash } from './ReportChrome';
import { PrintDocument } from './PrintTemplate';
import { PageSkeleton } from '../../components/ui';
import './reportsPrint.css';

export default function InventoryReportPage() {
  const shop = useShopDetails();
  const [range, setRange] = useState<AnalyticsRange>(defaultAnalyticsRange);
  const params = rangeToParams(range);
  const [tools, setTools] = useState<Tool[]>([]);
  const [types, setTypes] = useState<ToolType[]>([]);
  const [runOut, setRunOut] = useState<ConsumableRunOut | null>(null);
  const [usageWorker, setUsageWorker] = useState<InventoryUsageByWorker | null>(null);
  const [purchases, setPurchases] = useState<MaterialPurchaseList | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [t, typ, ro, byWorker, mp] = await Promise.all([
          toolsApi.list(),
          toolsApi.listTypes({ includeUnits: true }),
          analyticsApi.consumableRunOut(),
          inventoryApi.usageByWorker(params),
          inventoryApi.materialPurchases({ ...params, status: 'ORDERED' }),
        ]);
        if (!cancelled) {
          setTools(t.data);
          setTypes(typ.data);
          setRunOut(ro.data);
          setUsageWorker(byWorker.data);
          setPurchases(mp.data);
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

  const generatedAt = shopNow().format('YYYY-MM-DD HH:mm');
  const consumables = runOut?.items || [];
  const outstanding = usageWorker?.outstandingUnreturned || [];
  const awaiting: MaterialPurchase[] = (purchases?.items || []).filter(
    (p) => !p.dateReceived && !p.cancelledAt
  );

  const toolAvailability = useMemo(() => {
    return types
      .map((t) => {
        const units = t.units || [];
        const available =
          t.availableCount ?? units.filter((u) => u.status === 'AVAILABLE').length;
        const out = t.outCount ?? units.filter((u) => u.status === 'OUT').length;
        const total = t.totalUnits ?? units.length;
        return { typeName: t.name, available, out, total };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => a.typeName.localeCompare(b.typeName));
  }, [types]);

  const exportReport = () => {
    const sections = [
      `Inventory report,Period ${params.from} to ${params.to}`,
      'Consumables',
      rowsToCsv(consumables, [
        { key: 'name', header: 'Item', value: (r) => r.name },
        { key: 'code', header: 'Code', value: (r) => r.code },
        { key: 'onHand', header: 'On hand', value: (r) => r.quantityOnHand },
        { key: 'rop', header: 'Reorder level', value: (r) => r.reorderLevel ?? r.minimumStock },
        { key: 'status', header: 'Status', value: (r) => r.status ?? '' },
        { key: 'days', header: 'Days left', value: (r) => r.daysLeft },
        { key: 'abc', header: 'ABC', value: (r) => r.abcClass ?? '' },
      ]),
      'Tools out / available',
      rowsToCsv(toolAvailability, [
        { key: 'type', header: 'Tool type', value: (r) => r.typeName },
        { key: 'avail', header: 'Available', value: (r) => r.available },
        { key: 'out', header: 'Out', value: (r) => r.out },
        { key: 'total', header: 'Total units', value: (r) => r.total },
      ]),
      'Materials awaiting delivery',
      rowsToCsv(awaiting, [
        { key: 'name', header: 'Material', value: (r) => r.materialName },
        { key: 'qty', header: 'Qty', value: (r) => r.quantity },
        { key: 'supplier', header: 'Supplier', value: (r) => r.supplierName ?? '' },
        {
          key: 'expected',
          header: 'Expected',
          value: (r) => r.currentExpectedDate ?? r.expectedDeliveryDate ?? '',
        },
      ]),
    ];
    downloadCsv(`inventory-report-${params.from}-to-${params.to}`, sections.join('\r\n\r\n'));
  };

  return (
    <PrintDocument
      shop={shop}
      pageSize="a4"
      wide
      toolbar={
        <ReportToolbar
          title="Inventory report"
          periodFrom={params.from}
          periodTo={params.to}
          extra={
            <>
              <Button icon={<DownloadOutlined />} onClick={exportReport} disabled={loading}>
                Export CSV
              </Button>
              <DatePicker.RangePicker
                value={range}
                allowClear={false}
                format="YYYY-MM-DD"
                onChange={(vals) => {
                  if (vals?.[0] && vals?.[1]) {
                    setRange([vals[0].startOf('day'), vals[1].endOf('day')]);
                  }
                }}
                disabledDate={(d) => d.isAfter(shopToday(), 'day')}
              />
            </>
          }
        />
      }
    >
      <div className="shop-print-doc-head">
        <div className="shop-print-doc-title">Inventory report</div>
        <div className="shop-print-doc-ref">
          Period {params.from} → {params.to} · Generated {generatedAt}
        </div>
      </div>

      {loading && !tools.length && !consumables.length ? (
        <PageSkeleton variant="block" />
      ) : (
        <>
          <ReportSection
            title="Consumables"
            note={runOut?.description || 'On hand, reorder level, status, days left, and ABC class (same as Analytics → Inventory).'}
          >
            <Table
              size="small"
              pagination={false}
              rowKey="toolId"
              dataSource={consumables}
              rowClassName={(r) => (r.lowStock || r.status === 'REORDER_NOW' ? 'report-row-low-stock' : '')}
              locale={{ emptyText: 'No consumables to show yet' }}
              columns={[
                { title: 'Item', dataIndex: 'name' },
                { title: 'Code', dataIndex: 'code', width: 90 },
                {
                  title: 'On hand',
                  dataIndex: 'quantityOnHand',
                  width: 90,
                  align: 'right',
                  render: (v: number | null, r) =>
                    v == null ? '—' : `${formatNum(v, 2)} ${r.unit}`,
                },
                {
                  title: 'Reorder level',
                  key: 'rop',
                  width: 110,
                  align: 'right',
                  render: (_: unknown, r) => {
                    const v = r.reorderLevel ?? r.minimumStock;
                    return v == null ? '—' : formatNum(v, 2);
                  },
                },
                {
                  title: 'Status',
                  dataIndex: 'status',
                  width: 120,
                  render: (v: string | undefined) => v || '—',
                },
                {
                  title: 'Days left',
                  dataIndex: 'daysLeft',
                  width: 90,
                  align: 'right',
                  render: (v: number | null) => (v == null ? '—' : formatNum(v, 0)),
                },
                {
                  title: 'ABC',
                  dataIndex: 'abcClass',
                  width: 64,
                  render: (v: string | null | undefined) => v || '—',
                },
              ]}
            />
          </ReportSection>

          <ReportSection title="Tools out / available">
            <Table
              size="small"
              pagination={false}
              rowKey="typeName"
              dataSource={toolAvailability}
              locale={{ emptyText: 'No tool units on file' }}
              columns={[
                { title: 'Tool type', dataIndex: 'typeName' },
                {
                  title: 'Available',
                  dataIndex: 'available',
                  width: 100,
                  align: 'right',
                },
                { title: 'Out', dataIndex: 'out', width: 80, align: 'right' },
                { title: 'Total units', dataIndex: 'total', width: 100, align: 'right' },
              ]}
            />
          </ReportSection>

          <ReportSection title="Outstanding borrowed tools by worker">
            <Table
              size="small"
              pagination={false}
              rowKey="workerId"
              dataSource={outstanding}
              locale={{ emptyText: 'No tools still out with workers' }}
              columns={[
                { title: 'Worker', dataIndex: 'workerName', render: (v) => displayOrDash(v) },
                {
                  title: 'Total qty',
                  dataIndex: 'totalOutstandingQuantity',
                  width: 100,
                  align: 'right',
                  render: (v: number | null) => (v == null ? '—' : v),
                },
                {
                  title: 'Items',
                  key: 'items',
                  render: (_: unknown, r) =>
                    r.items?.length
                      ? r.items
                          .map((i) => `${i.toolName} (${i.quantity == null ? '—' : i.quantity})`)
                          .join('; ')
                      : '—',
                },
              ]}
            />
          </ReportSection>

          <ReportSection title="Materials awaiting delivery">
            <Table
              size="small"
              pagination={false}
              rowKey="id"
              dataSource={awaiting}
              locale={{ emptyText: 'No materials awaiting delivery' }}
              columns={[
                { title: 'Material', dataIndex: 'materialName' },
                {
                  title: 'Qty',
                  dataIndex: 'quantity',
                  width: 90,
                  align: 'right',
                  render: (v: number | null, r) =>
                    v == null ? '—' : `${formatNum(v, 2)} ${r.unit || ''}`.trim(),
                },
                {
                  title: 'Supplier',
                  dataIndex: 'supplierName',
                  render: (v) => displayOrDash(v),
                },
                {
                  title: 'Expected',
                  key: 'expected',
                  width: 120,
                  render: (_: unknown, r: MaterialPurchase) =>
                    displayOrDash(r.currentExpectedDate ?? r.expectedDeliveryDate),
                },
                {
                  title: 'Job',
                  dataIndex: 'jobNumber',
                  width: 120,
                  render: (v) => displayOrDash(v),
                },
              ]}
            />
          </ReportSection>
        </>
      )}
    </PrintDocument>
  );
}
