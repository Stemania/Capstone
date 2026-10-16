import { useState } from 'react';
import { Button, Segmented } from 'antd';
import { Link } from 'react-router-dom';
import { PageSkeleton } from '../../components/ui';
import { exportCsv } from '../../utils/csvExport';
import { fmtNum, fmtSignedPct } from './format';
import { Card, ChartEmpty, DivergingBars, Grid, PALETTE } from './kit';
import { CardLoading } from './cards';
import { useByMachine, useByOperationType, useByWorker, usePeriods } from './sources';

type View = 'worker' | 'type' | 'machine';

type PerfRow = {
  key: string;
  label: string;
  ops: number;
  target: number | null;
  worked: number | null;
  variance: number;
  onTarget: number | null;
};

const WEIGHT_LABEL: Record<string, string> = {
  operator: 'Assigned operator',
  skill: 'Skill',
  efficiency: 'Past performance',
  workload: 'Workload',
};

const WEIGHT_COLOR: Record<string, string> = {
  operator: PALETTE.navy,
  skill: PALETTE.second,
  efficiency: PALETTE.primary,
  workload: PALETTE.third,
};

const KIND_LABEL: Record<string, string> = {
  machineLead: 'Machine operation, lead',
  noMachine: 'No machine',
  helper: 'Helper',
};

