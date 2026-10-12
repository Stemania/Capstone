import StatusPill from '../../components/StatusPill';
import { PageSkeleton } from '../../components/ui';
import { exportCsv } from '../../utils/csvExport';
import { fmtDay, fmtNum } from './format';
import { Card, ChartEmpty, Grid, Kpi, Kpis, STOCK_LABEL, STOCK_TONE, StockBar } from './kit';
import { stockCounts } from './cards';
import { useConsumables } from './sources';

const LEAD_SOURCE: Record<string, string> = {
  MEASURED: 'measured from past restocks',
  SUPPLIER: "supplier's stated lead time",
  DEFAULT: 'default',
};

export default function AnalyticsInventoryPage() {
  const data = useConsumables().data;

  if (!data) return <PageSkeleton variant="cards" />;

  const counts = stockCounts(data);
  const alerts = counts.LIKELY_OUT + counts.REORDER_NOW;
  const items = data.items;

  return (
    <div>
      <Kpis>
        <Kpi label="Likely out" value={fmtNum(counts.LIKELY_OUT)} valueTone={counts.LIKELY_OUT ? 'red' : undefined} />
        <Kpi label="Reorder now" value={fmtNum(counts.REORDER_NOW)} valueTone={counts.REORDER_NOW ? 'amber' : undefined} />
        <Kpi label="OK" value={fmtNum(counts.OK)} valueTone={counts.OK ? 'green' : undefined} />
        <Kpi label="No usage yet" value={fmtNum(counts.NO_DATA)} sub="fewer than 2 stocktakes" />
      </Kpis>

      <Grid>
        <Card
          title="Consumables"
          span={12}
          chip={`As of ${fmtDay(data.today)}`}
          takeaway={
            alerts ? (
              <>
                <strong>{alerts}</strong> of {data.items.length} at or below their reorder point
              </>
            ) : counts.OK ? (
              `All ${counts.OK} with a reorder point are above it${
                counts.NO_DATA ? ` · ${counts.NO_DATA} with no usage yet` : ''
              }`
            ) : items.length ? (
              'No reorder points yet: each item needs 2 stocktakes'
            ) : undefined
          }
          takeawayTone={alerts ? 'bad' : undefined}
          info={
            <div style={{ maxWidth: 360, display: 'grid', gap: 6 }}>
              <div>
                Daily use = average of the last 3 stocktake periods (previous count + deliveries − count, per shop
                day).
              </div>
              <div>On hand today = last count + deliveries since − daily use × shop days since.</div>
              <div>Days left = on hand ÷ daily use, counted on the shop calendar to the run-out date.</div>
              <div>
                Reorder point = daily use × lead time + safety stock. Safety stock = 1.65 × spread of daily use × √lead
                time ({data.serviceLevelPct ?? 95}% service level). Lead time is measured from past restocks, else the
                supplier's stated time, else {data.defaultLeadTimeDays ?? 7} days.
              </div>
              <div>The bar is stock on hand; the tick marks the reorder point.</div>
            </div>
          }
          onExport={() =>
            exportCsv(`consumables-${data.today}`, data.items, [
              { key: 'n', header: 'Item', value: (r) => r.name },
              { key: 'c', header: 'Code', value: (r) => r.code },
              { key: 's', header: 'Size', value: (r) => r.sizeSpec ?? '' },
              { key: 'u', header: 'Unit', value: (r) => r.unit },
              { key: 'o', header: 'On hand (est.)', value: (r) => r.estimatedOnHand ?? '' },
              { key: 'd', header: 'Daily use', value: (r) => r.dailyUsage ?? '' },
              { key: 'l', header: 'Days left', value: (r) => r.daysLeft ?? '' },
              { key: 'r', header: 'Run-out date', value: (r) => r.runOutDate ?? '' },
              { key: 'lt', header: 'Lead time days', value: (r) => r.leadTimeDays ?? '' },
              { key: 'ls', header: 'Lead time source', value: (r) => r.leadTimeSource ?? '' },
              { key: 'ss', header: 'Safety stock', value: (r) => r.safetyStock ?? '' },
              { key: 'rop', header: 'Reorder point', value: (r) => r.reorderPoint ?? '' },
              { key: 'st', header: 'Status', value: (r) => STOCK_LABEL[r.status ?? 'NO_DATA'] },
            ])
          }
        >
          {!items.length ? (
            <ChartEmpty title="No consumables yet" />
          ) : (
            <div className="ana-table__wrap">
              <table className="ana-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style={{ width: '22%' }}>Stock</th>
                    <th className="num">On hand</th>
                    <th className="num">Daily use</th>
                    <th className="num">Days left</th>
                    <th>Runs out</th>
                    <th className="num">Reorder at</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.toolId}>
                      <td className="strong">
                        {i.name}
                        {i.sizeSpec ? <span className="ana-muted" style={{ fontWeight: 400 }}> · {i.sizeSpec}</span> : null}
                      </td>
                      <td>
                        {i.status === 'NO_DATA' || !i.status ? (
                          <span className="ana-muted">—</span>
                        ) : (
                          <StockBar onHand={i.estimatedOnHand} reorderPoint={i.reorderPoint ?? null} status={i.status} />
                        )}
                      </td>
                      <td className="num">
                        {i.estimatedOnHand == null ? fmtNum(i.quantityOnHand) : fmtNum(i.estimatedOnHand)}{' '}
                        <span className="ana-muted">{i.unit}</span>
                      </td>
                      <td className="num">{i.dailyUsage == null ? '—' : fmtNum(i.dailyUsage, 2)}</td>
                      <td className="num">{i.daysLeft == null ? '—' : fmtNum(i.daysLeft)}</td>
                      <td>{i.likelyOut ? 'Now' : fmtDay(i.runOutDate)}</td>
                      <td
                        className="num"
                        title={
                          i.reorderPoint != null
                            ? `${fmtNum(i.leadTimeDays, 0)}-day lead time (${LEAD_SOURCE[i.leadTimeSource ?? 'DEFAULT']}) + ${fmtNum(
                                i.safetyStock,
                                1
                              )} safety stock`
                            : undefined
                        }
                      >
                        {i.reorderPoint == null ? '—' : fmtNum(i.reorderPoint)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <StatusPill tone={STOCK_TONE[i.status ?? 'NO_DATA']} compact>
                          {STOCK_LABEL[i.status ?? 'NO_DATA']}
                        </StatusPill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Grid>
    </div>
  );
}
