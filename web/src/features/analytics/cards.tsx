import { useState, type ReactNode } from 'react';
import { Segmented, Skeleton } from 'antd';
import { Link } from 'react-router-dom';
import StatusPill from '../../components/StatusPill';
import type { Tone } from '../../theme/tokens';
import type {
  AnalyticsDemandForecast,
  AnalyticsSalesForecast,
  CompletionEstimateJob,
  ConsumableRunOut,
  ConsumableRunOutRow,
  MovingAverageForecast,
  SupplierReliability,
} from '../../types';
import { exportCsv } from '../../utils/csvExport';
import { fmtDay, fmtMonth, fmtNum, fmtPesoCompact, fmtPeso, JOB_TYPE_LABEL, pctChange } from './format';
import {
  Card,
  ChartEmpty,
  ForecastChart,
  Grade,
  MethodNote,
  ScoreRing,
  STOCK_LABEL,
  STOCK_TONE,
  type Span,
} from './kit';

export function CardLoading({ rows = 4 }: { rows?: number }) {
  return <Skeleton active title={false} paragraph={{ rows }} />;
}

// ---------- Forecasts ----------

const EXCLUDED_REASON: Record<string, string> = {
  PARTIAL_FIRST_MONTH: 'first month (records started mid-month)',
  IN_PROGRESS: 'in progress',
};

