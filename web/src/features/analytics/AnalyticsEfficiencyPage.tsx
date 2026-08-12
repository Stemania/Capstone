import { useEffect, useMemo, useState } from 'react';
import { Button, Segmented, Spin, Table, Typography, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
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
import { AnalyticsPeriodNote } from './AnalyticsChrome';
import {
  formatHours,
  formatInt,
  formatPct,
  formatPctVsTarget,
  useAnalyticsPeriod,
} from './analyticsPeriod';

const { Title, Text } = Typography;

type TabKey = 'worker' | 'operationType' | 'machine';

const AXIS = { fontSize: 12, fill: '#334155' };
const FAST = '#1d4ed8';
const SLOW = '#b45309';
const UTIL = '#0f1c2e';

export default function AnalyticsEfficiencyPage() {
  const { params } = useAnalyticsPeriod();
  const [tab, setTab] = useState<TabKey>('worker');
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

  const meta = workers || opTypes || machines;
  const minOps =
    workers?.minimumOperationCount ??
    opTypes?.minimumOperationCount ??
    machines?.minimumOperationCount;

  if (loading && !meta) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!meta) return null;

  return (
    <div>
      <AnalyticsPeriodNote
        from={meta.period.from}
        to={meta.period.to}
        excludedOperationCount={meta.excludedOperationCount}
        minimumOperationCount={minOps}
      />

      <Segmented
        style={{ marginBottom: 16 }}
        value={tab}
        onChange={(v) => setTab(v as TabKey)}
        options={[
          { label: 'By worker', value: 'worker' },
          { label: 'By operation type', value: 'operationType' },
          { label: 'By machine', value: 'machine' },
        ]}
      />

      {tab === 'worker' && workers && <WorkerSection data={workers} />}
      {tab === 'operationType' && opTypes && <OperationTypeSection data={opTypes} />}
      {tab === 'machine' && machines && <MachineSection data={machines} />}
    </div>
  );
}

function VarianceBarChart({
  rows,
  nameKey,
  height,
}: {
  rows: { name: string; variance: number; ops: number; onEst: string }[];
  nameKey: string;
  height: number;
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
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        padding: '12px 8px',
        height,
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={rows}
          margin={{ top: 8, right: 48, left: 8, bottom: 8 }}
        >
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
              return `${row.name} · ${row.ops} finished operations · finished close to target ${row.onEst}`;
            }}
          />
          <Bar dataKey="variance" name={nameKey} barSize={16} radius={[0, 3, 3, 0]}>
            {rows.map((r) => (
              <Cell
                key={r.name}
                fill={r.variance < 0 ? FAST : SLOW}
                // Pattern via stroke dash for colorblind cue: faster = solid navy-blue, slower = amber
              />
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
        <span style={{ color: SLOW, fontWeight: 600 }}>Amber</span> = over target (slower).
        Zero is the vertical reference line.
      </div>
    </div>
  );
}

function WorkerSection({ data }: { data: AnalyticsByWorker }) {
  const rows = data.workers
    .filter((w) => w.averageVariancePct != null)
    .map((w) => ({
      name: w.workerName,
      variance: w.averageVariancePct as number,
      ops: w.operationCount,
      onEst: formatPct(w.onEstimateRatePct),
    }));

  return (
    <div>
      <Title level={5} style={{ marginTop: 0, color: '#0f1c2e' }}>
        Average difference from target by worker
      </Title>
      <VarianceBarChart
        rows={rows}
        nameKey="Worker"
        height={Math.max(320, rows.length * 36 + 80)}
      />
      <Table
        style={{ marginTop: 16 }}
        size="small"
        pagination={false}
        rowKey="workerId"
        dataSource={data.workers}
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
      <Button
        className="no-print"
        size="small"
        icon={<DownloadOutlined />}
        style={{ marginTop: 8 }}
        onClick={() =>
          exportCsv(
            `efficiency-by-worker-${data.period.from}_${data.period.to}.csv`,
            data.workers,
            [
              { key: 'workerName', header: 'Worker', value: (r) => r.workerName },
              { key: 'ops', header: 'FinishedOperations', value: (r) => r.operationCount },
              {
                key: 'est',
                header: 'TargetHours',
                value: (r) => r.totalEstimatedHours,
              },
              {
                key: 'act',
                header: 'HoursWorked',
                value: (r) => r.totalActualWorkedHours,
              },
              {
                key: 'var',
                header: 'DifferenceFromTargetPct',
                value: (r) => r.averageVariancePct,
              },
              {
                key: 'onEst',
                header: 'FinishedCloseToTargetPct',
                value: (r) => r.onEstimateRatePct,
              },
              {
                key: 'rework',
                header: 'RedoHours',
                value: (r) => r.reworkWorkedHours,
              },
            ]
          )
        }
      >
        Export CSV
      </Button>
    </div>
  );
}

function OperationTypeSection({ data }: { data: AnalyticsByOperationType }) {
  const rows = data.operationTypes
    .filter((o) => o.averageVariancePct != null)
    .map((o) => ({
      name: o.operationTypeName,
      variance: o.averageVariancePct as number,
      ops: o.operationCount,
      onEst: formatPct(o.onEstimateRatePct),
    }));

  return (
    <div>
      <Title level={5} style={{ marginTop: 0, color: '#0f1c2e' }}>
        Average difference from target by operation type
      </Title>
      <VarianceBarChart
        rows={rows}
        nameKey="Operation type"
        height={Math.max(320, rows.length * 36 + 80)}
      />
      <Table
        style={{ marginTop: 16 }}
        size="small"
        pagination={false}
        rowKey="operationTypeId"
        dataSource={data.operationTypes}
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
            title: 'Finished close to target',
            dataIndex: 'onEstimateRatePct',
            width: 170,
            align: 'right',
            render: (v: number | null) => formatPct(v),
          },
        ]}
      />
      <Button
        className="no-print"
        size="small"
        icon={<DownloadOutlined />}
        style={{ marginTop: 8 }}
        onClick={() =>
          exportCsv(
            `efficiency-by-operation-type-${data.period.from}_${data.period.to}.csv`,
            data.operationTypes,
            [
              {
                key: 'name',
                header: 'OperationType',
                value: (r) => r.operationTypeName,
              },
              { key: 'code', header: 'Code', value: (r) => r.operationTypeCode },
              { key: 'ops', header: 'FinishedOperations', value: (r) => r.operationCount },
              {
                key: 'est',
                header: 'TargetHours',
                value: (r) => r.totalEstimatedHours,
              },
              {
                key: 'act',
                header: 'HoursWorked',
                value: (r) => r.totalActualWorkedHours,
              },
              {
                key: 'var',
                header: 'DifferenceFromTargetPct',
                value: (r) => r.averageVariancePct,
              },
              {
                key: 'onEst',
                header: 'FinishedCloseToTargetPct',
                value: (r) => r.onEstimateRatePct,
              },
            ]
          )
        }
      >
        Export CSV
      </Button>
    </div>
  );
}

