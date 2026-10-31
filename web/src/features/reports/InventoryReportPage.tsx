import { shopToday } from '../../utils/shopTime';
import { useEffect, useMemo, useState } from 'react';
import { Button, DatePicker, message } from 'antd';
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
  formatInt,
  rangeToParams,
  type AnalyticsRange,
} from '../analytics/analyticsPeriod';
import { ReportToolbar, displayOrDash } from './ReportChrome';
import {
  FormalTable,
  ReportHeading,
  ReportNotes,
  ReportSignatures,
  ReportTitleBlock,
  SummaryTable,
  longDate,
  qty,
  sum,
} from './FormalReport';
import { PrintDocument } from './PrintTemplate';
import { PageSkeleton } from '../../components/ui';
import './reportsPrint.css';

const STATUS_LABEL: Record<string, string> = {
  REORDER_NOW: 'Reorder now',
  REORDER_SOON: 'Reorder soon',
  OK: 'OK',
  NO_DATA: 'No data yet',
  NOT_STOCKED: 'Not stocked yet',
};

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

  const today = shopToday().format('YYYY-MM-DD');
  const consumables = runOut?.items || [];
  const outstanding = usageWorker?.outstandingUnreturned || [];
  const awaiting: MaterialPurchase[] = (purchases?.items || []).filter(
    (p) => !p.dateReceived && !p.cancelledAt
  );

  const toolAvailability = useMemo(() => {
    return types
      .map((t) => {
        const units = t.units || [];
        const available = t.availableCount ?? units.filter((u) => u.status === 'AVAILABLE').length;
        const out = t.outCount ?? units.filter((u) => u.status === 'OUT').length;
        const total = t.totalUnits ?? units.length;
        return { typeName: t.name, available, out, total };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => a.typeName.localeCompare(b.typeName));
  }, [types]);
  const toolUnits = sum(toolAvailability, (r) => r.total) ?? 0;
  const toolsOut = sum(toolAvailability, (r) => r.out) ?? 0;
  const reorderNow = consumables.filter((c) => c.status === 'REORDER_NOW').length;
  const reorderSoon = consumables.filter((c) => c.status === 'REORDER_SOON').length;

  const exportReport = () => {
    const sections = [
      `Inventory report,Period ${params.from} to ${params.to}`,
      'Consumables',
      rowsToCsv(consumables, [
        { key: 'name', header: 'Item', value: (r) => r.name },
        { key: 'code', header: 'Code', value: (r) => r.code },
        { key: 'onHand', header: 'On hand', value: (r) => r.quantityOnHand },
        { key: 'rop', header: 'Reorder level', value: (r) => r.reorderLevel },
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
                format="MMM D, YYYY"
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
      <div className="formal-report">
        <ReportTitleBlock title="Inventory Report" from={params.from} to={params.to} />

        {loading && !tools.length && !consumables.length ? (
          <PageSkeleton variant="block" />
        ) : (
          <>
            <ReportHeading n={1}>Summary</ReportHeading>
            <SummaryTable
              caption="Table 1. Summary of inventory"
              items={[
                { label: 'Consumable items in stock list', value: formatInt(consumables.length) },
                { label: 'Consumables to reorder now', value: formatInt(reorderNow) },
                { label: 'Consumables to reorder soon', value: formatInt(reorderSoon) },
                {
                  label: 'Tool units out with workers',
                  value: `${formatInt(toolsOut)} of ${formatInt(toolUnits)}`,
                },
                { label: 'Material lines awaiting delivery', value: formatInt(awaiting.length) },
              ]}
            />

            <ReportHeading n={2}>Consumables Stock Status</ReportHeading>
            <FormalTable
              caption={`Table 2. Stock on hand and reorder status of consumables as of ${longDate(today)}`}
              numbered
              rows={consumables}
              rowKey={(r) => r.toolId}
              rowClassName={(r) => (r.status === 'REORDER_NOW' ? 'fr-row-flag' : undefined)}
              empty="No consumables on file."
              columns={[
                {
                  title: 'Item',
                  render: (r) => (
                    <>
                      {r.name}
                      {r.sizeSpec ? <span className="fr-sub">{r.sizeSpec}</span> : null}
                    </>
                  ),
                  width: '22%',
                },
                {
                  title: 'Code',
                  render: (r) => r.code,
                  width: '19%',
                  nowrap: true,
                  className: 'fr-code',
                },
                {
                  title: 'On hand',
                  render: (r) => qty(r.quantityOnHand, r.unit),
                  align: 'right',
                  width: '10%',
                  nowrap: true,
                },
                {
                  title: 'Reorder level',
                  render: (r) => qty(r.reorderLevel, r.unit),
                  align: 'right',
                  width: '10%',
                  nowrap: true,
                },
                {
                  title: 'Status',
                  render: (r) => STATUS_LABEL[r.status || ''] || '—',
                  width: '13%',
                },
                {
                  title: 'Days left',
                  render: (r) => (r.daysLeft == null ? '—' : formatInt(r.daysLeft)),
                  align: 'right',
                  width: '9%',
                },
                {
                  title: 'ABC class',
                  render: (r) => r.abcClass || '—',
                  align: 'center',
                  width: '9%',
                },
              ]}
            />
            <ReportNotes
              items={[
                'Items to reorder now are shown in bold.',
                'The reorder level is computed from recent usage, the supplier lead time, and a safety buffer. Days left is how long the stock is expected to last at its recent rate of use.',
                'ABC class ranks items by the value of their use: A for the few items with the highest value, C for the many with the lowest.',
              ]}
            />

            <ReportHeading n={3}>Tool Availability</ReportHeading>
            <FormalTable
              caption="Table 3. Tool units available and out, by tool type"
              rows={toolAvailability}
              rowKey={(r) => r.typeName}
              empty="No tool units on file."
              columns={[
                { title: 'Tool type', render: (r) => r.typeName, width: '52%' },
                {
                  title: 'Total units',
                  render: (r) => formatInt(r.total),
                  align: 'right',
                  width: '16%',
                },
                {
                  title: 'Available',
                  render: (r) => formatInt(r.available),
                  align: 'right',
                  width: '16%',
                },
                { title: 'Out', render: (r) => formatInt(r.out), align: 'right', width: '16%' },
              ]}
              total={[
                'Total',
                formatInt(toolUnits),
                formatInt(sum(toolAvailability, (r) => r.available)),
                formatInt(toolsOut),
              ]}
            />

            <ReportHeading n={4}>Tools Not Yet Returned</ReportHeading>
            <FormalTable
              caption="Table 4. Tools still held by each worker"
              rows={outstanding}
              rowKey={(r) => r.workerId}
              empty="All borrowed tools have been returned."
              columns={[
                { title: 'Worker', render: (r) => displayOrDash(r.workerName), width: '28%' },
                {
                  title: 'Tools held',
                  render: (r) =>
                    r.items?.length
                      ? r.items
                          .map(
                            (i) =>
                              `${i.toolName}${i.quantity != null && i.quantity !== 1 ? ` (${i.quantity})` : ''}`
                          )
                          .join('; ')
                      : '—',
                  width: '56%',
                },
                {
                  title: 'Quantity',
                  render: (r) =>
                    r.totalOutstandingQuantity == null
                      ? '—'
                      : formatInt(r.totalOutstandingQuantity),
                  align: 'right',
                  width: '16%',
                },
              ]}
            />

            <ReportHeading n={5}>Materials Awaiting Delivery</ReportHeading>
            <FormalTable
              caption="Table 5. Job materials ordered from suppliers and not yet received"
              numbered
              rows={awaiting}
              rowKey={(r) => r.id}
              empty="No materials are awaiting delivery."
              columns={[
                {
                  title: 'Material',
                  render: (r) => (
                    <>
                      {r.materialName}
                      {r.gradeOrSpec || r.sizeSpec ? (
                        <span className="fr-sub">
                          {[r.gradeOrSpec, r.sizeSpec].filter(Boolean).join(' · ')}
                        </span>
                      ) : null}
                    </>
                  ),
                  width: '27%',
                },
                {
                  title: 'Quantity',
                  render: (r) => qty(r.quantity, r.unit),
                  align: 'right',
                  width: '11%',
                  nowrap: true,
                },
                { title: 'Supplier', render: (r) => displayOrDash(r.supplierName), width: '25%' },
                {
                  title: 'Job order',
                  render: (r) => displayOrDash(r.jobNumber),
                  width: '15%',
                  nowrap: true,
                },
                {
                  title: 'Expected delivery',
                  render: (r) => longDate(r.currentExpectedDate ?? r.expectedDeliveryDate),
                  width: '16%',
                },
              ]}
            />

            <ReportSignatures shop={shop} />
          </>
        )}
      </div>
    </PrintDocument>
  );
}
