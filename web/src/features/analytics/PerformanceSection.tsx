import { useEffect, useMemo, useState } from 'react';
import { Segmented, Spin, Table, Typography, message } from 'antd';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { analyticsApi } from '../../api/analytics.api';
import { getErrorMessage } from '../../api/client';
import type {
  AnalyticsByMachine,
  AnalyticsByOperationType,
  AnalyticsByWorker,
} from '../../types';
import { exportCsv } from '../../utils/csvExport';
import {
  AnalyticsSection,
  CHART_BOX,
  ShowDetails,
  withoutAllZero,
  type AnalyticsSpan,
} from './AnalyticsSection';
import {
  formatHours,
  formatInt,
  formatPct,
  formatPctVsTarget,
  useAnalyticsPeriod,
} from './analyticsPeriod';

const { Text } = Typography;

type View = 'worker' | 'operationType' | 'machine';

const AXIS = { fontSize: 12, fill: '#334155' };
const FAST = '#1d4ed8';
const SLOW = '#b45309';
const UTIL = '#0f1c2e';

export default function PerformanceSection({ span }: { span?: AnalyticsSpan }) {
  const { params } = useAnalyticsPeriod();
  const [view, setView] = useState<View>('worker');
  const [workers, setWorkers] = useState<AnalyticsByWorker | null>(null);
  const [opTypes, setOpTypes] = useState<AnalyticsByOperationType | null>(null);
  const [machines, setMachines] = useState<AnalyticsByMachine | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [w, o, m] = await Promise.all([
          analyticsApi.byWorker(params),
          analyticsApi.byOperationType(params),
          analyticsApi.byMachine(params),
        ]);
        if (!cancelled) {
          setWorkers(w.data);
          setOpTypes(o.data);
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

  const workerRows = useMemo(
    () =>
      withoutAllZero(workers?.workers ?? [], (r) => [
        r.operationCount,
        r.totalActualWorkedHours,
        r.averageVariancePct,
        r.onEstimateRatePct,
      ]),
    [workers]
  );
  const opTypeRows = useMemo(
    () =>
      withoutAllZero(opTypes?.operationTypes ?? [], (r) => [
        r.operationCount,
        r.averageVariancePct,
        r.onEstimateRatePct,
      ]),
    [opTypes]
  );
  const machineRows = useMemo(
    () =>
      withoutAllZero(machines?.machineUnits ?? [], (r) => [
        r.operationCount,
        r.utilizationPct,
        r.averageVariancePct,
      ]),
    [machines]
  );

  const minOps =
    workers?.minimumOperationCount ??
    opTypes?.minimumOperationCount ??
    machines?.minimumOperationCount;

  const onExport = () => {
    if (view === 'worker' && workers) {
      exportCsv(`efficiency-by-worker-${workers.period.from}_${workers.period.to}.csv`, workerRows, [
        { key: 'workerName', header: 'Worker', value: (r) => r.workerName },
        { key: 'ops', header: 'FinishedOperations', value: (r) => r.operationCount },
        { key: 'est', header: 'TargetHours', value: (r) => r.totalEstimatedHours },
        { key: 'act', header: 'HoursWorked', value: (r) => r.totalActualWorkedHours },
        { key: 'var', header: 'DifferenceFromTargetPct', value: (r) => r.averageVariancePct },
        { key: 'eff', header: 'LaborEfficiencyPct', value: (r) => r.laborEfficiencyPct },
        { key: 'onEst', header: 'FinishedCloseToTargetPct', value: (r) => r.onEstimateRatePct },
        { key: 'rework', header: 'RedoHours', value: (r) => r.reworkWorkedHours },
      ]);
    } else if (view === 'operationType' && opTypes) {
      exportCsv(
        `efficiency-by-operation-type-${opTypes.period.from}_${opTypes.period.to}.csv`,
        opTypeRows,
        [
          { key: 'name', header: 'OperationType', value: (r) => r.operationTypeName },
          { key: 'code', header: 'Code', value: (r) => r.operationTypeCode },
          { key: 'ops', header: 'FinishedOperations', value: (r) => r.operationCount },
          { key: 'est', header: 'TargetHours', value: (r) => r.totalEstimatedHours },
          { key: 'act', header: 'HoursWorked', value: (r) => r.totalActualWorkedHours },
          { key: 'var', header: 'DifferenceFromTargetPct', value: (r) => r.averageVariancePct },
          { key: 'eff', header: 'LaborEfficiencyPct', value: (r) => r.laborEfficiencyPct },
          { key: 'onEst', header: 'FinishedCloseToTargetPct', value: (r) => r.onEstimateRatePct },
        ]
      );
    } else if (view === 'machine' && machines) {
      exportCsv(`efficiency-by-machine-${machines.period.from}_${machines.period.to}.csv`, machineRows, [
        { key: 'unit', header: 'Unit', value: (r) => r.machineUnitLabel },
        { key: 'type', header: 'Type', value: (r) => r.machineTypeCode },
        { key: 'ops', header: 'FinishedOperations', value: (r) => r.operationCount },
        { key: 'util', header: 'MachineUsagePct', value: (r) => r.utilizationPct },
        {
          key: 'var',
          header: 'DifferenceFromTargetPct',
          value: (r) => (r.belowMinimumSample ? null : r.averageVariancePct),
        },
        {
          key: 'eff',
          header: 'LaborEfficiencyPct',
          value: (r) => (r.belowMinimumSample ? null : r.laborEfficiencyPct),
        },
        {
          key: 'below',
          header: 'NotEnoughFinishedOperations',
          value: (r) => (r.belowMinimumSample ? 'yes' : 'no'),
        },
      ]);
    }
  };

  return (
    <AnalyticsSection
      span={span}
      title="Performance"
      description={
        `How close finished work came to its target time. Labor efficiency is total target hours divided by total hours worked; over 100% means faster than planned.${
          minOps != null ? ` Averages need at least ${minOps} finished operations.` : ''
        }`
      }
      controls={
        <Segmented
          size="small"
          value={view}
          onChange={(v) => setView(v as View)}
          options={[
            { label: 'By worker', value: 'worker' },
            { label: 'By operation type', value: 'operationType' },
            { label: 'By machine', value: 'machine' },
          ]}
        />
      }
      onExport={onExport}
      exportDisabled={loading}
    >
      {loading && !workers ? (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : view === 'worker' ? (
        <WorkerView rows={workerRows} />
      ) : view === 'operationType' ? (
        <OperationTypeView rows={opTypeRows} />
      ) : machines ? (
        <MachineView data={machines} rows={machineRows} />
      ) : null}
    </AnalyticsSection>
  );
}

function VarianceBarChart({
  rows,
  nameKey,
}: {
  rows: { name: string; variance: number; ops: number; onEst: string; eff: string }[];
  nameKey: string;
}) {
  const domain = useMemo(() => {
    if (!rows.length) return [-20, 20] as [number, number];
    const maxAbs = Math.max(20, ...rows.map((r) => Math.abs(r.variance)));
    const pad = Math.ceil(maxAbs / 5) * 5;
    return [-pad, pad] as [number, number];
  }, [rows]);

  if (!rows.length) {
    return <Text type="secondary">Not enough finished operations yet for this chart.</Text>;
  }

  return (
    <div style={{ ...CHART_BOX, padding: '12px 8px', height: Math.max(300, rows.length * 34 + 80) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart layout="vertical" data={rows} margin={{ top: 8, right: 48, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            domain={domain}
            tick={AXIS}
            tickFormatter={(v) => `${v}%`}
            label={{
              value: 'Difference from target % (faster ← 0 → slower)',
              position: 'insideBottom',
              offset: -2,
              style: AXIS,
            }}
            height={44}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={140}
            tick={AXIS}
            tickFormatter={(v) => (String(v).length > 18 ? `${String(v).slice(0, 16)}…` : v)}
          />
          <ReferenceLine x={0} stroke="#0f1c2e" strokeWidth={1.5} />
          <Tooltip
            contentStyle={{ fontSize: 13 }}
            formatter={(value: number) => [formatPctVsTarget(value), 'Difference from target']}
            labelFormatter={(label, payload) => {
              const row = payload?.[0]?.payload;
              if (!row) return String(label);
              return `${row.name} · ${row.ops} finished operations · labor efficiency ${row.eff} · finished close to target ${row.onEst}`;
            }}
          />
          <Bar dataKey="variance" name={nameKey} barSize={16} radius={[0, 3, 3, 0]}>
            {rows.map((r) => (
              <Cell key={r.name} fill={r.variance < 0 ? FAST : SLOW} />
            ))}
            <LabelList
              dataKey="variance"
              position="right"
              formatter={(v: number) => formatPctVsTarget(v, 0)}
              style={{ fontSize: 11, fill: '#334155' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 12, color: '#64748b', padding: '0 8px 4px' }}>
        <span style={{ color: FAST, fontWeight: 600 }}>Blue</span> = under target (faster).{' '}
        <span style={{ color: SLOW, fontWeight: 600 }}>Amber</span> = over target (slower). Zero is
        the vertical reference line.
      </div>
    </div>
  );
}

function WorkerView({ rows }: { rows: AnalyticsByWorker['workers'] }) {
  const chartRows = rows
    .filter((w) => w.averageVariancePct != null)
    .map((w) => ({
      name: w.workerName,
      variance: w.averageVariancePct as number,
      ops: w.operationCount,
      onEst: formatPct(w.onEstimateRatePct),
      eff: formatPct(w.laborEfficiencyPct, 0),
    }));
  return (
    <>
      <VarianceBarChart rows={chartRows} nameKey="Worker" />
      <ShowDetails>
        <Table
          size="small"
          pagination={false}
          rowKey="workerId"
          dataSource={rows}
          columns={[
            { title: 'Worker', dataIndex: 'workerName' },
            { title: 'Finished operations', dataIndex: 'operationCount', width: 120, align: 'right' },
            {
              title: 'Difference from target',
              dataIndex: 'averageVariancePct',
              width: 170,
              align: 'right',
              render: (v: number | null) => formatPctVsTarget(v),
            },
            {
              title: 'Labor efficiency',
              dataIndex: 'laborEfficiencyPct',
              width: 130,
              align: 'right',
              render: (v: number | null) => formatPct(v, 0),
            },
            {
              title: 'Finished close to target',
              dataIndex: 'onEstimateRatePct',
              width: 170,
              align: 'right',
              render: (v: number | null) => formatPct(v),
            },
            {
              title: 'Hours worked',
              dataIndex: 'totalActualWorkedHours',
              width: 120,
              align: 'right',
              render: (v: number | null) => formatHours(v),
            },
          ]}
        />
      </ShowDetails>
    </>
  );
}

function OperationTypeView({ rows }: { rows: AnalyticsByOperationType['operationTypes'] }) {
  const chartRows = rows
    .filter((o) => o.averageVariancePct != null)
    .map((o) => ({
      name: o.operationTypeName,
      variance: o.averageVariancePct as number,
      ops: o.operationCount,
      onEst: formatPct(o.onEstimateRatePct),
      eff: formatPct(o.laborEfficiencyPct, 0),
    }));
  return (
    <>
      <VarianceBarChart rows={chartRows} nameKey="Operation type" />
      <ShowDetails>
        <Table
          size="small"
          pagination={false}
          rowKey="operationTypeId"
          dataSource={rows}
          columns={[
            { title: 'Operation type', dataIndex: 'operationTypeName' },
            { title: 'Code', dataIndex: 'operationTypeCode', width: 140 },
            { title: 'Finished operations', dataIndex: 'operationCount', width: 120, align: 'right' },
            {
              title: 'Difference from target',
              dataIndex: 'averageVariancePct',
              width: 170,
              align: 'right',
              render: (v: number | null) => formatPctVsTarget(v),
            },
            {
              title: 'Labor efficiency',
              dataIndex: 'laborEfficiencyPct',
              width: 130,
              align: 'right',
              render: (v: number | null) => formatPct(v, 0),
            },
            {
              title: 'Finished close to target',
              dataIndex: 'onEstimateRatePct',
              width: 170,
              align: 'right',
              render: (v: number | null) => formatPct(v),
            },
          ]}
        />
      </ShowDetails>
    </>
  );
}

function MachineView({
  data,
  rows,
}: {
  data: AnalyticsByMachine;
  rows: AnalyticsByMachine['machineUnits'];
}) {
  const chartRows = useMemo(
    () =>
      [...rows]
        .sort((a, b) => {
          const tc = (a.machineTypeCode || '').localeCompare(b.machineTypeCode || '');
          if (tc !== 0) return tc;
          return a.machineUnitLabel.localeCompare(b.machineUnitLabel);
        })
        .map((u) => ({
          name: `${u.machineUnitLabel} (${u.machineTypeCode || '—'})`,
          utilization: u.utilizationPct ?? 0,
          ops: u.operationCount,
          varianceLabel: u.belowMinimumSample
            ? 'Not enough finished operations yet'
            : `${formatPctVsTarget(u.averageVariancePct)} · labor efficiency ${formatPct(u.laborEfficiencyPct, 0)}`,
        })),
    [rows]
  );

  return (
    <>
      <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
        Machine usage counts only the time an operation was actually being worked on during shop
        hours, from each start or resume to the next pause or completion. Breaks, breakdowns and
        other pauses are not counted. By type:{' '}
        {data.machineTypes.map((t) => `${t.machineTypeCode} ${formatPct(t.utilizationPct)}`).join(' · ')}
        .
      </Text>
      {chartRows.length === 0 ? (
        <Text type="secondary">No machine use in this period.</Text>
      ) : (
        <div
          style={{ ...CHART_BOX, padding: '8px 8px 4px', height: Math.max(220, chartRows.length * 30 + 60) }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={chartRows} margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" domain={[0, 'auto']} tick={AXIS} tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="name" width={150} tick={AXIS} />
              <Tooltip
                contentStyle={{ fontSize: 13 }}
                formatter={(value: number) => [`${value.toFixed(1)}%`, 'Machine usage']}
                labelFormatter={(label, payload) => {
                  const row = payload?.[0]?.payload;
                  return row
                    ? `${row.name} · ${row.ops} finished operations · difference from target: ${row.varianceLabel}`
                    : String(label);
                }}
              />
              <Bar dataKey="utilization" fill={UTIL} barSize={14} radius={[0, 3, 3, 0]}>
                <LabelList
                  dataKey="utilization"
                  position="right"
                  formatter={(v: number) => `${v.toFixed(1)}%`}
                  style={{ fontSize: 11, fill: '#334155' }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <ShowDetails>
        <Table
          size="small"
          pagination={false}
          rowKey="machineUnitId"
          dataSource={rows}
          columns={[
            { title: 'Unit', dataIndex: 'machineUnitLabel' },
            { title: 'Type', dataIndex: 'machineTypeCode', width: 100 },
            {
              title: 'Finished operations',
              dataIndex: 'operationCount',
              width: 120,
              align: 'right',
              render: (v: number) => formatInt(v),
            },
            {
              title: 'Machine usage',
              dataIndex: 'utilizationPct',
              width: 120,
              align: 'right',
              render: (v: number | null) => formatPct(v),
            },
            {
              title: 'Difference from target',
              dataIndex: 'averageVariancePct',
              width: 180,
              align: 'right',
              render: (v: number | null, row) =>
                row.belowMinimumSample ? (
                  <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>
                    Not enough finished operations yet
                  </span>
                ) : (
                  formatPctVsTarget(v)
                ),
            },
            {
              title: 'Labor efficiency',
              dataIndex: 'laborEfficiencyPct',
              width: 130,
              align: 'right',
              render: (v: number | null, row) => (row.belowMinimumSample ? '—' : formatPct(v, 0)),
            },
          ]}
        />
      </ShowDetails>
    </>
  );
}
