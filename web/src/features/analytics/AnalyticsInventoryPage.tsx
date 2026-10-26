import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import StatusPill from '../../components/StatusPill';
import { PageSkeleton, TabBar } from '../../components/ui';
import { tones } from '../../theme/tokens';
import { exportCsv } from '../../utils/csvExport';
import type { ConsumableRunOutRow } from '../../types';
import { fmtDay, fmtMonth, fmtNum, fmtPeso, fmtPesoCompact } from './format';
import {
  Card,
  ChartEmpty,
  Grid,
  Kpi,
  Kpis,
  LineTrend,
  PALETTE,
  ParetoChart,
  SortedBars,
  STOCK_LABEL,
  STOCK_TONE,
  StockBar,
  type BarRow,
  type ParetoRow,
} from './kit';
import { stockCounts } from './cards';
import { useConsumables, useInventory, usePeriods } from './sources';

const NEEDS_ORDER = new Set(['LIKELY_OUT', 'REORDER_NOW', 'REORDER_SOON']);
const STATUS_ORDER = ['LIKELY_OUT', 'REORDER_NOW', 'REORDER_SOON', 'OK', 'NO_DATA'] as const;
const LIST_LIMIT = 8;
const COVER_LIMIT = 10;
const PARETO_LIMIT = 12;

const LEAD_SOURCE: Record<string, string> = {
  MEASURED: 'measured from past restocks',
  SUPPLIER: "supplier's stated lead time",
  DEFAULT: 'default',
};

const aduOf = (i: ConsumableRunOutRow) => i.adu ?? i.dailyUsage ?? null;
const ropOf = (i: ConsumableRunOutRow) => i.reorderLevel ?? i.reorderPoint ?? null;
const leadOf = (i: ConsumableRunOutRow) => i.leadTimeWorkingDaysAvg ?? i.leadTimeDays ?? null;
const itemName = (name: string, size?: string | null) => (size ? `${name} · ${size}` : name);
const statusColor = (status?: string | null) =>
  status === 'REORDER_NOW' || status === 'LIKELY_OUT'
    ? tones.red.solid
    : tones[STOCK_TONE[status ?? 'NO_DATA'] ?? 'grey'].solid;
const lines = (n: number) => `${fmtNum(n)} line${n === 1 ? '' : 's'}`;

type InvView = 'consumables' | 'materials';

