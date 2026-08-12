import { useEffect, useState } from 'react';
import { Card, Col, DatePicker, Row, Spin, Table, Typography, message } from 'antd';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { analyticsApi } from '../../api/analytics.api';
import { getErrorMessage } from '../../api/client';
import type {
  AnalyticsByMachine,
  AnalyticsByOperationType,
  AnalyticsByWorker,
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
import { ReportStamp, ReportToolbar } from './ReportChrome';

const { Text } = Typography;

export default function EfficiencyReportPage() {
  const [range, setRange] = useState<AnalyticsRange>(defaultAnalyticsRange);
  const params = rangeToParams(range);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [workers, setWorkers] = useState<AnalyticsByWorker | null>(null);
  const [opTypes, setOpTypes] = useState<AnalyticsByOperationType | null>(null);
  const [machines, setMachines] = useState<AnalyticsByMachine | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [o, w, ot, m] = await Promise.all([
          analyticsApi.overview(params),
          analyticsApi.byWorker(params),
          analyticsApi.byOperationType(params),
          analyticsApi.byMachine(params),
        ]);
        if (!cancelled) {
          setOverview(o.data);
          setWorkers(w.data);
          setOpTypes(ot.data);
          setMachines(m.data);
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

  const meta = overview || workers;
  const minOps =
    workers?.minimumOperationCount ??
    opTypes?.minimumOperationCount ??
    machines?.minimumOperationCount;
  const completed = overview?.jobs.completed;
  const onTimeRate =
    completed != null && completed > 0 && overview
      ? (overview.jobs.onTime / completed) * 100
      : null;

  return (
    <div className="report-page">
      <div className="no-print" style={{ marginBottom: 8 }}>
        <Link to="/reports">← Reports</Link>
      </div>
      <ReportToolbar
        title="Production Performance Report"
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

      {loading && !meta ? (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
            {meta?.excludedOperationCount ?? '—'} finished operation
            {(meta?.excludedOperationCount ?? 0) === 1 ? '' : 's'} without a target hours value{' '}
            {(meta?.excludedOperationCount ?? 0) === 1 ? 'is' : 'are'} left out of difference-from-target
            numbers
            {minOps != null
              ? `; averages need at least ${minOps} finished operations`
              : ''}
            . Rows with fewer finished operations still show counts; averages may be blank (—).
          </Text>

          <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
            <Col xs={12} md={6}>
              <Card size="small">
                <div style={{ fontSize: 12, color: '#64748b' }}>Jobs finished</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{formatInt(completed)}</div>
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <div style={{ fontSize: 12, color: '#64748b' }}>On-time rate</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  {formatPct(onTimeRate, 0)}
                </div>
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <div style={{ fontSize: 12, color: '#64748b' }}>Avg difference from target</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  {formatPctVsTarget(overview?.efficiency.averageVariancePct)}
                </div>
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <div style={{ fontSize: 12, color: '#64748b' }}>Redo share</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  {formatPct(overview?.rework.shareOfTotalWorkedHoursPct)}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  Count {formatInt(overview?.rework.count)}
                </div>
              </Card>
            </Col>
          </Row>

          <Typography.Title level={5}>By worker</Typography.Title>
          <Table
            size="small"
            pagination={false}
            rowKey="workerId"
            dataSource={workers?.workers || []}
            locale={{ emptyText: 'No finished operations for workers in this period yet' }}
            columns={[
              { title: 'Worker', dataIndex: 'workerName' },
              { title: 'Finished operations', dataIndex: 'operationCount', width: 110, align: 'right' },
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
            ]}
          />

          <Typography.Title level={5} style={{ marginTop: 20 }}>
            By operation type
          </Typography.Title>
          <Table
            size="small"
            pagination={false}
            rowKey="operationTypeId"
            dataSource={opTypes?.operationTypes || []}
            locale={{ emptyText: 'No finished operations by operation type in this period yet' }}
            columns={[
              { title: 'Operation type', dataIndex: 'operationTypeName' },
              { title: 'Code', dataIndex: 'operationTypeCode', width: 120 },
              { title: 'Finished operations', dataIndex: 'operationCount', width: 110, align: 'right' },
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
            ]}
          />

          <Typography.Title level={5} style={{ marginTop: 20 }}>
            By machine type
          </Typography.Title>
          <Table
            size="small"
            pagination={false}
            rowKey="machineTypeId"
            dataSource={machines?.machineTypes || []}
            locale={{ emptyText: 'No finished operations by machine type in this period yet' }}
            columns={[
              { title: 'Machine type', dataIndex: 'machineTypeName' },
              { title: 'Code', dataIndex: 'machineTypeCode', width: 100 },
              { title: 'Finished operations', dataIndex: 'operationCount', width: 110, align: 'right' },
              {
                title: 'Machine usage',
                dataIndex: 'utilizationPct',
                width: 110,
                align: 'right',
                render: (v: number | null) => formatPct(v),
              },
              {
                title: 'Difference from target',
                dataIndex: 'averageVariancePct',
                width: 160,
                align: 'right',
                render: (v: number | null, row: { belowMinimumSample?: boolean }) =>
                  row.belowMinimumSample ? 'Not enough finished operations yet' : formatPctVsTarget(v),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}
