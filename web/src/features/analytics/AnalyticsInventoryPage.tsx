import { useMemo, useState } from 'react';
import { Select } from 'antd';
import StatusPill from '../../components/StatusPill';
import { PageSkeleton } from '../../components/ui';
import { exportCsv } from '../../utils/csvExport';
import type { ConsumableAbcClass, ConsumableRunOutRow } from '../../types';
import { fmtDay, fmtNum } from './format';
import { Card, ChartEmpty, Grid, Kpi, Kpis, STOCK_LABEL, STOCK_TONE, StockBar } from './kit';
import { stockCounts } from './cards';
import { useConsumables } from './sources';

const LEAD_SOURCE: Record<string, string> = {
  MEASURED: 'measured from past restocks',
  SUPPLIER: "supplier's stated lead time",
  DEFAULT: 'default',
};

const ABC_OPTIONS: { value: ConsumableAbcClass | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All ABC' },
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
];

function aduOf(i: ConsumableRunOutRow) {
  return i.adu ?? i.dailyUsage ?? null;
}

function ropOf(i: ConsumableRunOutRow) {
  return i.reorderLevel ?? i.reorderPoint ?? null;
}

export default function AnalyticsInventoryPage() {
  const data = useConsumables().data;
  const [abcFilter, setAbcFilter] = useState<ConsumableAbcClass | 'ALL'>('ALL');

  const counts = stockCounts(data);
  const alerts = counts.LIKELY_OUT + counts.REORDER_NOW + counts.REORDER_SOON;
  const items = useMemo(() => {
    const all = data?.items ?? [];
    if (abcFilter === 'ALL') return all;
    return all.filter((i) => i.abcClass === abcFilter);
  }, [data, abcFilter]);

  if (!data) return <PageSkeleton variant="cards" />;

  const howComputed = data.description;
  const formulas = data.formulas
    ? Object.entries(data.formulas)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
    : null;

  return (
    <div>
      <Kpis>
        <Kpi
          label="Reorder now"
          value={fmtNum(counts.REORDER_NOW + counts.LIKELY_OUT)}
          valueTone={counts.REORDER_NOW + counts.LIKELY_OUT ? 'red' : undefined}
        />
        <Kpi
          label="Reorder soon"
          value={fmtNum(counts.REORDER_SOON)}
          valueTone={counts.REORDER_SOON ? 'amber' : undefined}
        />
        <Kpi label="OK" value={fmtNum(counts.OK)} valueTone={counts.OK ? 'green' : undefined} />
        <Kpi label="No data yet" value={fmtNum(counts.NO_DATA)} sub="needs scan history" />
      </Kpis>

      <Grid>
        <Card
          title="Consumables"
          span={12}
          chip={`As of ${fmtDay(data.today)}`}
          takeaway={
            alerts ? (
              <>
                <strong>{alerts}</strong> of {data.items.length} at or near reorder level
              </>
            ) : counts.OK ? (
              `All ${counts.OK} with a reorder level are above it${
                counts.NO_DATA ? ` · ${counts.NO_DATA} with no scan data yet` : ''
              }`
            ) : items.length || data.items.length ? (
              'No reorder levels yet: scan usage builds average daily use (ADU)'
            ) : undefined
          }
          takeawayTone={alerts ? 'bad' : undefined}
          controls={
            <Select
              size="small"
              value={abcFilter}
              onChange={setAbcFilter}
              options={ABC_OPTIONS}
              style={{ width: 110 }}
              aria-label="Filter by ABC class"
            />
          }
          info={
            <div style={{ maxWidth: 400, display: 'grid', gap: 6 }}>
              <div style={{ fontWeight: 600 }}>How this is computed</div>
              <div>{howComputed}</div>
              {formulas ? (
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 11, opacity: 0.85 }}>
                  {formulas}
                </pre>
              ) : null}
              <div>The bar is stock on hand; the tick marks the reorder level (ROP).</div>
            </div>
          }
          onExport={() =>
            exportCsv(`consumables-${data.today}`, items, [
              { key: 'n', header: 'Item', value: (r) => r.name },
              { key: 'c', header: 'Code', value: (r) => r.code },
              { key: 's', header: 'Size', value: (r) => r.sizeSpec ?? '' },
              { key: 'u', header: 'Unit', value: (r) => r.unit },
              { key: 'o', header: 'On hand', value: (r) => r.estimatedOnHand ?? r.quantityOnHand ?? '' },
              { key: 'adu', header: 'ADU', value: (r) => aduOf(r) ?? '' },
              { key: 'rop', header: 'ROP', value: (r) => ropOf(r) ?? '' },
              { key: 'd', header: 'Days left', value: (r) => r.daysLeft ?? '' },
              { key: 'r', header: 'Run-out date', value: (r) => r.runOutDate ?? '' },
              { key: 'ob', header: 'Order by', value: (r) => r.orderByDate ?? '' },
              { key: 'sq', header: 'Suggested qty', value: (r) => r.suggestedOrderQty ?? '' },
              { key: 'lb', header: 'Label', value: (r) => r.label ?? '' },
              { key: 'st', header: 'Status', value: (r) => STOCK_LABEL[r.status ?? 'NO_DATA'] },
              { key: 'abc', header: 'ABC', value: (r) => r.abcClass ?? '' },
            ])
          }
        >
          {!items.length ? (
            <ChartEmpty
              title={abcFilter === 'ALL' ? 'No consumables yet' : `No class ${abcFilter} items`}
            />
          ) : (
            <div className="ana-table__wrap">
              <table className="ana-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style={{ width: '14%' }}>Stock</th>
                    <th className="num">On hand</th>
                    <th className="num">ADU</th>
                    <th className="num">ROP</th>
                    <th className="num">Days left</th>
                    <th>Run-out</th>
                    <th>Order by</th>
                    <th className="num">Sug. qty</th>
                    <th>Label</th>
                    <th>ABC</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const onHand = i.estimatedOnHand ?? i.quantityOnHand;
                    const adu = aduOf(i);
                    const rop = ropOf(i);
                    return (
                      <tr key={i.toolId}>
                        <td className="strong">
                          {i.name}
                          {i.sizeSpec ? (
                            <span className="ana-muted" style={{ fontWeight: 400 }}>
                              {' '}
                              · {i.sizeSpec}
                            </span>
                          ) : null}
                          {i.unitNeedsReview ? (
                            <div className="ana-muted" style={{ fontWeight: 400, fontSize: 11 }}>
                              Unit needs review{i.legacyUnit ? ` (was ${i.legacyUnit})` : ''}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {i.status === 'NO_DATA' || !i.status ? (
                            <span className="ana-muted">—</span>
                          ) : (
                            <StockBar onHand={onHand ?? null} reorderPoint={rop} status={i.status} />
                          )}
                        </td>
                        <td className="num">
                          {fmtNum(onHand)} <span className="ana-muted">{i.unit}</span>
                        </td>
                        <td className="num">{adu == null ? '—' : fmtNum(adu, 2)}</td>
                        <td
                          className="num"
                          title={
                            rop != null
                              ? `Lead ${(i.leadTimeWorkingDaysAvg ?? i.leadTimeDays) ?? '—'} wd (${LEAD_SOURCE[i.leadTimeSource ?? 'DEFAULT']}) + ${fmtNum(i.safetyStock, 1)} safety`
                              : undefined
                          }
                        >
                          {rop == null ? '—' : fmtNum(rop)}
                        </td>
                        <td className="num">{i.daysLeft == null ? '—' : fmtNum(i.daysLeft)}</td>
                        <td>{i.likelyOut ? 'Now' : fmtDay(i.runOutDate)}</td>
                        <td>{fmtDay(i.orderByDate)}</td>
                        <td className="num">
                          {i.suggestedOrderQty == null || i.suggestedOrderQty <= 0
                            ? '—'
                            : fmtNum(i.suggestedOrderQty)}
                        </td>
                        <td>
                          <span className="ana-muted">{i.label || '—'}</span>
                        </td>
                        <td>{i.abcClass || '—'}</td>
                        <td style={{ textAlign: 'right' }}>
                          <StatusPill tone={STOCK_TONE[i.status ?? 'NO_DATA']} compact>
                            {STOCK_LABEL[i.status ?? 'NO_DATA']}
                          </StatusPill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Grid>
    </div>
  );
}