export default function AnalyticsInventoryPage() {
  const { period } = usePeriods();
  const [params, setParams] = useSearchParams();
  const view: InvView = params.get('view') === 'materials' ? 'materials' : 'consumables';
  const setView = (next: InvView) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next === 'consumables') out.delete('view');
        else out.set('view', next);
        return out;
      },
      { replace: true },
    );
  const stock = useConsumables().data;
  const inv = useInventory(period).data;

  const counts = stockCounts(stock);
  const items = useMemo(() => stock?.items ?? [], [stock]);

  // Lowest days of cover first; the tick is the lead time, so a bar shorter
  // than its tick runs out before a new order would arrive.
  const coverRows: BarRow[] = useMemo(
    () =>
      items
        .filter((i) => i.daysLeft != null && i.status && i.status !== 'NO_DATA')
        .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
        .slice(0, COVER_LIMIT)
        .map((i) => ({
          key: i.toolId,
          label: itemName(i.name, i.sizeSpec),
          value: Math.max(i.daysLeft ?? 0, 0),
          display: `${fmtNum(i.daysLeft)} d`,
          color: statusColor(i.status),
          marker: leadOf(i),
          title: `${STOCK_LABEL[i.status ?? 'NO_DATA']} · lead time ${fmtNum(leadOf(i))} working days`,
        })),
    [items],
  );

  const pareto = useMemo(() => {
    const ranked = items
      .filter((i) => (i.usageValue90d ?? 0) > 0)
      .sort((a, b) => (b.usageValue90d ?? 0) - (a.usageValue90d ?? 0));
    const total = ranked.reduce((s, i) => s + (i.usageValue90d ?? 0), 0);
    let cum = 0;
    const rows: ParetoRow[] = ranked.slice(0, PARETO_LIMIT).map((i) => {
      cum += i.usageValue90d ?? 0;
      return {
        label: i.name,
        hours: i.usageValue90d ?? 0,
        shareOfTotalPct: total ? ((i.usageValue90d ?? 0) / total) * 100 : 0,
        cumulativePct: total ? (cum / total) * 100 : 0,
      };
    });
    const classA = ranked.filter((i) => i.abcClass === 'A').length;
    return { rows, total, classA, count: ranked.length };
  }, [items]);

  const needsOrder = useMemo(
    () =>
      items
        .filter((i) => NEEDS_ORDER.has(i.status ?? ''))
        .sort((a, b) => (a.daysLeft ?? -1) - (b.daysLeft ?? -1)),
    [items],
  );

  if (!stock || !inv) return <PageSkeleton variant="cards" />;

  const mats = inv.materials;
  const cons = inv.consumables;
  const stockValue = items.reduce(
    (s, i) => s + Math.max(i.estimatedOnHand ?? i.quantityOnHand ?? 0, 0) * (i.unitCost ?? 0),
    0,
  );
  const reorderNow = counts.REORDER_NOW + counts.LIKELY_OUT;
  const monthRows = inv.months.map((m) => ({
    label: fmtMonth(m.month),
    use: m.consumableUseValue,
    received: m.materialReceivedValue,
    consumed: m.materialConsumedValue,
  }));
  const statusRows: BarRow[] = STATUS_ORDER.filter((k) => counts[k] > 0).map((k) => ({
    key: k,
    label: STOCK_LABEL[k],
    value: counts[k],
    color: statusColor(k),
  }));
  const topUse: BarRow[] = cons.topByValue.map((r) => ({
    key: r.toolId,
    label: itemName(r.name, r.sizeSpec),
    value: r.value,
    display: fmtPesoCompact(r.value),
    sub: `${fmtNum(r.quantity)} ${r.unit}`,
  }));
  const ageRows: BarRow[] = mats.ageBuckets.map((b, idx) => ({
    key: b.key,
    label: b.label,
    value: b.value,
    display: fmtPesoCompact(b.value),
    sub: `${b.lines} line${b.lines === 1 ? '' : 's'}`,
    color: [PALETTE.good, PALETTE.primary, PALETTE.warn, PALETTE.bad][idx],
  }));
  const oldAge = mats.ageBuckets.filter((b) => b.key === '15-30' || b.key === '31+');
  const oldLines = oldAge.reduce((s, b) => s + b.lines, 0);
  const oldValue = oldAge.reduce((s, b) => s + b.value, 0);

  const materialsGrid = (
      <Grid>
        <Card
          title="Stock movement"
          span={7}
          takeaway={`${fmtPesoCompact(mats.receivedValue)} received · ${fmtPesoCompact(mats.consumedValue)} used by jobs in this period`}
          info={
            <div style={{ maxWidth: 360 }}>
              Received: job-material lines delivered in the month. Used: lines taken from stock
              when their job's first operation started. Value = quantity × PO unit cost.
            </div>
          }
        >
          {mats.receivedValue || mats.consumedValue ? (
            <LineTrend
              rows={monthRows}
              series={[
                { key: 'received', label: 'Received (₱)', color: PALETTE.primary },
                { key: 'consumed', label: 'Used by jobs (₱)', color: PALETTE.second },
              ]}
              yFormat={(v) => fmtPesoCompact(v)}
              tipFormat={(_k, v) => fmtPeso(v)}
              height={220}
            />
          ) : (
            <ChartEmpty title="No material moved in this period" />
          )}
        </Card>

        <Card
          title="Time in stock"
          span={5}
          takeaway={
            mats.avgDaysInStock != null
              ? `Materials waited ${fmtNum(mats.avgDaysInStock, 1)} days on average before their job started (${mats.daysInStockSamples} lines)`
              : 'No material was used in this period'
          }
          takeawayTone={oldLines ? 'bad' : undefined}
          info={
            <div style={{ maxWidth: 340 }}>
              Bars: what is in stock now, by days since it was received. Material waiting more than
              two weeks ties up money and floor space; check whether its job can start.
            </div>
          }
        >
          {mats.onHandLines ? (
            <SortedBars rows={ageRows} sort={false} />
          ) : (
            <ChartEmpty title="No job material in stock" />
          )}
        </Card>

        <Card
          title="Waiting longest"
          span={12}
          takeaway={
            mats.oldestOnHand.length
              ? `${mats.onHandLines} line${mats.onHandLines === 1 ? '' : 's'} in stock · the ${mats.oldestOnHand.length} received longest ago`
              : undefined
          }
          controls={
            <Link to="/tools?tab=raw-materials" className="ana-muted" style={{ fontSize: 12 }}>
              All raw materials
            </Link>
          }
        >
          {mats.oldestOnHand.length ? (
            <div className="ana-table__wrap">
              <table className="ana-table">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>For job</th>
                    <th className="num">Qty</th>
                    <th>Received</th>
                    <th className="num">Days in stock</th>
                    <th className="num">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {mats.oldestOnHand.map((r) => (
                    <tr key={r.id}>
                      <td className="strong">
                        {r.materialName}
                        {[r.gradeOrSpec, r.sizeSpec].filter(Boolean).length ? (
                          <span className="ana-muted" style={{ fontWeight: 400 }}>
                            {' '}
                            · {[...new Set([r.gradeOrSpec, r.sizeSpec].filter(Boolean))].join(' · ')}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {r.jobOrderId ? <Link to={`/job-orders/${r.jobOrderId}`}>{r.jobNumber}</Link> : '—'}
                      </td>
                      <td className="num">
                        {fmtNum(r.quantity)} <span className="ana-muted">{r.unit}</span>
                      </td>
                      <td>{fmtDay(r.dateReceived)}</td>
                      <td className="num" style={r.daysInStock > 14 ? { color: tones.red.fg, fontWeight: 600 } : undefined}>
                        {fmtNum(r.daysInStock)}
                      </td>
                      <td className="num">{fmtPeso(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ChartEmpty title="No job material in stock" />
          )}
        </Card>
      </Grid>
  );

  const switcher = (
    <div className="ana-inv__switch">
      <TabBar<InvView>
        value={view}
        onChange={setView}
        items={[
          { value: 'consumables', label: 'Consumables', count: reorderNow || null, countTone: 'red' },
          { value: 'materials', label: 'Job materials', count: mats.onHandLines || null },
        ]}
      />
      <span className="ana-inv__switch-sub">
        {view === 'consumables'
          ? `Stock as of ${fmtDay(stock.today)} · consumable stock worth about ${fmtPesoCompact(stockValue)}`
          : 'Raw materials bought for job orders: in stock from receipt until their job starts'}
      </span>
    </div>
  );

  if (view === 'materials') {
    return (
      <div className="ana-inv">
        {switcher}
        <Kpis>
          <Kpi
            label="Materials in stock"
            value={fmtPesoCompact(mats.onHandValue)}
            sub={`${lines(mats.onHandLines)} waiting for their jobs`}
          />
          <Kpi
            label="Materials on order"
            value={fmtPesoCompact(mats.incomingValue)}
            valueTone={mats.incomingOverdueLines ? 'amber' : undefined}
            sub={
              mats.incomingOverdueLines
                ? `${lines(mats.incomingLines)} · ${fmtNum(mats.incomingOverdueLines)} overdue`
                : lines(mats.incomingLines)
            }
          />
          <Kpi
            label="Received in this period"
            value={fmtPesoCompact(mats.receivedValue)}
            sub={`${fmtPesoCompact(mats.consumedValue)} used by jobs`}
          />
          <Kpi
            label="In stock over 2 weeks"
            value={fmtPesoCompact(oldValue)}
            valueTone={oldLines ? 'amber' : 'green'}
            sub={`${lines(oldLines)} of ${lines(mats.onHandLines)} in stock`}
          />
        </Kpis>
        {materialsGrid}
      </div>
    );
  }

  return (
    <div className="ana-inv">
      {switcher}
      <Kpis>
        <Kpi
          label="Consumables to reorder"
          value={fmtNum(reorderNow)}
          valueTone={reorderNow ? 'red' : 'green'}
          sub={`${fmtNum(counts.REORDER_SOON)} more soon · ${fmtNum(items.length)} items`}
        />
        <Kpi
          label="Consumables used"
          value={fmtPesoCompact(cons.useValue)}
          sub={`${fmtNum(cons.useQty)} scans · ${fmtNum(cons.itemsUsed)} items`}
        />
        <Kpi
          label="Stock on hand"
          value={fmtPesoCompact(stockValue)}
          sub={`${fmtNum(items.length)} consumables in the catalog`}
        />
        <Kpi
          label="Class A items"
          value={fmtNum(pareto.classA)}
          sub="80% of the usage value · last 90 days"
        />
      </Kpis>
      <Grid>
        <Card
          title="Days of cover"
          span={7}
          takeaway={
            coverRows.length
              ? `Lowest ${coverRows.length}: a bar shorter than its tick runs out before a new order arrives`
              : undefined
          }
          info={
            <div style={{ maxWidth: 360 }}>
              Working days the stock on hand lasts at the average daily use (ADU). The dark tick is
              the supplier lead time in working days. Colour follows the stock status.
            </div>
          }
        >
          {coverRows.length ? (
            <SortedBars rows={coverRows} sort={false} />
          ) : (
            <ChartEmpty title="No usage yet" text="Days of cover appear once consumables are scanned." />
          )}
        </Card>

        <Card title="Stock status" span={5} takeaway={`${fmtNum(items.length)} consumables in the catalog`}>
          {statusRows.length ? <SortedBars rows={statusRows} sort={false} /> : <ChartEmpty title="No consumables yet" />}
        </Card>

        <Card
          title="Usage value · last 90 days"
          span={12}
          chip="ABC"
          takeaway={
            pareto.count
              ? `${pareto.classA} of ${pareto.count} items (class A) make up 80% of the ${fmtPesoCompact(pareto.total)} used; watch these first`
              : undefined
          }
          info={
            <div style={{ maxWidth: 380 }}>
              Scans in the last 90 days × unit cost, largest first, with the running share of the
              total. ABC: A = items up to 80% of the value, B = the next 15%, C = the rest.
            </div>
          }
        >
          {pareto.rows.length ? (
            <ParetoChart
              rows={pareto.rows}
              vitalFew={Math.min(pareto.classA, pareto.rows.length)}
              valueLabel="Usage value"
              vitalLabel="class A"
              valueFormat={(v) => fmtPeso(v)}
              height={260}
            />
          ) : (
            <ChartEmpty title="No scans in the last 90 days" />
          )}
        </Card>

        <Card
          title="Used per month"
          span={6}
          takeaway={`${fmtPesoCompact(cons.useValue)} of consumables scanned in this period`}
        >
          {cons.useQty ? (
            <LineTrend
              rows={monthRows}
              series={[{ key: 'use', label: 'Consumables used (₱)', color: PALETTE.primary }]}
              yFormat={(v) => fmtPesoCompact(v)}
              tipFormat={(_k, v) => fmtPeso(v)}
              height={220}
            />
          ) : (
            <ChartEmpty title="No scans in this period" />
          )}
        </Card>

        <Card title="Most used" span={6} takeaway="By value in this period">
          {topUse.length ? <SortedBars rows={topUse} sort={false} /> : <ChartEmpty title="No scans in this period" />}
        </Card>

        <Card
          title="To order"
          span={12}
          takeaway={
            needsOrder.length
              ? `${needsOrder.length} at or near the reorder level${
                  needsOrder.length > LIST_LIMIT ? ` · showing the ${LIST_LIMIT} that run out first` : ''
                }`
              : 'Nothing at or near its reorder level'
          }
          takeawayTone={needsOrder.length ? 'bad' : 'good'}
          controls={
            <Link to="/tools?tab=consumables" className="ana-muted" style={{ fontSize: 12 }}>
              All consumables
            </Link>
          }
          info={
            <div style={{ maxWidth: 400, display: 'grid', gap: 6 }}>
              <div>{stock.description}</div>
              <div>The bar is stock on hand; the tick marks the reorder level (ROP).</div>
            </div>
          }
          onExport={() =>
            exportCsv(`consumables-${stock.today}`, items, [
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
              { key: 'st', header: 'Status', value: (r) => STOCK_LABEL[r.status ?? 'NO_DATA'] },
              { key: 'abc', header: 'ABC', value: (r) => r.abcClass ?? '' },
            ])
          }
        >
          {needsOrder.length ? (
            <div className="ana-table__wrap">
              <table className="ana-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style={{ width: '16%' }}>Stock</th>
                    <th className="num">On hand</th>
                    <th className="num">ROP</th>
                    <th className="num">Days left</th>
                    <th>Order by</th>
                    <th className="num">Order qty</th>
                    <th>ABC</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {needsOrder.slice(0, LIST_LIMIT).map((i) => {
                    const onHand = i.estimatedOnHand ?? i.quantityOnHand;
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
                        </td>
                        <td>
                          <StockBar onHand={onHand ?? null} reorderPoint={rop} status={i.status ?? 'NO_DATA'} />
                        </td>
                        <td className="num">
                          {fmtNum(onHand)} <span className="ana-muted">{i.unit}</span>
                        </td>
                        <td
                          className="num"
                          title={
                            rop != null
                              ? `ADU ${fmtNum(aduOf(i), 2)} · lead ${fmtNum(leadOf(i))} wd (${LEAD_SOURCE[i.leadTimeSource ?? 'DEFAULT']}) + ${fmtNum(i.safetyStock, 1)} safety`
                              : undefined
                          }
                        >
                          {rop == null ? '—' : fmtNum(rop)}
                        </td>
                        <td className="num">{i.likelyOut ? 'Out' : fmtNum(i.daysLeft)}</td>
                        <td>{fmtDay(i.orderByDate)}</td>
                        <td className="num">
                          {i.suggestedOrderQty == null || i.suggestedOrderQty <= 0 ? '—' : fmtNum(i.suggestedOrderQty)}
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
          ) : (
            <ChartEmpty title="Nothing to order" text="Every consumable with usage data is above its reorder level." />
          )}
        </Card>
      </Grid>

    </div>
  );
}
