import { formatShop, shopToday, toShopDayjs } from '../../utils/shopTime';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Tooltip, message } from 'antd';
import type { TableColumnsType } from 'antd';
import {
  CheckCircleOutlined,
  CopyOutlined,
  EditOutlined,
  FileTextOutlined,
  MailOutlined,
  PhoneOutlined,
  PlusOutlined,
  ToolOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { clientsApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import type { ClientDetail } from '../../types';
import { DataTable, EmptyState, IdChip, Page, PageSkeleton, SectionCard, StatCard, StatusPill, TabBar } from '../../components/ui';
import { JOB_STATUS } from '../../theme/statuses';
import type { Tone } from '../../theme/tokens';
import { useAuth } from '../../hooks/useAuth';
import ClientFormModal from './ClientFormModal';

type Job = ClientDetail['jobs'][number];
type JobFilter = 'all' | 'draft' | 'active' | 'completed' | 'delivered';

const FILTERS: { value: JobFilter; label: string; match: (j: Job) => boolean }[] = [
  { value: 'all', label: 'All', match: () => true },
  { value: 'draft', label: 'To plan', match: (j) => j.status === 'DRAFT' },
  { value: 'active', label: 'Active', match: (j) => j.status === 'SCHEDULED' || j.status === 'IN_PROGRESS' },
  { value: 'completed', label: 'Completed', match: (j) => j.status === 'COMPLETED' },
  { value: 'delivered', label: 'For Delivery', match: (j) => j.status === 'DELIVERED' },
];

function money(v: number | null | undefined) {
  if (v == null) return '—';
  return `₱${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

/** Shop calendar date (YYYY-MM-DD) the job was ordered: the client's PO date, else when it was entered. */
function orderDay(j: Job): string | null {
  if (j.poDate) return j.poDate.slice(0, 10);
  return j.createdAt ? toShopDayjs(j.createdAt).format('YYYY-MM-DD') : null;
}

function isOverdue(j: Job) {
  if (!j.dueDate || j.status === 'DRAFT' || j.status === 'COMPLETED' || j.status === 'DELIVERED') return false;
  return j.dueDate.slice(0, 10) < shopToday().format('YYYY-MM-DD');
}

function onTimeTone(pct: number): Tone {
  if (pct >= 90) return 'green';
  if (pct >= 70) return 'amber';
  return 'red';
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    message.success(`${what} copied`);
  } catch {
    message.error(`Could not copy the ${what.toLowerCase()}`);
  }
}

function None({ children }: { children: ReactNode }) {
  return <span className="client-stats__none">{children}</span>;
}

function ContactRow({
  icon,
  label,
  value,
  href,
  copyAs,
}: {
  icon: ReactNode;
  label: string;
  value: string | null | undefined;
  href?: string;
  copyAs?: string;
}) {
  const body = (
    <>
      <span className="client-contact__icon" aria-hidden>
        {icon}
      </span>
      <span className="client-contact__text">
        <span className="client-contact__label">{label}</span>
        <span className={`client-contact__value${value ? '' : ' is-empty'}`}>{value || 'Not added'}</span>
      </span>
    </>
  );
  return (
    <div className="client-contact">
      {value && href ? (
        <a className="client-contact__main is-link" href={href}>
          {body}
        </a>
      ) : (
        <div className="client-contact__main">{body}</div>
      )}
      {value && copyAs ? (
        <Tooltip title={`Copy ${copyAs.toLowerCase()}`}>
          <Button
            type="text"
            size="small"
            className="client-contact__copy"
            icon={<CopyOutlined />}
            aria-label={`Copy ${copyAs.toLowerCase()}`}
            onClick={() => void copy(value, copyAs)}
          />
        </Tooltip>
      ) : null}
    </div>
  );
}

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin, isOfficeStaff: canEdit } = useAuth();
  const [data, setData] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<JobFilter>('all');
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await clientsApi.get(id);
        if (!cancelled) setData(res.data);
      } catch (err) {
        if (!cancelled) message.error(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const jobs = useMemo(
    () => [...(data?.jobs ?? [])].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [data]
  );

  const stats = useMemo(() => {
    const active = jobs.filter((j) => j.status === 'SCHEDULED' || j.status === 'IN_PROGRESS').length;
    const draft = jobs.filter((j) => j.status === 'DRAFT').length;
    const judged = jobs.filter((j) => j.status === 'DELIVERED' && j.deliveredOnTime != null);
    const onTime = judged.filter((j) => j.deliveredOnTime).length;
    const days = jobs.map(orderDay).filter((d): d is string => Boolean(d)).sort();
    return {
      active,
      draft,
      onTime,
      judged: judged.length,
      onTimePct: judged.length ? Math.round((onTime / judged.length) * 100) : null,
      firstOrder: days[0] ?? null,
      lastOrder: days[days.length - 1] ?? null,
    };
  }, [jobs]);

  if (loading && !data) {
    return <PageSkeleton variant="detail" />;
  }
  if (!data) {
    return (
      <Page>
        <EmptyState title="Client not found" description="It may have been removed, or the link is wrong." />
      </Page>
    );
  }

  const newJob = () => navigate(`/job-orders/new?client=${data.id}`);
  const since = stats.firstOrder ?? data.createdAt ?? null;
  const counts = Object.fromEntries(FILTERS.map((f) => [f.value, jobs.filter(f.match).length])) as Record<JobFilter, number>;
  const shown = jobs.filter(FILTERS.find((f) => f.value === filter)!.match);
  const draftLabel = isAdmin ? 'To plan' : 'Pending';
  const notify = [data.notifyByEmail ? 'Email' : null, data.notifyBySms ? 'SMS' : null].filter((n): n is string => Boolean(n));

  const columns: TableColumnsType<Job> = [
    {
      title: 'Job #',
      dataIndex: 'jobNumber',
      width: '13%',
      render: (v: string | null, r) => (
        <IdChip to={`/job-orders/${r.id}`} onClick={(e) => e.stopPropagation()}>
          {v || r.id.slice(0, 8).toUpperCase()}
        </IdChip>
      ),
    },
    {
      title: 'Title',
      dataIndex: 'title',
      ellipsis: true,
      render: (v: string) => <span className="client-jobs__title">{v}</span>,
    },
    {
      title: 'Ordered',
      key: 'ordered',
      width: '12%',
      sorter: (a, b) => (orderDay(a) || '').localeCompare(orderDay(b) || ''),
      render: (_: unknown, r) => formatShop(orderDay(r), 'MMM D, YYYY'),
    },
    {
      title: 'Date required',
      dataIndex: 'dueDate',
      width: '13%',
      sorter: (a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''),
      render: (v: string | null, r) =>
        isOverdue(r) ? (
          <span className="tone-text--red" title="Past the date required">
            {formatShop(v, 'MMM D, YYYY')}
          </span>
        ) : (
          formatShop(v, 'MMM D, YYYY')
        ),
    },
    {
      title: 'Value',
      dataIndex: 'amount',
      width: '11%',
      align: 'right',
      sorter: (a, b) => (a.amount ?? 0) - (b.amount ?? 0),
      render: (v: number | null) => <span className="ui-tabular client-jobs__value">{money(v)}</span>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: '12%',
      render: (s: string) => (
        <StatusPill status={s} map={JOB_STATUS} compact>
          {s === 'DRAFT' ? draftLabel : undefined}
        </StatusPill>
      ),
    },
    {
      title: 'On time',
      dataIndex: 'deliveredOnTime',
      width: '9%',
      render: (v: boolean | null) => {
        if (v === true) return <StatusPill tone="green" compact>On time</StatusPill>;
        if (v === false) return <StatusPill tone="red" compact>Late</StatusPill>;
        return <span className="client-jobs__muted">—</span>;
      },
    },
  ];

  return (
    <Page className="client-page">
      <section className="ui-card client-head">
        <div className="client-head__top">
          <div className="client-head__avatar" aria-hidden>
            {initials(data.name)}
          </div>
          <div className="client-head__titles">
            <h2 className="client-head__name">{data.name}</h2>
            <div className="client-head__meta">
              {since ? <span>Client since {formatShop(since, 'MMMM YYYY')}</span> : null}
              <span>
                {stats.lastOrder ? `Last order ${formatShop(stats.lastOrder, 'MMM D, YYYY')}` : 'No orders yet'}
              </span>
            </div>
          </div>
          {canEdit ? (
            <div className="client-head__actions m-action-bar">
              <Button icon={<EditOutlined />} onClick={() => setEditOpen(true)}>
                Edit client
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={newJob}>
                New job order
              </Button>
            </div>
          ) : null}
        </div>

        <div className="client-head__contacts">
          <ContactRow icon={<UserOutlined />} label="Contact person" value={data.contact} />
          <ContactRow
            icon={<MailOutlined />}
            label="Email"
            value={data.email}
            href={data.email ? `mailto:${data.email}` : undefined}
            copyAs="Email"
          />
          <ContactRow
            icon={<PhoneOutlined />}
            label="Mobile"
            value={data.mobileNumber}
            href={data.mobileNumber ? `tel:${data.mobileNumber.replace(/\s+/g, '')}` : undefined}
            copyAs="Mobile number"
          />
          <div className="client-contact client-contact--notify">
            <span className="client-contact__text">
              <span className="client-contact__label">Job updates by</span>
              <span className="client-contact__pills">
                {notify.length ? (
                  notify.map((n) => (
                    <StatusPill key={n} tone="blue" compact>
                      {n}
                    </StatusPill>
                  ))
                ) : (
                  <StatusPill tone="grey" compact>
                    Off
                  </StatusPill>
                )}
              </span>
            </span>
          </div>
        </div>
      </section>

      <div className="ui-stat-grid client-stats">
        <StatCard
          icon={<FileTextOutlined />}
          tone="blue"
          label="Job orders"
          value={jobs.length ? jobs.length : <None>None yet</None>}
          hint={
            jobs.length
              ? [stats.draft ? `${stats.draft} ${draftLabel.toLowerCase()}` : null, `${stats.active} active`]
                  .filter(Boolean)
                  .join(' · ')
              : 'Their first order will show here'
          }
        />
        <StatCard
          icon={<ToolOutlined />}
          tone="indigo"
          label="In production"
          value={stats.active ? stats.active : <None>Nothing running</None>}
          hint="Scheduled or in progress"
        />
        <StatCard
          icon={<CheckCircleOutlined />}
          tone={stats.onTimePct == null ? 'slate' : onTimeTone(stats.onTimePct)}
          label="On-time delivery"
          value={stats.onTimePct == null ? <None>No deliveries yet</None> : `${stats.onTimePct}%`}
          valueTone={stats.onTimePct == null ? undefined : onTimeTone(stats.onTimePct)}
          hint={
            stats.judged
              ? `${stats.onTime} of ${stats.judged} set For Delivery by the date required`
              : 'Measured when a job is set For Delivery'
          }
        />
        <StatCard
          icon={<span className="client-stats__peso">₱</span>}
          tone="teal"
          label="Total value"
          value={data.totals.totalValue ? money(data.totals.totalValue) : <None>No released jobs</None>}
          hint="Excludes pending jobs"
        />
      </div>

      <SectionCard
        className="client-jobs"
        title="Job orders"
        subtitle={jobs.length ? `${jobs.length} job${jobs.length === 1 ? '' : 's'}, newest first` : undefined}
      >
        {jobs.length ? (
          <>
            <div className="client-jobs__filters">
              <TabBar<JobFilter>
                size="small"
                value={filter}
                onChange={setFilter}
                items={FILTERS.map((f) => ({
                  value: f.value,
                  label: f.value === 'draft' ? draftLabel : f.label,
                  count: counts[f.value],
                }))}
              />
            </div>
            <DataTable<Job>
              card={{ title: 'jobNumber', subtitle: ['title'], badge: 'status' }}
              cardsBelow="narrow"
              className="client-jobs__table"
              rowKey="id"
              tableLayout="fixed"
              pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }}
              dataSource={shown}
              locale={{
                emptyText: (
                  <EmptyState
                    compact
                    title={`No ${(filter === 'draft' ? draftLabel : FILTERS.find((f) => f.value === filter)!.label).toLowerCase()} job orders`}
                  />
                ),
              }}
              onRow={(r) => ({
                onClick: () => navigate(`/job-orders/${r.id}`),
                style: { cursor: 'pointer' },
              })}
              columns={columns}
            />
          </>
        ) : (
          <EmptyState
            icon={<FileTextOutlined />}
            title="No job orders yet"
            description={`Job orders for ${data.name} will be listed here.`}
            action={
              canEdit ? (
                <Button type="primary" icon={<PlusOutlined />} onClick={newJob}>
                  New job order
                </Button>
              ) : undefined
            }
          />
        )}
      </SectionCard>

      <ClientFormModal
        open={editOpen}
        client={data}
        onClose={() => setEditOpen(false)}
        onSaved={(saved) => {
          setEditOpen(false);
          setData((d) => (d ? { ...d, ...saved } : d));
        }}
      />
    </Page>
  );
}
