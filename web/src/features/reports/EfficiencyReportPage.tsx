import { shopNow, shopToday } from '../../utils/shopTime';
import { useEffect, useState } from 'react';
import { DatePicker, Table, message } from 'antd';
import { analyticsApi } from '../../api/analytics.api';
import { getErrorMessage } from '../../api/client';
import { useShopDetails } from '../../hooks/useShopDetails';
import type {
  AnalyticsByMachine,
  AnalyticsByOperationType,
  AnalyticsDelays,
  AnalyticsOverview,
} from '../../types';
import {
  defaultAnalyticsRange,
  formatInt,
  formatNum,
  formatPct,
  formatPctVsTarget,
  rangeToParams,
  type AnalyticsRange,
} from '../analytics/analyticsPeriod';
import { ReportKpi, ReportSection, ReportToolbar } from './ReportChrome';
import { PrintDocument } from './PrintTemplate';
import { PageSkeleton } from '../../components/ui';
import './reportsPrint.css';

export default function EfficiencyReportPage() {
  const shop = useShopDetails();
  const [range, setRange] = useState<AnalyticsRange>(defaultAnalyticsRange);
  const params = rangeToParams(range);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [opTypes, setOpTypes] = useState<AnalyticsByOperationType | null>(null);
  const [machines, setMachines] = useState<AnalyticsByMachine | null>(null);
  const [delays, setDelays] = useState<AnalyticsDelays | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [o, ot, m, d] = await Promise.all([
          analyticsApi.overview(params),
          analyticsApi.byOperationType(params),
          analyticsApi.byMachine(params),
          analyticsApi.delays(params),
        ]);
        if (!cancelled) {
          setOverview(o.data);
          setOpTypes(ot.data);
          setMachines(m.data);
          setDelays(d.data);
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

  const minOps = opTypes?.minimumOperationCount ?? machines?.minimumOperationCount;
  const generatedAt = shopNow().format('YYYY-MM-DD HH:mm');
  const pareto = (delays?.causes || []).filter((c) => (c.hours ?? 0) > 0);

  return (
    <PrintDocument
      shop={shop}
      pageSize="a4"
      wide
      toolbar={
        <ReportToolbar
          title="Efficiency report"
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
      }
    >
      <div className="shop-print-doc-head">
        <div className="shop-print-doc-title">Efficiency report</div>
        <div className="shop-print-doc-ref">
          Period {params.from} → {params.to} · Generated {generatedAt}
        </div>
      </div>

      {loading && !overview ? (
        <PageSkeleton variant="block" />
      ) : (
        <>
          <p className="report-note">
            Labor efficiency = target hours ÷ actual hours × 100 (working time only).
            {minOps != null ? ` Averages need at least ${minOps} finished operations.` : ''}
          </p>

          <div className="report-kpi-grid">
            <ReportKpi label="Jobs finished" value={formatInt(overview?.jobs.completed)} />
            <ReportKpi
              label="Avg difference from target"
              value={formatPctVsTarget(overview?.efficiency.averageVariancePct)}
              hint="Under target is faster (efficiency above 100%)."
            />
            <ReportKpi
              label="Redo share"
              value={formatPct(overview?.rework.shareOfTotalWorkedHoursPct)}
              hint={`Count ${formatInt(overview?.rework.count)}`}
            />
            <ReportKpi
              label="Delay hours"
              value={formatNum(delays?.totalDelayHours)}
              hint={pareto[0] ? `Top: ${pareto[0].label}` : undefined}
            />
          </div>

          <ReportSection title="Labor efficiency by operation type">
            <Table
              size="small"
              pagination={false}
              rowKey="operationTypeId"
              dataSource={opTypes?.operationTypes || []}
              locale={{ emptyText: 'No finished operations by operation type yet' }}
              columns={[
                { title: 'Operation type', dataIndex: 'operationTypeName' },
                { title: 'Code', dataIndex: 'operationTypeCode', width: 100 },
                {
                  title: 'Finished',
                  dataIndex: 'operationCount',
                  width: 90,
                  align: 'right',
                },
                {
                  title: 'Planned hours',
                  dataIndex: 'totalEstimatedHours',
                  width: 110,
                  align: 'right',
                  render: (v: number | null) => formatNum(v),
                },
                {
                  title: 'Actual hours',
                  dataIndex: 'totalActualWorkedHours',
                  width: 110,
                  align: 'right',
                  render: (v: number | null) => formatNum(v),
                },
                {
                  title: 'Efficiency %',
                  dataIndex: 'laborEfficiencyPct',
                  width: 110,
                  align: 'right',
                  render: (v: number | null) => formatPct(v),
                },
                {
                  title: 'Vs target',
                  dataIndex: 'averageVariancePct',
                  width: 110,
                  align: 'right',
                  render: (v: number | null) => formatPctVsTarget(v),
                },
              ]}
            />
          </ReportSection>

          <ReportSection title="Labor efficiency by machine type">
            <Table
              size="small"
              pagination={false}
              rowKey="machineTypeId"
              dataSource={machines?.machineTypes || []}
              locale={{ emptyText: 'No finished operations by machine type yet' }}
              columns={[
                { title: 'Machine type', dataIndex: 'machineTypeName' },
                { title: 'Code', dataIndex: 'machineTypeCode', width: 90 },
                {
                  title: 'Finished',
                  dataIndex: 'operationCount',
                  width: 90,
                  align: 'right',
                },
                {
                  title: 'Planned hours',
                  dataIndex: 'totalEstimatedHours',
                  width: 110,
                  align: 'right',
                  render: (v: number | null) => formatNum(v),
                },
                {
                  title: 'Actual hours',
                  dataIndex: 'totalActualWorkedHours',
                  width: 110,
                  align: 'right',
                  render: (v: number | null) => formatNum(v),
                },
                {
                  title: 'Efficiency %',
                  dataIndex: 'laborEfficiencyPct',
                  width: 110,
                  align: 'right',
                  render: (v: number | null, row: { belowMinimumSample?: boolean }) =>
                    row.belowMinimumSample ? '—' : formatPct(v),
                },
                {
                  title: 'Vs target',
                  dataIndex: 'averageVariancePct',
                  width: 110,
                  align: 'right',
                  render: (v: number | null, row: { belowMinimumSample?: boolean }) =>
                    row.belowMinimumSample ? 'Not enough samples' : formatPctVsTarget(v),
                },
              ]}
            />
          </ReportSection>

          <ReportSection
            title="Top delay causes (Pareto)"
            note={
              delays?.paretoThresholdPct != null
                ? `Sorted by hours lost; cumulative % marks the vital few (threshold ${delays.paretoThresholdPct}%).`
                : undefined
            }
          >
            <Table
              size="small"
              pagination={false}
              rowKey={(r) => `${r.causeType}-${r.cause}`}
              dataSource={pareto}
              locale={{ emptyText: 'No delay hours in this period' }}
              columns={[
                { title: 'Cause', dataIndex: 'label' },
                { title: 'Type', dataIndex: 'causeType', width: 100 },
                {
                  title: 'Hours',
                  dataIndex: 'hours',
                  width: 90,
                  align: 'right',
                  render: (v: number | null) => formatNum(v),
                },
                {
                  title: 'Count',
                  dataIndex: 'occurrenceCount',
                  width: 80,
                  align: 'right',
                },
                {
                  title: 'Share %',
                  dataIndex: 'shareOfTotalPct',
                  width: 90,
                  align: 'right',
                  render: (v: number | null) => formatPct(v),
                },
                {
                  title: 'Cumulative %',
                  dataIndex: 'cumulativePct',
                  width: 110,
                  align: 'right',
                  render: (v: number | null) => formatPct(v),
                },
              ]}
            />
          </ReportSection>
        </>
      )}
    </PrintDocument>
  );
}
