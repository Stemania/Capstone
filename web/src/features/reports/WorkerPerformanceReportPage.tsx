import { useEffect, useMemo, useState } from 'react';
import { DatePicker, Spin, Table, Typography, message } from 'antd';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { analyticsApi } from '../../api/analytics.api';
import { workersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import { ANALYTICS_DEFAULT_MIN_OPS } from '../../constants/shopLetterhead';
import type { AnalyticsByWorker, AnalyticsWorkerRow, User, WorkerSkill } from '../../types';
import {
  defaultAnalyticsRange,
  formatInt,
  formatNum,
  formatPct,
  formatPctVsTarget,
  rangeToParams,
  type AnalyticsRange,
} from '../analytics/analyticsPeriod';
import { ReportStamp, ReportToolbar } from './ReportChrome';

function skillLabel(s: WorkerSkill) {
  const name = s.machineTypeName || s.machineTypeCode || s.machineTypeId;
  const primary = s.isPrimary ? ' (primary)' : '';
  return `${name} skill ${s.proficiency}${primary}`;
}

export default function WorkerPerformanceReportPage() {
  const [range, setRange] = useState<AnalyticsRange>(defaultAnalyticsRange);
  const params = rangeToParams(range);
  const [byWorker, setByWorker] = useState<AnalyticsByWorker | null>(null);
  const [workers, setWorkers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // minOps=1 so we still get counts for thin samples; averages blanked below threshold.
        const [perf, list] = await Promise.all([
          analyticsApi.byWorker({ ...params, minOps: 1 }),
          workersApi.list(),
        ]);
        if (!cancelled) {
          setByWorker(perf.data);
          setWorkers(list.data);
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

  const rows = useMemo(() => {
    const byId = new Map((byWorker?.workers || []).map((w) => [w.workerId, w]));
    const merged: (AnalyticsWorkerRow & { skills: WorkerSkill[]; belowMin: boolean })[] = [];

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
        onEstimateRatePct: belowMin ? null : perf?.onEstimateRatePct ?? null,
        reworkWorkedHours: perf?.reworkWorkedHours ?? null,
        skills: u.skills || [],
        belowMin,
      });
      byId.delete(u.id);
    }
    // Workers who appear in analytics but not in active list
    for (const leftover of byId.values()) {
      const belowMin = leftover.operationCount < minOps;
      merged.push({
        ...leftover,
        averageVariancePct: belowMin ? null : leftover.averageVariancePct,
        onEstimateRatePct: belowMin ? null : leftover.onEstimateRatePct,
        skills: [],
        belowMin,
      });
    }
    return merged.sort((a, b) => a.workerName.localeCompare(b.workerName));
  }, [byWorker, workers, minOps]);

  return (
    <div className="report-page">
      <div className="no-print" style={{ marginBottom: 8 }}>
        <Link to="/reports">← Reports</Link>
      </div>
      <ReportToolbar
        title="Worker Performance Report"
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
            disabledDate={(d) => d.isAfter(dayjs(), 'day')}
          />
        }
      />
      <ReportStamp periodFrom={params.from} periodTo={params.to} />

      {loading && !byWorker ? (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
            {byWorker?.excludedOperationCount ?? '—'} finished operation
            {(byWorker?.excludedOperationCount ?? 0) === 1 ? '' : 's'} without a target hours value{' '}
            {(byWorker?.excludedOperationCount ?? 0) === 1 ? 'is' : 'are'} left out of
            difference-from-target numbers; averages need at least {minOps} finished operations. Below
            that: counts shown, averages blank (—). Redo is shown as hours worked (there is no
            separate redo count per worker).
          </Typography.Text>

          <Table
            size="small"
            pagination={false}
            rowKey="workerId"
            dataSource={rows}
            scroll={{ x: 1100 }}
            locale={{ emptyText: 'No workers to show for this period yet' }}
            columns={[
              { title: 'Worker', dataIndex: 'workerName', fixed: 'left', width: 160 },
              {
                title: 'Finished operations',
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
                title: 'Hours worked',
                dataIndex: 'totalActualWorkedHours',
                width: 100,
                align: 'right',
                render: (v: number | null) => formatNum(v),
              },
              {
                title: 'Difference from target',
                dataIndex: 'averageVariancePct',
                width: 160,
                align: 'right',
                render: (v: number | null) => formatPctVsTarget(v),
              },
              {
                title: 'Finished close to target',
                dataIndex: 'onEstimateRatePct',
                width: 160,
                align: 'right',
                render: (v: number | null) => formatPct(v),
              },
              {
                title: 'Redo hours',
                dataIndex: 'reworkWorkedHours',
                width: 100,
                align: 'right',
                render: (v: number | null) => formatNum(v),
              },
              {
                title: 'Machines they can run',
                key: 'skills',
                render: (_: unknown, r: { skills: WorkerSkill[] }) =>
                  r.skills?.length ? r.skills.map(skillLabel).join('; ') : '—',
              },
            ]}
          />
        </>
      )}
    </div>
  );
}