/** Worker analytics section (Admin). Shown inside Production; old /workers URL redirects. */
export default function AnalyticsWorkersPage() {
  const { period } = usePeriods();
  const byWorker = useByWorker(period).data;
  const byType = useByOperationType(period).data;
  const byMachine = useByMachine(period).data;
  const [view, setView] = useState<View>('worker');
  const [table, setTable] = useState(false);

  if (!byWorker) return <PageSkeleton variant="cards" />;

  const minOps = byWorker.minimumOperationCount;
  const rowsFor = (v: View): PerfRow[] | null => {
    if (v === 'worker') {
      return byWorker.workers.map((w) => ({
        key: w.workerId,
        label: w.workerName,
        ops: w.operationCount,
        target: w.totalEstimatedHours,
        worked: w.totalActualWorkedHours,
        variance: w.averageVariancePct ?? 0,
        onTarget: w.onEstimateRatePct,
      }));
    }
    if (v === 'type') {
      if (!byType) return null;
      return byType.operationTypes
        .filter((t) => t.averageVariancePct != null && t.operationCount >= byType.minimumOperationCount)
        .map((t) => ({
          key: t.operationTypeId,
          label: t.operationTypeName,
          ops: t.operationCount,
          target: t.totalEstimatedHours,
          worked: t.totalActualWorkedHours,
          variance: t.averageVariancePct ?? 0,
          onTarget: t.onEstimateRatePct,
        }));
    }
    if (!byMachine) return null;
    return byMachine.machineUnits
      .filter((u) => u.averageVariancePct != null && !u.belowMinimumSample)
      .map((u) => ({
        key: u.machineUnitId,
        label: u.machineUnitLabel,
        ops: u.operationCount,
        target: u.totalEstimatedHours,
        worked: u.totalActualWorkedHours,
        variance: u.averageVariancePct ?? 0,
        onTarget: u.onEstimateRatePct,
      }));
  };
  const rows = rowsFor(view)?.sort((a, b) => a.variance - b.variance) ?? null;
  const faster = rows?.filter((r) => r.variance < 0).length ?? 0;
  const noun = view === 'worker' ? 'workers' : view === 'type' ? 'operation types' : 'machines';
  const weights = byWorker.recommendationWeights;

  return (
    <div>
      <Grid>
        <Card
          title="Performance vs target"
          span={8}
          foot={
            rows && rows.length > 0 && rows.length < 3
              ? `Others have fewer than ${minOps} finished operations in this period.`
              : undefined
          }
          takeaway={
            rows?.length ? (
              <>
                <strong>
                  {faster} of {rows.length}
                </strong>{' '}
                {noun} faster than target
              </>
            ) : undefined
          }
          info={`Average of (hours worked − target hours) ÷ target over finished operations in the period, redo work left out. Needs at least ${minOps} finished operations each. This is the "past performance" input to worker recommendations.`}
          controls={
            <Segmented
              size="small"
              value={view}
              onChange={(v) => setView(v as View)}
              options={[
                { label: 'Worker', value: 'worker' },
                { label: 'Operation', value: 'type' },
                { label: 'Machine', value: 'machine' },
              ]}
            />
          }
          onExport={
            rows?.length
              ? () =>
                  exportCsv(`performance-by-${view}`, rows, [
                    { key: 'n', header: 'Name', value: (r) => r.label },
                    { key: 'o', header: 'Finished operations', value: (r) => r.ops },
                    { key: 't', header: 'Target hours', value: (r) => r.target ?? '' },
                    { key: 'w', header: 'Hours worked', value: (r) => r.worked ?? '' },
                    { key: 'v', header: 'Time vs target %', value: (r) => r.variance },
                    { key: 'e', header: 'On target %', value: (r) => r.onTarget ?? '' },
                  ])
              : undefined
          }
        >
          {!rows ? (
            <CardLoading rows={6} />
          ) : !rows.length ? (
            <ChartEmpty
              title="Not enough finished operations"
              text={`Each needs at least ${minOps} finished operations with a target in the period.`}
              height={200}
            />
          ) : (
            <>
              <DivergingBars
                rows={rows.map((r) => ({
                  key: r.key,
                  label: r.label,
                  value: r.variance,
                  title: `${r.label}: ${r.ops} operations · ${fmtNum(r.worked, 1)} h worked vs ${fmtNum(r.target, 1)} h target`,
                }))}
                format={(v) => fmtSignedPct(v)}
                leftLabel="faster"
                rightLabel="slower"
              />
              <Button type="link" size="small" style={{ padding: 0, marginTop: 8 }} onClick={() => setTable((t) => !t)}>
                {table ? 'Hide table' : 'Show table'}
              </Button>
              {table ? (
                <div className="ana-table__wrap" style={{ marginTop: 4 }}>
                  <table className="ana-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th className="num">Operations</th>
                        <th className="num">Target h</th>
                        <th className="num">Worked h</th>
                        <th className="num">vs target</th>
                        <th className="num">On target</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.key}>
                          <td className="strong">{r.label}</td>
                          <td className="num">{r.ops}</td>
                          <td className="num">{fmtNum(r.target, 1)}</td>
                          <td className="num">{fmtNum(r.worked, 1)}</td>
                          <td className={`num ${r.variance > 0 ? 'ana-bad' : 'ana-good'}`}>{fmtSignedPct(r.variance, 1)}</td>
                          <td className="num">{r.onTarget == null ? '—' : `${fmtNum(r.onTarget)}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
        </Card>

        <Card
          title="How workers are recommended"
          span={4}
          takeaway="Weighted sum per suggestion"
          info={`Each available candidate gets a 0–1 score per factor; the weighted sum ranks them. Past performance = average of target ÷ hours worked (capped at 1.5) on this operation type, all types when fewer than ${
            weights?.minimumSamples ?? 2
          } operations. Workload favours fewer hours booked this week. Availability is a filter, not a weight.`}
          controls={
            <Link to="/settings/scoring-weights" className="ana-muted" style={{ fontSize: 12 }}>
              Details
            </Link>
          }
        >
          {!weights ? (
            <CardLoading />
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {(['machineLead', 'noMachine', 'helper'] as const).map((kind) => {
                const w = Object.fromEntries(Object.entries(weights[kind]).sort((a, b) => b[1] - a[1]));
                return (
                  <div key={kind}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{KIND_LABEL[kind]}</div>
                    <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden' }}>
                      {Object.entries(w).map(([k, v]) => (
                        <span
                          key={k}
                          title={`${WEIGHT_LABEL[k] ?? k} ${Math.round(v * 100)}%`}
                          style={{ width: `${v * 100}%`, background: WEIGHT_COLOR[k] ?? PALETTE.muted }}
                        />
                      ))}
                    </div>
                    <div className="ana-legend" style={{ marginTop: 6, marginBottom: 0 }}>
                      {Object.entries(w).map(([k, v]) => (
                        <span key={k} className="ana-legend__item">
                          <span className="ana-legend__swatch ana-legend__swatch--bar" style={{ color: WEIGHT_COLOR[k] }} />
                          {WEIGHT_LABEL[k] ?? k} {Math.round(v * 100)}%
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </Grid>
    </div>
  );
}
