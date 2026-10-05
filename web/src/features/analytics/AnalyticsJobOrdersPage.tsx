import { useEffect, useState } from 'react';
import { Spin, Table, Typography, message } from 'antd';
import { analyticsApi } from '../../api/analytics.api';
import { getErrorMessage } from '../../api/client';
import type { AnalyticsJobOrders } from '../../types';
import { exportCsv } from '../../utils/csvExport';
import { SummaryCard } from './AnalyticsChrome';
import { AnalyticsGrid, AnalyticsSection } from './AnalyticsSection';
import SalesSection from './SalesSection';
import { formatInt, formatMoney, formatPct, useAnalyticsPeriod } from './analyticsPeriod';

const { Text } = Typography;

const JOB_TYPE_LABEL: Record<string, string> = {
  FABRICATION: 'Fabrication',
  MODIFICATION: 'Modification',
  REPAIR: 'Repair',
};

const OPEN_LABEL: Record<string, string> = {
  DRAFT: 'Draft (being planned)',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed, awaiting delivery',
};

export default function AnalyticsJobOrdersPage() {
  const { params } = useAnalyticsPeriod();
  const [data, setData] = useState<AnalyticsJobOrders | null>(null);

  useEffect(() => {
    let cancelled = false;
    analyticsApi
      .jobOrders(params)
      .then(({ data: d }) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) message.error(getErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [params.from, params.to]);

  if (!data) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  const { received, finished, delivered, openNow } = data;
  const onTimeRate = delivered.count ? (delivered.onTime / delivered.count) * 100 : null;
  const openRows = Object.entries(openNow.byStatus).map(([status, count]) => ({
    status,
    label: OPEN_LABEL[status] ?? status,
    count,
  }));

  return (
    <div>
      <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 16 }}>
        Period {data.period.from} → {data.period.to}. Job orders count as received on their PO date
        (creation date when there is none).
      </Text>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <SummaryCard
          label="Job orders received"
          value={formatInt(received.count)}
          hint={`${formatMoney(received.amount)} in quoted amounts`}
        />
        <SummaryCard
          label="Jobs finished"
          value={formatInt(finished.completed)}
          hint={`${formatInt(finished.awaitingDelivery)} still awaiting delivery`}
        />
        <SummaryCard
          label="Delivered"
          value={formatInt(delivered.count)}
          hint={`${formatMoney(delivered.amount)} · ${delivered.onTime} on time · ${delivered.late} late`}
        />
        <SummaryCard
          label="Delivered on time"
          value={formatPct(onTimeRate, 0)}
          hint="Delivered on or before the date required"
        />
        <SummaryCard
          label="Open past the date required"
          value={formatInt(openNow.pastDateRequired)}
          hint="Not yet delivered, as of today"
        />
      </div>

      <AnalyticsGrid>
        <AnalyticsSection
          span={6}
          title="Job orders received and open"
          description="Received in the selected period by job type, and every job order not yet delivered as of today."
          onExport={() =>
            exportCsv(`job-orders-received-${data.period.from}_${data.period.to}.csv`, received.byJobType, [
              { key: 'type', header: 'JobType', value: (r) => JOB_TYPE_LABEL[r.jobType] ?? r.jobType },
              { key: 'count', header: 'Received', value: (r) => r.count },
              { key: 'amount', header: 'Amount', value: (r) => r.amount },
            ])
          }
          exportDisabled={!received.byJobType.length}
        >
          <Table
            size="small"
            pagination={false}
            rowKey="jobType"
            dataSource={received.byJobType}
            locale={{ emptyText: 'No job orders received in this period.' }}
            columns={[
              {
                title: 'Received, by job type',
                dataIndex: 'jobType',
                render: (v: string) => JOB_TYPE_LABEL[v] ?? v,
              },
              { title: 'Job orders', dataIndex: 'count', width: 100, align: 'right' },
              {
                title: 'Amount',
                dataIndex: 'amount',
                width: 140,
                align: 'right',
                render: (v: number | null) => formatMoney(v),
              },
            ]}
          />
          <Table
            size="small"
            style={{ marginTop: 16 }}
            pagination={false}
            rowKey="status"
            dataSource={openRows}
            columns={[
              { title: 'Open now', dataIndex: 'label' },
              { title: 'Job orders', dataIndex: 'count', width: 100, align: 'right' },
            ]}
          />
        </AnalyticsSection>
        <SalesSection span={6} />
      </AnalyticsGrid>
    </div>
  );
}
