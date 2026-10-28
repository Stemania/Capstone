import { useEffect, useMemo, useState } from 'react';
import { Button, Skeleton } from 'antd';
import {
  AlertOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  MailOutlined,
  RightOutlined,
  ShoppingCartOutlined,
  TruckOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { analyticsApi } from '../../api/analytics.api';
import type { OfficeSummary } from '../../types';
import {
  DataTable,
  EmptyState,
  IdChip,
  Page,
  SectionCard,
  StatCard,
  StatGrid,
  StatusPill,
  rowOpenProps,
} from '../../components/ui';
import { formatShop } from '../../utils/shopTime';
import './officeDashboard.css';

const UPDATE_LABEL: Record<string, string> = {
  JOB_RECEIVED: 'Job received',
  JOB_STARTED: 'Job started',
  JOB_HALFWAY: 'Halfway update',
  JOB_FINAL_STAGE: 'Final stage',
  JOB_DELIVERED: 'Ready for delivery',
  JOB_DELAYED: 'Delayed',
};

type TaskKind = 'materials' | 'invoice' | 'email';
type Task = {
  key: string;
  kind: TaskKind;
  jobId: string;
  jobNumber: string | null;
  clientName: string | null;
  detail: string;
  when: string | null;
};

const TASK_LABEL: Record<TaskKind, { label: string; tone: 'amber' | 'blue' | 'red' }> = {
  materials: { label: 'Order materials', tone: 'amber' },
  invoice: { label: 'Record sales invoice', tone: 'blue' },
  email: { label: 'Resend client email', tone: 'red' },
};

function day(iso: string | null) {
  return iso ? formatShop(iso, 'MMM D, YYYY') : '—';
}

function qty(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
}

/** Dashboard for the Office Staff: their own work waiting to be done. */
export default function OfficeDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<OfficeSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    analyticsApi
      .officeSummary()
      .then(({ data: d }) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const tasks = useMemo<Task[]>(() => {
    if (!data) return [];
    return [
      ...data.materialsToOrder.map((j) => ({
        key: `m-${j.id}`,
        kind: 'materials' as const,
        jobId: j.id,
        jobNumber: j.jobNumber,
        clientName: j.clientName,
        detail: j.title,
        when: j.dueDate,
      })),
      ...data.invoicesToRecord.map((j) => ({
        key: `i-${j.id}`,
        kind: 'invoice' as const,
        jobId: j.id,
        jobNumber: j.jobNumber,
        clientName: j.clientName,
        detail: j.title,
        when: j.dueDate,
      })),
      ...data.failedEmails.map((e) => ({
        key: `e-${e.id}`,
        kind: 'email' as const,
        jobId: e.jobOrderId,
        jobNumber: e.jobNumber,
        clientName: e.clientName,
        detail: `${UPDATE_LABEL[e.milestone] || e.milestone} email failed`,
        when: e.createdAt,
      })),
    ];
  }, [data]);

  const loading = !data && !failed;
  const deliveries = data ? [...data.lateDeliveries, ...data.deliveriesDueSoon] : [];

  if (failed) {
    return (
      <Page className="dashboard-page">
        <EmptyState
          icon={<WarningOutlined />}
          title="Couldn't load the dashboard"
          description="Refresh the page to try again."
        />
      </Page>
    );
  }

  return (
    <Page className="dashboard-page office-dash">
      <StatGrid min={180}>
        <StatCard
          icon={<FileTextOutlined />}
          tone="blue"
          label="Pending job orders"
          value={data?.pendingJobs ?? 0}
          loading={loading}
          hint="Waiting for the Admin to plan"
          onClick={() => navigate('/job-orders?tab=drafts')}
        />
        <StatCard
          icon={<ShoppingCartOutlined />}
          tone="amber"
          label="Materials to order"
          value={data?.materialsToOrder.length ?? 0}
          valueTone={data?.materialsToOrder.length ? 'amber' : undefined}
          loading={loading}
          hint="Jobs with nothing ordered yet"
          onClick={() => navigate('/supplier-orders')}
        />
        <StatCard
          icon={<TruckOutlined />}
          tone="red"
          label="Late deliveries"
          value={data?.lateDeliveries.length ?? 0}
          valueTone={data?.lateDeliveries.length ? 'red' : undefined}
          loading={loading}
          hint={data ? `${data.deliveriesDueSoon.length} due in the next 7 days` : undefined}
          onClick={() => navigate('/supplier-orders')}
        />
        <StatCard
          icon={<FileDoneOutlined />}
          tone="indigo"
          label="Invoices to record"
          value={data?.invoicesToRecord.length ?? 0}
          loading={loading}
          hint="Completed jobs without an invoice"
          onClick={() => navigate('/job-orders')}
        />
        <StatCard
          icon={<AlertOutlined />}
          tone="amber"
          label="Low stock"
          value={data?.lowStock.length ?? 0}
          valueTone={data?.lowStock.length ? 'amber' : undefined}
          loading={loading}
          hint="At the reorder level"
          onClick={() => navigate('/tools')}
        />
        <StatCard
          icon={<MailOutlined />}
          tone="red"
          label="Failed client emails"
          value={data?.failedEmails.length ?? 0}
          valueTone={data?.failedEmails.length ? 'red' : undefined}
          loading={loading}
          hint="Not sent since, last 30 days"
        />
      </StatGrid>

      <div className="dashboard-page__charts">
        <SectionCard
          title="Needs your action"
          subtitle="Job orders waiting on the office"
          flush
          extra={
            <Button type="link" size="small" onClick={() => navigate('/job-orders')}>
              Job orders <RightOutlined />
            </Button>
          }
        >
          <DataTable<Task>
            card={{ title: 'detail', subtitle: ['jobNumber', 'clientName'] }}
            rowKey="key"
            loading={loading}
            dataSource={tasks}
            pagination={false}
            scroll={{ x: 640 }}
            locale={{
              emptyText: (
                <EmptyState compact icon={<FileDoneOutlined />} title="Nothing waiting on the office" />
              ),
            }}
            onRow={(t) => rowOpenProps(() => navigate(`/job-orders/${t.jobId}`))}
            columns={[
              {
                title: 'To do',
                key: 'kind',
                width: 190,
                render: (_: unknown, t) => (
                  <StatusPill tone={TASK_LABEL[t.kind].tone} compact>
                    {TASK_LABEL[t.kind].label}
                  </StatusPill>
                ),
              },
              {
                title: 'Job #',
                key: 'jobNumber',
                width: 130,
                render: (_: unknown, t) => <IdChip>{t.jobNumber || '—'}</IdChip>,
              },
              { title: 'Client', dataIndex: 'clientName', width: 160, ellipsis: true },
              { title: 'Details', dataIndex: 'detail', ellipsis: true },
              {
                title: 'Date',
                key: 'when',
                width: 120,
                render: (_: unknown, t) => <span className="ui-tabular">{day(t.when)}</span>,
              },
            ]}
          />
        </SectionCard>

        <div className="office-dash__side">
          <SectionCard
            title="Supplier deliveries"
            subtitle="Late, and due in the next 7 days"
            extra={
              <Button type="link" size="small" onClick={() => navigate('/supplier-orders')}>
                Orders <RightOutlined />
              </Button>
            }
          >
            {loading ? (
              <Skeleton active paragraph={{ rows: 3 }} title={false} />
            ) : deliveries.length === 0 ? (
              <EmptyState compact icon={<TruckOutlined />} title="No deliveries due" />
            ) : (
              <ul className="office-dash__list">
                {deliveries.slice(0, 6).map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => navigate(`/supplier-orders/${d.id}`)}>
                      <span className="office-dash__main">
                        <strong>{d.poNumber || 'Supplier order'}</strong>
                        <span>{d.supplierName || '—'}</span>
                      </span>
                      <span className={`office-dash__when ui-tabular${d.daysOverdue > 0 ? ' tone-text--red' : ''}`}>
                        {d.daysOverdue > 0
                          ? `${d.daysOverdue} day${d.daysOverdue === 1 ? '' : 's'} late`
                          : day(d.expectedDeliveryDate)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="Low stock"
            subtitle="Consumables at the reorder level"
            extra={
              <Button type="link" size="small" onClick={() => navigate('/tools')}>
                Inventory <RightOutlined />
              </Button>
            }
          >
            {loading ? (
              <Skeleton active paragraph={{ rows: 3 }} title={false} />
            ) : !data || data.lowStock.length === 0 ? (
              <EmptyState compact icon={<AlertOutlined />} title="Nothing to reorder" />
            ) : (
              <ul className="office-dash__list">
                {data.lowStock.slice(0, 6).map((it) => (
                  <li key={it.id}>
                    <button type="button" onClick={() => navigate('/tools')}>
                      <span className="office-dash__main">
                        <strong>{it.name}</strong>
                        <span>
                          {qty(it.onHand)} {it.unit} on hand · reorder at {qty(it.reorderLevel)}
                        </span>
                      </span>
                      {it.suggestedOrderQty ? (
                        <span className="office-dash__when ui-tabular">
                          Order {qty(it.suggestedOrderQty)}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
    </Page>
  );
}
