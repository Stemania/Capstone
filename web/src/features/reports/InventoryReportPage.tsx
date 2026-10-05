import { shopToday } from '../../utils/shopTime';
import { useEffect, useMemo, useState } from 'react';
import { DatePicker, Spin, Table, message } from 'antd';
import { inventoryApi, toolsApi } from '../../api/tools.api';
import { getErrorMessage } from '../../api/client';
import type {
  InventoryUsageByItem,
  InventoryUsageByWorker,
  InventoryUsageConsumables,
  Tool,
} from '../../types';
import {
  defaultAnalyticsRange,
  formatNum,
  rangeToParams,
  type AnalyticsRange,
} from '../analytics/analyticsPeriod';
import { ReportSection, ReportStamp, ReportToolbar, displayOrDash } from './ReportChrome';

export default function InventoryReportPage() {
  const [range, setRange] = useState<AnalyticsRange>(defaultAnalyticsRange);
  const params = rangeToParams(range);
  const [tools, setTools] = useState<Tool[]>([]);
  const [usageItem, setUsageItem] = useState<InventoryUsageByItem | null>(null);
  const [usageWorker, setUsageWorker] = useState<InventoryUsageByWorker | null>(null);
  const [usageConsumables, setUsageConsumables] = useState<InventoryUsageConsumables | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [t, byItem, byWorker, byCons] = await Promise.all([
          toolsApi.list(),
          inventoryApi.usageByItem(params),
          inventoryApi.usageByWorker(params),
          inventoryApi.usageConsumables(params),
        ]);
        if (!cancelled) {
          setTools(t.data);
          setUsageItem(byItem.data);
          setUsageWorker(byWorker.data);
          setUsageConsumables(byCons.data);
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

  return (
    <div className="report-page">
      <ReportToolbar
        title="Inventory Status Report"
        periodFrom={params.from}
        periodTo={params.to}
        extra={
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
        }
      />
      <ReportStamp periodFrom={params.from} periodTo={params.to} />

      {loading && !tools.length ? (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <Spin size="large" />
        </div>
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
            title="Consumable use between stocktakes"
            note={
              usageConsumables?.note ||
              'Usage is measured between stocktakes, not per person.'
            }
          >
            <Table
              size="small"
              pagination={false}
              rowKey="toolId"
              dataSource={usageConsumables?.items || []}
              locale={{ emptyText: 'No stocktake-based consumption in this period yet' }}
              columns={[
                { title: 'Item', dataIndex: 'name' },
                { title: 'Code', dataIndex: 'code', width: 100 },
                {
                  title: 'Consumed',
                  dataIndex: 'consumptionQuantity',
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
        </>
      )}
    </div>
  );
}
