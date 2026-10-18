import { Link } from 'react-router-dom';
import StatusPill from '../../components/StatusPill';
import { PageSkeleton } from '../../components/ui';
import { fmtDay, fmtNum, fmtPesoCompact, onTimePct, pctChange, ptsChange } from './format';
import { Card, ChartEmpty, Grid, Kpi, Kpis, LineTrend, PALETTE, SortedBars } from './kit';
import {
  CardLoading,
  DemandForecastCard,
  FLAG,
  RingCard,
  SalesForecastCard,
  StockAlertsCard,
  finishOf,
  scoredSuppliers,
  slackText,
  stockCounts,
} from './cards';
import {
  useCompletion,
  useConsumables,
  useDelays,
  useDemandForecast,
  useIsAdmin,
  useJobOrders,
  useOverview,
  usePeriods,
  useReliability,
  useSalesForecast,
  useSalesSummary,
  useTrend,
} from './sources';

export default function AnalyticsOverviewPage() {
  return useIsAdmin() ? <AdminOverview /> : <OfficeOverview />;
}

function AdminOverview() {
  const { period, previous } = usePeriods();
  const overview = useOverview(period).data;
  const overviewPrev = useOverview(previous).data;
  const sales = useSalesSummary(period).data;
  const salesPrev = useSalesSummary(previous).data;
  const jobs = useJobOrders(period).data;
  const jobsPrev = useJobOrders(previous).data;
  const delays = useDelays(period).data;
  const delaysPrev = useDelays(previous).data;
  const trend = useTrend(period).data;
  const salesForecast = useSalesForecast().data;
  const demand = useDemandForecast().data;
  const stock = useConsumables().data;
  const completion = useCompletion().data;

  if (!overview) return <PageSkeleton variant="cards" />;

  const onTime = onTimePct(overview.jobs.onTime, overview.jobs.late);
  const onTimePrev = overviewPrev ? onTimePct(overviewPrev.jobs.onTime, overviewPrev.jobs.late) : null;
  const counts = stockCounts(stock);
  const causes = (delays?.causes ?? []).filter((c) => (c.hours ?? 0) > 0);
  const atRisk = (completion?.jobs ?? []).filter((j) => j.flag === 'RED' || j.flag === 'AMBER');
  const weeks = (trend?.weeks ?? []).map((w) => ({
    label: fmtDay(w.weekStart),
    tipLabel: `Week of ${fmtDay(w.weekStart)}`,
    jobs: w.jobsFinished,
    ops: w.operationCount,
  }));
  const totalJobsInTrend = weeks.reduce((s, w) => s + w.jobs, 0);

  return (
    <div>
      <Kpis>
        <Kpi
          label="Jobs finished"
          value={fmtNum(overview.jobs.completed)}
          delta={overviewPrev ? pctChange(overview.jobs.completed, overviewPrev.jobs.completed) : undefined}
        />
        <Kpi
          label="On time"
          value={onTime == null ? '—' : fmtNum(onTime)}
          unit={onTime == null ? undefined : '%'}
          delta={ptsChange(onTime, onTimePrev)}
          deltaUnit="pts"
          info="Delivered jobs with a delivery date on or before the date required."
        />
        <Kpi
          label="Sales"
          value={fmtPesoCompact(sales?.totalAmount)}
          delta={sales && salesPrev ? pctChange(sales.totalAmount, salesPrev.totalAmount) : undefined}
        />
        <Kpi
          label="Job orders in"
          value={fmtNum(jobs?.received.count)}
          delta={jobs && jobsPrev ? pctChange(jobs.received.count, jobsPrev.received.count) : undefined}
        />
        <Kpi
          label="Delay hours"
          value={fmtNum(delays?.totalDelayHours, 1)}
          delta={delays && delaysPrev ? pctChange(delays.totalDelayHours, delaysPrev.totalDelayHours) : undefined}
          better="down"
        />
        <Kpi
          label="To reorder"
          value={fmtNum(counts.LIKELY_OUT + counts.REORDER_NOW + counts.REORDER_SOON)}
          valueTone={
            counts.LIKELY_OUT + counts.REORDER_NOW + counts.REORDER_SOON ? 'amber' : undefined
          }
          sub="consumables, now"
        />
      </Kpis>

      <Grid>
        <SalesForecastCard data={salesForecast} height={210} />
        <DemandForecastCard data={demand} height={210} compact />

        <Card
          title="Weekly output"
          span={4}
          takeaway={
            trend ? (
              <>
                <strong>{totalJobsInTrend}</strong> jobs finished in {weeks.length} weeks
              </>
            ) : undefined
          }
        >
          {!trend ? (
            <CardLoading />
          ) : weeks.length < 2 ? (
            <ChartEmpty title="Not enough weeks yet" text="Pick a longer period." />
          ) : (
            <LineTrend
              rows={weeks}
              height={180}
              series={[{ key: 'jobs', label: 'Jobs finished', color: PALETTE.primary }]}
              tipFormat={(_, v) => fmtNum(v)}
            />
          )}
        </Card>

        <Card
          title="Top delay causes"
          span={4}
          takeaway={
            causes[0] ? (
              <>
                <strong>{causes[0].label}</strong> · {fmtNum(causes[0].shareOfTotalPct)}% of delay hours
              </>
            ) : delays ? (
              'No delays recorded'
            ) : undefined
          }
          controls={
            <Link to="/analytics/delays" className="ana-muted" style={{ fontSize: 12 }}>
              Pareto
            </Link>
          }
        >
          {!delays ? (
            <CardLoading />
          ) : !causes.length ? (
            <ChartEmpty title="No delay hours in this period" />
          ) : (
            <SortedBars
              rows={causes.map((c, i) => ({
                key: c.cause,
                label: c.label,
                value: c.hours ?? 0,
                display: `${fmtNum(c.hours, 1)} h`,
                color: i < (delays.vitalFewCount ?? 1) ? PALETTE.primary : PALETTE.muted,
              }))}
              limit={5}
            />
          )}
        </Card>

        <Card
          title="Open jobs at risk"
          span={4}
          takeaway={
            completion ? (
              atRisk.length ? (
                <>
                  <strong>{atRisk.length}</strong> of {completion.jobs.length} may miss the date required
                </>
              ) : completion.jobs.length ? (
                `All ${completion.jobs.length} open jobs on track`
              ) : (
                'No open jobs'
              )
            ) : undefined
          }
          takeawayTone={atRisk.length ? 'bad' : undefined}
          controls={
            <Link to="/analytics/production" className="ana-muted" style={{ fontSize: 12 }}>
              All jobs
            </Link>
          }
        >
          {!completion ? (
            <CardLoading />
          ) : !completion.jobs.length ? (
            <ChartEmpty title="No open jobs" text="Released jobs that are not finished show here." />
          ) : !atRisk.length ? (
            <ChartEmpty title="Nothing at risk" text="Predicted finishes are on or before the dates required." />
          ) : (
            <div className="ana-list">
              {atRisk.slice(0, 5).map((j) => (
                <Link key={j.jobOrderId} to={`/job-orders/${j.jobOrderId}`} className="ana-list__row">
                  <div className="ana-list__main">
                    <div className="ana-list__title">{j.jobNumber}</div>
                    <div className="ana-list__sub">
                      Due {fmtDay(j.dueDate)} · finish {fmtDay(finishOf(j))}
                    </div>
                  </div>
                  <div className="ana-list__end">
                    <StatusPill tone={FLAG[j.flag ?? 'GREEN'].tone} compact>
                      {slackText(j.slackDays)}
                    </StatusPill>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <StockAlertsCard data={stock} span={12} />
      </Grid>
    </div>
  );
}

const OPEN_LABEL: Record<string, string> = {
  DRAFT: 'Being planned',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Awaiting delivery',
};

function OfficeOverview() {
  const { period, previous } = usePeriods();
  const jobs = useJobOrders(period).data;
  const jobsPrev = useJobOrders(previous).data;
  const sales = useSalesSummary(period).data;
  const salesPrev = useSalesSummary(previous).data;
  const salesForecast = useSalesForecast().data;
  const demand = useDemandForecast().data;
  const stock = useConsumables().data;
  const reliability = useReliability(period).data;

  if (!jobs) return <PageSkeleton variant="cards" />;

  const onTime = onTimePct(jobs.delivered.onTime, jobs.delivered.late);
  const onTimePrev = jobsPrev ? onTimePct(jobsPrev.delivered.onTime, jobsPrev.delivered.late) : null;
  const counts = stockCounts(stock);
  const open = Object.keys(OPEN_LABEL).map((status) => ({
    key: status,
    label: OPEN_LABEL[status],
    value: jobs.openNow.byStatus[status as keyof typeof jobs.openNow.byStatus] ?? 0,
  }));
  const openTotal = open.reduce((s, r) => s + r.value, 0);
  const { scored } = scoredSuppliers(reliability);

  return (
    <div>
      <Kpis>
        <Kpi
          label="Job orders in"
          value={fmtNum(jobs.received.count)}
          delta={jobsPrev ? pctChange(jobs.received.count, jobsPrev.received.count) : undefined}
        />
        <Kpi
          label="Delivered"
          value={fmtNum(jobs.delivered.count)}
          delta={jobsPrev ? pctChange(jobs.delivered.count, jobsPrev.delivered.count) : undefined}
        />
        <Kpi
          label="On time"
          value={onTime == null ? '—' : fmtNum(onTime)}
          unit={onTime == null ? undefined : '%'}
          delta={ptsChange(onTime, onTimePrev)}
          deltaUnit="pts"
          info="Delivered jobs with a delivery date on or before the date required."
        />
        <Kpi
          label="Sales"
          value={fmtPesoCompact(sales?.totalAmount)}
          delta={sales && salesPrev ? pctChange(sales.totalAmount, salesPrev.totalAmount) : undefined}
        />
        <Kpi
          label="Pipeline"
          value={fmtPesoCompact(salesForecast?.committedPipeline.totalAmount)}
          sub={salesForecast ? `${salesForecast.committedPipeline.jobCount} released, not finished` : undefined}
          info="Amount of released jobs not yet completed."
        />
        <Kpi
          label="To reorder"
          value={fmtNum(counts.LIKELY_OUT + counts.REORDER_NOW + counts.REORDER_SOON)}
          valueTone={
            counts.LIKELY_OUT + counts.REORDER_NOW + counts.REORDER_SOON ? 'amber' : undefined
          }
          sub="consumables, now"
        />
      </Kpis>

      <Grid>
        <SalesForecastCard data={salesForecast} height={210} />
        <DemandForecastCard data={demand} height={210} compact />

        <Card
          title="Open jobs by status"
          span={4}
          chip="Now"
          takeaway={
            <>
              <strong>{openTotal}</strong> open · {jobs.openNow.pastDateRequired} past date required
            </>
          }
          takeawayTone={jobs.openNow.pastDateRequired ? 'bad' : undefined}
        >
          {openTotal ? (
            <SortedBars rows={open} sort={false} />
          ) : (
            <ChartEmpty title="No open jobs" />
          )}
        </Card>

        <Card
          title="Supplier scores"
          span={4}
          takeaway={
            scored[0] ? (
              <>
                Best: <strong>{scored[0].supplierName}</strong> · {Math.round(scored[0].score ?? 0)}
              </>
            ) : reliability ? (
              'Not enough deliveries yet'
            ) : undefined
          }
          controls={
            <Link to="/analytics/suppliers" className="ana-muted" style={{ fontSize: 12 }}>
              All suppliers
            </Link>
          }
        >
          {!reliability ? (
            <CardLoading />
          ) : !scored.length ? (
            <ChartEmpty title="Not enough deliveries" text="Scores need 3 deliveries due in the period." />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {scored.slice(0, 3).map((s) => (
                <RingCard key={s.supplierId} s={s} size={56} />
              ))}
            </div>
          )}
        </Card>

        <StockAlertsCard data={stock} span={4} />
      </Grid>
    </div>
  );
}
