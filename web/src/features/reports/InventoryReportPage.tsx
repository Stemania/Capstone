import { shopToday } from '../../utils/shopTime';
import { useEffect, useMemo, useState } from 'react';
import { Button, DatePicker, Table, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { downloadCsv, rowsToCsv } from '../../utils/csvExport';
import { inventoryApi, toolsApi } from '../../api/tools.api';
import { getErrorMessage } from '../../api/client';
import type {
  InventoryPurchaseSuggestions,
  InventoryUsageByItem,
  InventoryUsageByWorker,
  Tool,
} from '../../types';
import {
  defaultAnalyticsRange,
  formatNum,
  rangeToParams,
  type AnalyticsRange,
} from '../analytics/analyticsPeriod';
import { ReportSection, ReportStamp, ReportToolbar, displayOrDash } from './ReportChrome';
import { PageSkeleton } from '../../components/ui';

export default function InventoryReportPage() {
  const [range, setRange] = useState<AnalyticsRange>(defaultAnalyticsRange);
  const params = rangeToParams(range);
  const [tools, setTools] = useState<Tool[]>([]);
  const [usageItem, setUsageItem] = useState<InventoryUsageByItem | null>(null);
  const [usageWorker, setUsageWorker] = useState<InventoryUsageByWorker | null>(null);
  const [suggestions, setSuggestions] = useState<InventoryPurchaseSuggestions | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [t, byItem, byWorker, sug] = await Promise.all([
          toolsApi.list(),
          inventoryApi.usageByItem(params),
          inventoryApi.usageByWorker(params),
          inventoryApi.purchaseSuggestions(),
        ]);
        if (!cancelled) {
          setTools(t.data);
          setUsageItem(byItem.data);
          setUsageWorker(byWorker.data);
          setSuggestions(sug.data);
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

  const stockRows = useMemo(
    () =>
      [...tools].sort((a, b) => {
        if (a.lowStock !== b.lowStock) return a.lowStock ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [tools]
  );

  const outstanding = usageWorker?.outstandingUnreturned || [];
  const suggestionRows = suggestions?.items || [];

  const exportReport = () => {
    const sections = [
      `Inventory Status Report,Period ${params.from} to ${params.to}`,
      'Current stock',
      rowsToCsv(stockRows, [
        { key: 'name', header: 'Item', value: (r) => r.name },
        { key: 'code', header: 'Code', value: (r) => r.code },
        {
          key: 'category',
          header: 'Category',
          value: (r) => (r.category === 'CONSUMABLE' ? 'Consumable' : 'Returnable'),
        },
        { key: 'unit', header: 'Unit', value: (r) => r.unit },
        { key: 'onHand', header: 'In stock', value: (r) => r.quantityOnHand },
        { key: 'min', header: 'Reorder level', value: (r) => r.minimumStock },
        { key: 'low', header: 'Low stock', value: (r) => (r.lowStock ? 'Yes' : 'No') },
      ]),
      'Outstanding borrowed tools by worker',
      rowsToCsv(outstanding, [
        { key: 'worker', header: 'Worker', value: (r) => r.workerName },
        { key: 'qty', header: 'Total qty', value: (r) => r.totalOutstandingQuantity },
        {
          key: 'items',
          header: 'Items',
          value: (r) =>
            (r.items || []).map((i) => `${i.toolName} (${i.quantity ?? '—'})`).join('; '),
        },
      ]),
      'Returnable tools borrowed over period',
      rowsToCsv(usageItem?.items || [], [
        { key: 'name', header: 'Tool', value: (r) => r.name },
        { key: 'code', header: 'Code', value: (r) => r.code },
        { key: 'borrowed', header: 'Borrowed', value: (r) => r.borrowQuantity },
        { key: 'perDay', header: 'Per working day', value: (r) => r.consumptionPerWorkingDay },
      ]),
      'Scan-based purchase suggestions',
      rowsToCsv(suggestionRows, [
        { key: 'name', header: 'Item', value: (r) => r.name },
        { key: 'code', header: 'Code', value: (r) => r.code },
        { key: 'onHand', header: 'On hand', value: (r) => r.quantityOnHand },
        { key: 'rop', header: 'Reorder level', value: (r) => r.reorderLevel ?? r.minimumStock },
        { key: 'sug', header: 'Suggested qty', value: (r) => r.suggestedOrderQuantity },
        { key: 'adu', header: 'ADU', value: (r) => r.consumptionPerWorkingDay },
        { key: 'status', header: 'Status', value: (r) => r.status ?? '' },
        { key: 'abc', header: 'ABC', value: (r) => r.abcClass ?? '' },
        { key: 'label', header: 'Label', value: (r) => r.label ?? '' },
      ]),
    ];
    downloadCsv(`inventory-status-${params.from}-to-${params.to}`, sections.join('\r\n\r\n'));
  };

  return (
    <div className="report-page">
      <ReportToolbar
        title="Inventory Status Report"
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
      <ReportStamp periodFrom={params.from} periodTo={params.to} />

      {loading && !tools.length ? (
        <PageSkeleton variant="block" />
      ) : (
        <>
          <ReportSection title="Current stock" note="Low-stock rows are highlighted.">
            <Table
              size="small"
              pagination={false}
              rowKey="id"
              dataSource={stockRows}
              rowClassName={(r) => (r.lowStock ? 'report-row-low-stock' : '')}
              locale={{ emptyText: 'No inventory items to show yet' }}
              columns={[
                { title: 'Item', dataIndex: 'name' },
                { title: 'Code', dataIndex: 'code', width: 100 },
                {
                  title: 'Category',
                  dataIndex: 'category',
                  width: 140,
                  render: (v: string) => (v === 'CONSUMABLE' ? 'Consumable' : 'Returnable'),
                },
                { title: 'Unit', dataIndex: 'unit', width: 72 },
                {
                  title: 'In stock',
                  dataIndex: 'quantityOnHand',
                  width: 88,
                  align: 'right',
                  render: (v: number | null | undefined) =>
                    v == null || Number.isNaN(v) ? '—' : v,
                },
                {
                  title: 'Reorder level',
                  dataIndex: 'minimumStock',
                  width: 110,
                  align: 'right',
                  render: (v: number | null | undefined) =>
                    v == null || Number.isNaN(v) ? '—' : v,
                },
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
                          .map(
                            (i) =>
                              `${i.toolName} (${i.quantity == null ? '—' : i.quantity})`
                          )
                          .join('; ')
                      : '—',
                },
              ]}
            />
          </ReportSection>

          <ReportSection title="Returnable tools borrowed over period">
            <Table
              size="small"
              pagination={false}
              rowKey="toolId"
              dataSource={usageItem?.items || []}
              locale={{ emptyText: 'No borrow activity in this period yet' }}
              columns={[
                { title: 'Tool', dataIndex: 'name' },
                { title: 'Code', dataIndex: 'code', width: 100 },
                {
                  title: 'Borrowed',
                  dataIndex: 'borrowQuantity',
                  width: 110,
                  align: 'right',
                  render: (v: number | null) => (v == null ? '—' : formatNum(v, 2)),
                },
                {
                  title: 'Per working day',
                  dataIndex: 'consumptionPerWorkingDay',
                  width: 120,
                  align: 'right',
                  render: (v: number | null) => (v == null ? '—' : formatNum(v, 2)),
                },
              ]}
            />
          </ReportSection>

          <ReportSection
            title="Scan-based purchase suggestions"
            note={
              suggestions?.description ||
              suggestions?.howComputed ||
              'Consumables at or near reorder level from worker scan usage (ADU). Not an automatic purchase order.'
            }
          >
            <Table
              size="small"
              pagination={false}
              rowKey="toolId"
              dataSource={suggestionRows}
              locale={{ emptyText: 'No scan-based reorder suggestions right now' }}
              columns={[
                { title: 'Item', dataIndex: 'name' },
                { title: 'Code', dataIndex: 'code', width: 100 },
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
                  title: 'Suggested qty',
                  dataIndex: 'suggestedOrderQuantity',
                  width: 110,
                  align: 'right',
                  render: (v: number | null) => (v == null ? '—' : formatNum(v, 0)),
                },
                {
                  title: 'ADU',
                  dataIndex: 'consumptionPerWorkingDay',
                  width: 90,
                  align: 'right',
                  render: (v: number | null) => (v == null ? '—' : formatNum(v, 3)),
                },
                {
                  title: 'Status',
                  dataIndex: 'status',
                  width: 120,
                  render: (v: string | undefined) => v || '—',
                },
                {
                  title: 'ABC',
                  dataIndex: 'abcClass',
                  width: 64,
                  render: (v: string | null | undefined) => v || '—',
                },
                {
                  title: 'Label',
                  dataIndex: 'label',
                  width: 110,
                  render: (v: string | null | undefined) => v || '—',
                },
              ]}
            />
          </ReportSection>
        </>
      )}
    </div>
  );
}
