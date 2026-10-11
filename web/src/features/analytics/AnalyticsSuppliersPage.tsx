import { PageSkeleton } from '../../components/ui';
import { exportCsv } from '../../utils/csvExport';
import { fmtNum, fmtPeso, fmtPesoCompact, pctChange } from './format';
import { Card, ChartEmpty, Grid, Kpi, Kpis, PALETTE, SortedBars } from './kit';
import { CardLoading, RingCard, ScoreInfo, scoredSuppliers } from './cards';
import { usePeriods, usePurchasing, useReliability } from './sources';

export default function AnalyticsSuppliersPage() {
  const { period, previous } = usePeriods();
  const purchasing = usePurchasing(period).data;
  const prev = usePurchasing(previous).data;
  const reliability = useReliability(period).data;

  if (!purchasing) return <PageSkeleton variant="cards" />;

  const { scored, unscored } = scoredSuppliers(reliability);
  const avgScore = scored.length ? scored.reduce((s, r) => s + (r.score ?? 0), 0) / scored.length : null;
  const lead = purchasing.supplierLeadTime.filter((r) => r.averageActualDays != null);
  const spend = purchasing.spendBySupplier.filter((r) => (r.totalSpend ?? 0) > 0);
  const materials = purchasing.materialsBySpend.filter((r) => (r.totalSpend ?? 0) > 0);
  const slowest = [...lead].sort((a, b) => (b.varianceDays ?? 0) - (a.varianceDays ?? 0))[0];
  const topSpend = [...spend].sort((a, b) => (b.totalSpend ?? 0) - (a.totalSpend ?? 0))[0];

  return (
    <div>
      <Kpis>
        <Kpi
          label="Purchase lines"
          value={fmtNum(purchasing.purchaseCount)}
          delta={prev ? pctChange(purchasing.purchaseCount, prev.purchaseCount) : undefined}
          better="none"
        />
        <Kpi
          label="Spend"
          value={fmtPesoCompact(purchasing.totalSpend)}
          delta={prev ? pctChange(purchasing.totalSpend, prev.totalSpend) : undefined}
          better="none"
        />
        <Kpi
          label="Suppliers scored"
          value={fmtNum(scored.length)}
          sub={unscored.length ? `${unscored.length} with too few deliveries` : undefined}
        />
        <Kpi label="Avg score" value={avgScore == null ? '—' : fmtNum(avgScore)} info={<ScoreInfo />} />
      </Kpis>

      <Grid>
        <Card
          title="Supplier reliability"
          span={12}
          takeaway={
            scored[0] ? (
              <>
                Most reliable: <strong>{scored[0].supplierName}</strong> · {Math.round(scored[0].score ?? 0)}
              </>
            ) : reliability ? (
              'Not enough deliveries in this period to score'
            ) : undefined
          }
          info={<ScoreInfo weights={scored[0]?.scoreWeights} />}
          onExport={
            reliability
              ? () =>
                  exportCsv('supplier-reliability', reliability, [
                    { key: 's', header: 'Supplier', value: (r) => r.supplierName },
                    { key: 'd', header: 'Deliveries due', value: (r) => r.dueDeliveries },
                    { key: 'o', header: 'On time', value: (r) => r.onTimeDeliveries },
                    { key: 'p', header: 'On-time %', value: (r) => r.reliabilityPct ?? '' },
                    { key: 'l', header: 'Avg days late', value: (r) => r.avgDaysLate },
                    { key: 'st', header: 'Stated lead days', value: (r) => r.statedLeadTimeDays ?? '' },
                    { key: 'al', header: 'Actual lead days', value: (r) => r.averageActualLeadDays ?? '' },
                    { key: 'sc', header: 'Score', value: (r) => r.score ?? '' },
                    { key: 'g', header: 'Grade', value: (r) => r.grade ?? r.label },
                  ])
              : undefined
          }
          foot={
            unscored.length ? (
              <>
                Not enough deliveries: {unscored.map((s) => `${s.supplierName} (${s.dueDeliveries})`).join(', ')}
              </>
            ) : undefined
          }
        >
          {!reliability ? (
            <CardLoading />
          ) : scored.length ? (
            <div className="ana-rings">
              {scored.map((s) => (
                <RingCard key={s.supplierId} s={s} />
              ))}
            </div>
          ) : (
            <ChartEmpty title="Not enough deliveries" text="A score needs at least 3 deliveries due in the period." />
          )}
        </Card>

        <Card
          title="Lead time: actual vs stated"
          span={4}
          takeaway={
            slowest && (slowest.varianceDays ?? 0) > 0 ? (
              <>
                <strong>{slowest.supplierName}</strong> takes {fmtNum(slowest.varianceDays, 1)} d longer than stated
              </>
            ) : lead.length ? (
              'All within their stated lead time'
            ) : (
              'No received orders yet'
            )
          }
          info="Bar: average days from order to receipt. Dark tick: the supplier's stated lead time."
        >
          {lead.length ? (
            <SortedBars
              rows={lead.map((r) => ({
                key: r.supplierId,
                label: r.supplierName ?? '—',
                value: r.averageActualDays ?? 0,
                display: `${fmtNum(r.averageActualDays, 1)} d`,
                sub: r.statedLeadTimeDays != null ? `vs ${r.statedLeadTimeDays}` : undefined,
                marker: r.statedLeadTimeDays,
                color: (r.varianceDays ?? 0) > 0 ? PALETTE.warn : PALETTE.second,
                title: `${r.sampleCount} received order${r.sampleCount === 1 ? '' : 's'}`,
              }))}
            />
          ) : (
            <ChartEmpty title="No received orders in this period" />
          )}
        </Card>

        <Card
          title="Spend by supplier"
          span={4}
          takeaway={
            topSpend ? (
              <>
                <strong>{topSpend.supplierName}</strong> ·{' '}
                {fmtNum(((topSpend.totalSpend ?? 0) / (purchasing.totalSpend || 1)) * 100)}% of spend
              </>
            ) : (
              'No purchases'
            )
          }
          onExport={
            spend.length
              ? () =>
                  exportCsv('spend-by-supplier', spend, [
                    { key: 's', header: 'Supplier', value: (r) => r.supplierName ?? '' },
                    { key: 'n', header: 'Purchase lines', value: (r) => r.purchaseCount },
                    { key: 'a', header: 'Spend', value: (r) => r.totalSpend ?? '' },
                  ])
              : undefined
          }
        >
          {spend.length ? (
            <SortedBars
              limit={8}
              rows={spend.map((r) => ({
                key: r.supplierId,
                label: r.supplierName ?? '—',
                value: r.totalSpend ?? 0,
                display: fmtPesoCompact(r.totalSpend),
                sub: `${r.purchaseCount}`,
                title: `${fmtPeso(r.totalSpend)} · ${r.purchaseCount} lines`,
              }))}
            />
          ) : (
            <ChartEmpty title="No purchases in this period" />
          )}
        </Card>

        <Card
          title="Top materials by spend"
          span={4}
          takeaway={
            materials[0] ? (
              <>
                <strong>{materials[0].materialName}</strong> · {fmtPesoCompact(materials[0].totalSpend)}
              </>
            ) : (
              'No purchases'
            )
          }
          onExport={
            materials.length
              ? () =>
                  exportCsv('materials-by-spend', materials, [
                    { key: 'm', header: 'Material', value: (r) => r.materialName },
                    { key: 'n', header: 'Purchase lines', value: (r) => r.purchaseCount },
                    { key: 'q', header: 'Quantity', value: (r) => r.totalQuantity ?? '' },
                    { key: 'u', header: 'Unit', value: (r) => r.unit ?? '' },
                    { key: 'a', header: 'Spend', value: (r) => r.totalSpend ?? '' },
                  ])
              : undefined
          }
        >
          {materials.length ? (
            <SortedBars
              limit={8}
              rows={materials.map((r) => ({
                key: r.materialName,
                label: r.materialName,
                value: r.totalSpend ?? 0,
                display: fmtPesoCompact(r.totalSpend),
                color: PALETTE.third,
                title: `${fmtNum(r.totalQuantity)} ${r.unit ?? ''} · ${r.purchaseCount} lines`,
              }))}
            />
          ) : (
            <ChartEmpty title="No purchases in this period" />
          )}
        </Card>
      </Grid>
    </div>
  );
}