function ForecastInfo({ f, what, format }: { f: MovingAverageForecast; what: string; format: (v: number | null) => string }) {
  return (
    <div style={{ maxWidth: 340, display: 'grid', gap: 8 }}>
      <div>{what}</div>
      {f.excludedMonths?.length ? (
        <div>
          Not used:{' '}
          {f.excludedMonths.map((m) => `${fmtMonth(m.month)} (${EXCLUDED_REASON[m.reason] ?? m.reason})`).join(', ')}.
        </div>
      ) : null}
      {f.methods?.length ? (
        <div>
          <div style={{ marginBottom: 4 }}>
            Each method forecasts every past month from the months before it; the lowest{' '}
            {f.errorMetric === 'MAE' ? 'MAE (MAPE is undefined when a month is 0)' : 'MAPE'} wins.
          </div>
          <table className="ana-table">
            <thead>
              <tr>
                <th>Method</th>
                <th className="num">MAPE</th>
                <th className="num">MAE</th>
              </tr>
            </thead>
            <tbody>
              {f.methods.map((m) => (
                <tr key={m.key}>
                  <td className={m.selected ? 'strong' : undefined}>
                    {m.name}
                    {m.selected ? ' ✓' : ''}
                  </td>
                  <td className="num">{m.mapePct == null ? '—' : `${fmtNum(m.mapePct, 1)}%`}</td>
                  <td className="num">{format(m.mae)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div>
        Band: {f.intervalLevelPct ?? 80}% prediction interval, forecast ± 1.28 × back-test RMSE × √(months ahead).
        Needs {f.monthsNeeded} full months.
      </div>
    </div>
  );
}

function forecastTakeaway(f: MovingAverageForecast, format: (v: number | null) => string, noun: string): {
  text: ReactNode;
  tone?: 'good' | 'bad';
} {
  if (!f.enoughHistory) {
    return { text: `Not enough history yet · ${f.monthsAvailable} of ${f.monthsNeeded} full months` };
  }
  const next = f.horizon?.[0];
  const last = f.months[f.months.length - 1];
  if (!next) return { text: '' };
  const change = pctChange(next.forecast, last?.actual);
  const dir = change == null ? '' : Math.round(change) === 0 ? ' · same as ' : change > 0 ? ` · up ${Math.round(change)}% vs ` : ` · down ${Math.abs(Math.round(change))}% vs `;
  return {
    text: (
      <>
        <strong>{format(next.forecast)}</strong> {noun} in {fmtMonth(next.month)}
        {change == null ? '' : `${dir}${fmtMonth(last.month)}`}
      </>
    ),
    tone: change == null || Math.round(change) === 0 ? undefined : change > 0 ? 'good' : 'bad',
  };
}

function ForecastBody({
  f,
  format,
  height,
}: {
  f: MovingAverageForecast;
  format: (v: number | null | undefined) => string;
  height: number;
}) {
  if (!f.months.length) {
    return <ChartEmpty title="Not enough history yet" text={`Needs ${f.monthsNeeded} full months of records.`} height={height} />;
  }
  return (
    <>
      <ForecastChart
        months={f.months}
        horizon={f.enoughHistory ? f.horizon ?? [] : []}
        soFar={f.enoughHistory ? f.currentMonthSoFar : null}
        format={format}
        height={height}
        intervalPct={f.intervalLevelPct ?? 80}
      />
      <MethodNote
        method={f.method}
        metric={f.errorMetric ?? null}
        mae={f.mae}
        mapePct={f.mapePct}
        tested={f.backtestedMonths}
        format={format}
      />
    </>
  );
}

function exportForecast(name: string, f: MovingAverageForecast) {
  const rows = [
    ...f.months.map((m) => ({ month: m.month, kind: 'Actual', value: m.actual, lower: null, upper: null })),
    ...(f.horizon ?? []).map((h) => ({ month: h.month, kind: 'Forecast', value: h.forecast, lower: h.lower, upper: h.upper })),
  ];
  exportCsv(name, rows, [
    { key: 'month', header: 'Month', value: (r) => r.month },
    { key: 'kind', header: 'Type', value: (r) => r.kind },
    { key: 'value', header: 'Value', value: (r) => r.value ?? '' },
    { key: 'lower', header: 'Lower (80%)', value: (r) => r.lower ?? '' },
    { key: 'upper', header: 'Upper (80%)', value: (r) => r.upper ?? '' },
  ]);
}

export function SalesForecastCard({
  data,
  span = 6,
  height = 240,
}: {
  data: AnalyticsSalesForecast | null;
  span?: Span;
  height?: number;
}) {
  const f = data?.salesForecast;
  const take = f ? forecastTakeaway(f, fmtPesoCompact, 'expected') : null;
  return (
    <Card
      title="Sales forecast"
      span={span}
      chip="Monthly"
      takeaway={take?.text}
      takeawayTone={take?.tone}
      info={
        f ? (
          <ForecastInfo
            f={f}
            format={fmtPeso}
            what="Income from finished jobs (Completed, For Delivery or Delivered), by the month the job was finished."
          />
        ) : undefined
      }
      onExport={f ? () => exportForecast('sales-forecast', f) : undefined}
    >
      {f ? <ForecastBody f={f} format={fmtPesoCompact} height={height} /> : <CardLoading />}
    </Card>
  );
}

export function DemandForecastCard({
  data,
  span = 6,
  height = 240,
  compact,
}: {
  data: AnalyticsDemandForecast | null;
  span?: Span;
  height?: number;
  compact?: boolean;
}) {
  const [type, setType] = useState<string>('ALL');
  const series: MovingAverageForecast | undefined =
    type === 'ALL' ? data ?? undefined : data?.byJobType.find((t) => t.jobType === type);
  const fmtCount = (v: number | null | undefined) => fmtNum(v, 0);
  const take = series ? forecastTakeaway(series, fmtCount, 'job orders') : null;
  const types = data?.byJobType.filter((t) => t.months.some((m) => (m.actual ?? 0) > 0)) ?? [];
  return (
    <Card
      title="Job order demand"
      span={span}
      chip={compact ? 'Monthly' : undefined}
      takeaway={take?.text}
      takeawayTone={take?.tone}
      controls={
        !compact && types.length > 1 ? (
          <Segmented
            size="small"
            value={type}
            onChange={(v) => setType(String(v))}
            options={[
              { label: 'All', value: 'ALL' },
              ...types.map((t) => ({ label: JOB_TYPE_LABEL[t.jobType] ?? t.jobType, value: t.jobType })),
            ]}
          />
        ) : undefined
      }
      info={
        series ? (
          <ForecastInfo
            f={series}
            format={(v) => fmtNum(v, 1)}
            what="Job orders received per month, by the date they were entered (the client PO date on older records)."
          />
        ) : undefined
      }
      onExport={series ? () => exportForecast(`demand-forecast-${type.toLowerCase()}`, series) : undefined}
    >
      {series ? <ForecastBody f={series} format={fmtCount} height={height} /> : <CardLoading />}
    </Card>
  );
}

// ---------- Stock ----------

export function stockCounts(data: ConsumableRunOut | null) {
  const c = { LIKELY_OUT: 0, REORDER_NOW: 0, REORDER_SOON: 0, OK: 0, NO_DATA: 0 };
  for (const i of data?.items ?? []) {
    const key = (i.status ?? 'NO_DATA') as keyof typeof c;
    if (key in c) c[key] += 1;
    else c.NO_DATA += 1;
  }
  return c;
}

function stockLine(i: ConsumableRunOutRow) {
  if (i.status === 'LIKELY_OUT' || (i.quantityOnHand != null && i.quantityOnHand <= 0 && (i.adu || i.dailyUsage))) {
    return 'Probably out now';
  }
  const parts = [];
  if (i.daysLeft != null) parts.push(`${fmtNum(i.daysLeft, 0)} working days left`);
  if (i.runOutDate) parts.push(`out ${fmtDay(i.runOutDate)}`);
  if (i.orderByDate) parts.push(`order by ${fmtDay(i.orderByDate)}`);
  return parts.join(' · ') || '—';
}

export function StockAlertsCard({ data, span = 6 }: { data: ConsumableRunOut | null; span?: Span }) {
  const alerts = (data?.items ?? []).filter(
    (i) => i.status === 'LIKELY_OUT' || i.status === 'REORDER_NOW' || i.status === 'REORDER_SOON'
  );
  return (
    <Card
      title="Stock alerts"
      span={span}
      chip="Now"
      takeaway={
        data ? (
          alerts.length ? (
            <>
              <strong>{alerts.length}</strong> consumable{alerts.length === 1 ? '' : 's'} to reorder
            </>
          ) : (
            'Nothing to reorder'
          )
        ) : undefined
      }
      takeawayTone={alerts.length ? 'bad' : undefined}
      controls={
        <Link to="/analytics/inventory" className="ana-muted" style={{ fontSize: 12 }}>
          All items
        </Link>
      }
    >
      {!data ? (
        <CardLoading />
      ) : !alerts.length && !data.items.some((i) => i.status === 'OK') ? (
        <ChartEmpty title="No reorder points yet" text="Scan usage builds ADU; then reorder levels appear." height={120} />
      ) : !alerts.length ? (
        <ChartEmpty title="All consumables above their reorder point" height={120} />
      ) : (
        <div className="ana-list">
          {alerts.slice(0, 5).map((i) => (
            <div key={i.toolId} className="ana-list__row">
              <div className="ana-list__main">
                <div className="ana-list__title">
                  {i.name}
                  {i.sizeSpec ? <span className="ana-muted"> · {i.sizeSpec}</span> : null}
                </div>
                <div className="ana-list__sub">{stockLine(i)}</div>
              </div>
              <div className="ana-list__end">
                <StatusPill tone={STOCK_TONE[i.status ?? 'NO_DATA']} compact>
                  {STOCK_LABEL[i.status ?? 'NO_DATA']}
                </StatusPill>
              </div>
            </div>
          ))}
          {alerts.length > 5 ? <div className="ana-list__sub" style={{ paddingTop: 6 }}>+{alerts.length - 5} more</div> : null}
        </div>
      )}
    </Card>
  );
}

// ---------- Suppliers ----------

export const WEIGHT_LABEL: Record<string, string> = {
  onTime: 'On-time delivery rate',
  daysLate: 'Average days late (0 days = full, 7+ = none)',
  leadTime: 'Actual vs stated lead time',
};

export function ScoreInfo({ weights }: { weights?: Record<string, number> }) {
  const w = weights ?? { onTime: 0.5, daysLate: 0.3, leadTime: 0.2 };
  return (
    <div style={{ maxWidth: 320, display: 'grid', gap: 6 }}>
      <div>Score = 100 × weighted sum of three parts, each 0 to 1:</div>
      <table className="ana-table">
        <tbody>
          {Object.entries(w)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <tr key={k}>
                <td>{WEIGHT_LABEL[k] ?? k}</td>
                <td className="num strong">{Math.round(v * 100)}%</td>
              </tr>
            ))}
        </tbody>
      </table>
      <div>Lead-time part = stated ÷ actual days, capped at 1. A missing part passes its weight to the others.</div>
      <div>Grade: A 90+, B 80+, C 70+, D below 70. Needs at least 3 deliveries due in the period.</div>
    </div>
  );
}

export function RingCard({ s, size = 76 }: { s: SupplierReliability; size?: number }) {
  return (
    <div className="ana-ring-card">
      <ScoreRing score={s.score ?? null} grade={s.grade ?? null} size={size} />
      <div style={{ minWidth: 0 }}>
        <div className="ana-ring-card__name">
          {s.supplierName}
          <Grade grade={s.grade ?? null} />
        </div>
        <div className="ana-ring-card__facts">
          <span>
            On time <b>{s.reliabilityPct == null ? '—' : `${Math.round(s.reliabilityPct)}%`}</b>
            <span className="ana-muted"> · {s.dueDeliveries} due</span>
          </span>
          <span>
            Avg late <b>{fmtNum(s.avgDaysLate, 1)} d</b>
          </span>
          <span>
            Lead time{' '}
            <b>
              {s.averageActualLeadDays == null ? '—' : `${fmtNum(s.averageActualLeadDays, 1)} d`}
            </b>
            {s.statedLeadTimeDays != null ? <span className="ana-muted"> vs {s.statedLeadTimeDays} d stated</span> : null}
          </span>
        </div>
      </div>
    </div>
  );
}

export function scoredSuppliers(rows: SupplierReliability[] | null) {
  const list = rows ?? [];
  const scored = list.filter((s) => s.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const unscored = list.filter((s) => s.score == null && s.dueDeliveries > 0);
  return { scored, unscored };
}

// ---------- Open jobs ----------

export const FLAG: Record<string, { label: string; tone: Tone }> = {
  GREEN: { label: 'On track', tone: 'green' },
  AMBER: { label: 'At risk', tone: 'amber' },
  RED: { label: 'Late', tone: 'red' },
};

export function slackText(days: number | null) {
  if (days == null) return '—';
  if (days === 0) return 'due day';
  return days > 0 ? `${days} d spare` : `${Math.abs(days)} d late`;
}

export function finishOf(j: CompletionEstimateJob) {
  const a = j.predictedFinish;
  const b = j.scheduledFinish;
  if (a && b) return a > b ? a : b;
  return a ?? b;
}
