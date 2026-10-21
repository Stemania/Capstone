import { shopNow, shopToday } from '../../utils/shopTime';
import { useEffect, useMemo, useState } from 'react';
import { DatePicker, Table, message } from 'antd';
import { analyticsApi } from '../../api/analytics.api';
import { workersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import { useShopDetails } from '../../hooks/useShopDetails';
import { ANALYTICS_DEFAULT_MIN_OPS } from '../../constants/shopLetterhead';
import type {
  AnalyticsByWorker,
  AnalyticsDelays,
  AnalyticsWorkerRow,
  User,
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
import { ReportSection, ReportToolbar } from './ReportChrome';
import { PrintDocument } from './PrintTemplate';
import { PageSkeleton } from '../../components/ui';
import './reportsPrint.css';

const PAUSE_LABEL: Record<string, string> = {
  END_OF_SHIFT: 'End of shift',
  BREAK: 'Break',
  MACHINE_DOWN: 'Machine breakdown',
  WAITING_MATERIAL: 'Waiting for material',
  WAITING_PRIOR_OPERATION: 'Waiting on prior operation',
  OTHER: 'Other',
};

export default function WorkerPerformanceReportPage() {
  const shop = useShopDetails();
  const [range, setRange] = useState<AnalyticsRange>(defaultAnalyticsRange);
  const params = rangeToParams(range);
  const [byWorker, setByWorker] = useState<AnalyticsByWorker | null>(null);
  const [delays, setDelays] = useState<AnalyticsDelays | null>(null);
  const [workers, setWorkers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [perf, list, d] = await Promise.all([
          analyticsApi.byWorker({ ...params, minOps: 1 }),
          workersApi.list(),
          analyticsApi.delays(params),
        ]);
        if (!cancelled) {
          setByWorker(perf.data);
          setWorkers(list.data);
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

  const minOps = ANALYTICS_DEFAULT_MIN_OPS;
  const generatedAt = shopNow().format('YYYY-MM-DD HH:mm');

  const rows = useMemo(() => {
    const byId = new Map((byWorker?.workers || []).map((w) => [w.workerId, w]));
    const merged: (AnalyticsWorkerRow & { belowMin: boolean })[] = [];

    for (const u of workers) {
      const perf = byId.get(u.id);
      const operationCount = perf?.operationCount ?? 0;
      const belowMin = operationCount < minOps;
      merged.push({
        workerId: u.id,
        workerName: u.fullName,
        operationCount,
        totalEstimatedHours: perf?.totalEstimatedHours ?? null,
        totalActualWorkedHours: perf?.totalActualWorkedHours ?? null,
        averageVariancePct: belowMin ? null : perf?.averageVariancePct ?? null,
        laborEfficiencyPct: belowMin ? null : perf?.laborEfficiencyPct ?? null,
        onEstimateRatePct: belowMin ? null : perf?.onEstimateRatePct ?? null,
        reworkWorkedHours: perf?.reworkWorkedHours ?? null,
        belowMin,
      });
      byId.delete(u.id);
    }
    for (const leftover of byId.values()) {
      const belowMin = leftover.operationCount < minOps;
      merged.push({
        ...leftover,
        averageVariancePct: belowMin ? null : leftover.averageVariancePct,
        laborEfficiencyPct: belowMin ? null : leftover.laborEfficiencyPct,
        onEstimateRatePct: belowMin ? null : leftover.onEstimateRatePct,
        belowMin,
      });
    }
    return merged.sort((a, b) => a.workerName.localeCompare(b.workerName));
  }, [byWorker, workers, minOps]);

  const pauseRows = delays?.pauseReasons || [];

  return (
    <PrintDocument
      shop={shop}
      pageSize="a4"
      wide
      toolbar={
        <ReportToolbar
          title="Worker performance report"
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
        <div className="shop-print-doc-title">Worker performance report</div>
        <div className="shop-print-doc-ref">
          Period {params.from} → {params.to} · Generated {generatedAt}
        </div>
      </div>

      {loading && !byWorker ? (
        <PageSkeleton variant="block" />
      ) : (
        <>
          <ReportSection
            title="By worker"
            note={`Averages need at least ${minOps} finished operations. Efficiency % = target ÷ actual × 100. On-time % = share finished close to target.`}
          >
            <Table
              size="small"
              pagination={false}
              rowKey="workerId"
              dataSource={rows}
              locale={{ emptyText: 'No workers to show for this period yet' }}
              columns={[
                { title: 'Worker', dataIndex: 'workerName', width: 160 },
                {
                  title: 'Ops completed',
                  dataIndex: 'operationCount',
                  width: 110,
                  align: 'right',
                  render: (v: number) => formatInt(v),
                },
                {
                  title: 'Target hours',
                  dataIndex: 'totalEstimatedHours',
                  width: 100,
                  align: 'right',
                  render: (v: number | null) => formatNum(v),
                },
                {
                  title: 'Actual hours',
                  dataIndex: 'totalActualWorkedHours',
                  width: 100,
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
                  title: 'On-time %',
                  dataIndex: 'onEstimateRatePct',
                  width: 100,
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

          <ReportSection
            title="Pause hours by reason"
            note="Shop-wide pause hours for the same period (same figures as Analytics → Delays)."
          >
            <Table
              size="small"
              pagination={false}
              rowKey="reason"
              dataSource={pauseRows}
              locale={{ emptyText: 'No pause hours in this period' }}
              columns={[
                {
                  title: 'Reason',
                  dataIndex: 'reason',
                  render: (v: string) => PAUSE_LABEL[v] || v,
                },
                {
                  title: 'Occurrences',
                  dataIndex: 'occurrenceCount',
                  width: 120,
                  align: 'right',
                },
                {
                  title: 'Hours',
                  dataIndex: 'totalPausedHours',
                  width: 100,
                  align: 'right',
                  render: (v: number | null) => formatNum(v),
                },
              ]}
            />
          </ReportSection>
        </>
      )}
    </PrintDocument>
  );
}