function MachineSection({ data }: { data: AnalyticsByMachine }) {
  const utilRows = useMemo(() => {
    return [...data.machineUnits]
      .sort((a, b) => {
        const tc = (a.machineTypeCode || '').localeCompare(b.machineTypeCode || '');
        if (tc !== 0) return tc;
        return a.machineUnitLabel.localeCompare(b.machineUnitLabel);
      })
      .map((u) => ({
        name: u.machineUnitLabel,
        type: u.machineTypeCode || '—',
        utilization: u.utilizationPct ?? 0,
        ops: u.operationCount,
        below: u.belowMinimumSample,
        varianceLabel: u.belowMinimumSample
          ? 'Not enough finished operations yet'
          : formatPctVsTarget(u.averageVariancePct),
      }));
  }, [data.machineUnits]);

  const byType = useMemo(() => {
    const map = new Map<string, typeof utilRows>();
    for (const row of utilRows) {
      const list = map.get(row.type) || [];
      list.push(row);
      map.set(row.type, list);
    }
    return [...map.entries()];
  }, [utilRows]);

  return (
    <div>
      <Title level={5} style={{ marginTop: 0, color: '#0f1c2e' }}>
        Machine usage by unit
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
        Machine usage is based on time the machine was actually working during shop hours — not
        calendar time alone. By type:{' '}
        {data.machineTypes
          .map((t) => `${t.machineTypeCode} ${formatPct(t.utilizationPct)}`)
          .join(' · ')}
        .
      </Text>

      {byType.map(([type, rows]) => (
        <div key={type} style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 700, color: '#0f1c2e', marginBottom: 6 }}>{type}</div>
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '8px 8px 4px',
              height: Math.max(160, rows.length * 34 + 60),
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={rows}
                margin={{ top: 4, right: 40, left: 8, bottom: 4 }}
              >
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  domain={[0, 'auto']}
                  tick={AXIS}
                  tickFormatter={(v) => `${v}%`}
                />
                <YAxis type="category" dataKey="name" width={110} tick={AXIS} />
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
        </div>
      ))}

      <Table
        size="small"
        pagination={false}
        rowKey="machineUnitId"
        dataSource={data.machineUnits}
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
        ]}
      />
      <Button
        className="no-print"
        size="small"
        icon={<DownloadOutlined />}
        style={{ marginTop: 8 }}
        onClick={() =>
          exportCsv(
            `efficiency-by-machine-${data.period.from}_${data.period.to}.csv`,
            data.machineUnits,
            [
              { key: 'unit', header: 'Unit', value: (r) => r.machineUnitLabel },
              { key: 'type', header: 'Type', value: (r) => r.machineTypeCode },
              { key: 'ops', header: 'FinishedOperations', value: (r) => r.operationCount },
              {
                key: 'util',
                header: 'MachineUsagePct',
                value: (r) => r.utilizationPct,
              },
              {
                key: 'var',
                header: 'DifferenceFromTargetPct',
                value: (r) => (r.belowMinimumSample ? null : r.averageVariancePct),
              },
              {
                key: 'below',
                header: 'NotEnoughFinishedOperations',
                value: (r) => (r.belowMinimumSample ? 'yes' : 'no'),
              },
            ]
          )
        }
      >
        Export CSV
      </Button>
    </div>
  );
}
