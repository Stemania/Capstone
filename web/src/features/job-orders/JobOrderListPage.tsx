import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Table, Button, Select, Dropdown, Input, Space, Spin, message, Drawer, Badge, Tooltip } from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  CheckOutlined,
  PrinterOutlined,
  EyeOutlined,
  StopOutlined,
  InboxOutlined,
  MoreOutlined,
  SearchOutlined,
  FilterOutlined,
  CloseOutlined,
  CalendarOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { formatShopDate, scheduleFlagStyle, formatShop, shopToday } from '../../utils/shopTime';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import StatusPill from '../../components/StatusPill';
import { EllipsisText, IdChip, TabBar } from '../../components/ui';
import { JOB_FLAG, JOB_STATUS } from '../../theme/statuses';
import MaterialDelayTag from '../../components/MaterialDelayTag';
import NeedsReplanTag from '../../components/NeedsReplanTag';
import MaterialWaitTag from '../../components/MaterialWaitTag';
import SelectMultipleIcon from '../../components/SelectMultipleIcon';
import { useAuth } from '../../hooks/useAuth';
import { useOverdueCheck } from '../../hooks/useOverdueCheck';
import { useIsPhone } from '../../hooks/useIsPhone';
import { NARROW_QUERY } from '../../hooks/useViewport';
import type { JobOrder, JobOrderStatus } from '../../types';
import { compareByDue } from './jobOrderSort';
import { isJobOrderListTab } from './jobOrderListTabs';
import CancelJobModal from './CancelJobModal';

type ListTab = 'production' | 'drafts' | 'archived';

function tabFromSearch(param: string | null): ListTab {
  // Legacy ?tab=archived → handled by redirect to /job-orders/archived
  if (isJobOrderListTab(param)) return param;
  return 'production';
}

type JobOrderListPageProps = {
  /** Separate archived page; not a day-to-day tab. */
  mode?: 'active' | 'archived';
};

const PRODUCTION_STATUS_OPTIONS: { value: JobOrderStatus; label: string }[] = [
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'DELIVERED', label: 'For Delivery' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function isJobOverdue(job: JobOrder) {
  return (
    job.status !== 'COMPLETED' &&
    job.status !== 'DELIVERED' &&
    job.status !== 'CANCELLED' &&
    dayjs(job.dueDate).isBefore(shopToday(), 'day')
  );
}

function JobStatusBadge({ job }: { job: JobOrder }) {
  const overdue = isJobOverdue(job);
  const pill = overdue ? (
    <StatusPill tone={JOB_FLAG.overdue.tone} compact>{JOB_FLAG.overdue.label}</StatusPill>
  ) : (
    <StatusPill status={job.status} map={JOB_STATUS} compact />
  );
  const delayed = !!job.materialDelay && job.status === 'SCHEDULED';
  if (!job.waitingForMaterials && !delayed && !job.needsReplan) return pill;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
      {pill}
      <NeedsReplanTag job={job} />
      <MaterialWaitTag wait={job} />
      <MaterialDelayTag job={job} />
    </span>
  );
}

function DuePill({ job }: { job: JobOrder }) {
  const st = job.scheduleFlag ? scheduleFlagStyle[job.scheduleFlag] : null;
  const pill = (
    <span
      style={{
        display: 'inline-block',
        fontSize: 12,
        fontWeight: 600,
        padding: '3px 8px',
        borderRadius: 6,
        whiteSpace: 'nowrap',
        lineHeight: 1.25,
        color: st ? st.color : '#475569',
        background: st ? st.bg : '#f1f5f9',
        border: st ? `1px solid ${st.border}` : '1px solid #e2e8f0',
      }}
    >
      {formatShop(job.dueDate, 'MMM D, YYYY')}
    </span>
  );
  if (!st || job.scheduleFlag === 'GREEN') return pill;
  const basis = job.scheduleFlagBasis === 'ESTIMATE' ? 'estimated finish (past performance)' : 'scheduled finish';
  return <Tooltip title={`${st.label}: based on the ${basis}`}>{pill}</Tooltip>;
}

const ESTIMATE_HINT = 'Estimate based on past performance: target hours scaled by how long each operation type has taken before.';

function FinishCell({ job }: { job: JobOrder }) {
  if (!job.projectedCompletion && !job.predictedCompletion) {
    return <span style={{ fontSize: 13, color: '#94a3b8' }}>—</span>;
  }
  const flagged = job.scheduleFlag && job.scheduleFlag !== 'GREEN';
  const line = (label: string, iso: string | null | undefined, emphasize: boolean) =>
    iso ? (
      <div
        style={{
          fontSize: 12,
          whiteSpace: 'nowrap',
          lineHeight: 1.35,
          color: emphasize ? '#7A1528' : '#0f172a',
          fontWeight: emphasize ? 600 : 400,
        }}
      >
        <span style={{ color: '#64748b' }}>{label}</span> {formatShopDate(iso)}
      </div>
    ) : null;
  return (
    <div>
      {line('Sched.', job.projectedCompletion, !!flagged && job.scheduleFlagBasis === 'SCHEDULE')}
      {job.predictedCompletion ? (
        <Tooltip title={ESTIMATE_HINT}>
          <span>{line('Est.', job.predictedCompletion, !!flagged && job.scheduleFlagBasis === 'ESTIMATE')}</span>
        </Tooltip>
      ) : null}
    </div>
  );
}

type ViewMode = 'cards' | 'list';
const VIEW_STORAGE_KEY = 'jobOrders.view';

function readViewMode(): ViewMode {
  const stored = localStorage.getItem(VIEW_STORAGE_KEY);
  if (stored === 'cards' || stored === 'list') return stored;
  return window.matchMedia(NARROW_QUERY).matches ? 'cards' : 'list';
}

const VIEW_OPTIONS: { key: ViewMode; label: string; icon: ReactNode }[] = [
  { key: 'cards', label: 'Cards', icon: <AppstoreOutlined /> },
  { key: 'list', label: 'List', icon: <UnorderedListOutlined /> },
];

type JobCardProps = {
  job: JobOrder;
  isDraftTab: boolean;
  selected: boolean;
  actions: MenuProps['items'];
  onClick: () => void;
};

function JobCard({ job, isDraftTab, selected, actions, onClick }: JobCardProps) {
  const total = job.opsTotal || 0;
  const done = job.opsCompleted || 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const modified = job.updatedAt || job.createdAt;
  const menu = (
    <div onClick={(e) => e.stopPropagation()}>
      <Dropdown menu={{ items: actions }} trigger={['click']} placement="bottomRight">
        <Button
          type="text"
          size="small"
          icon={<MoreOutlined style={{ fontSize: 16 }} />}
          aria-label="More actions"
        />
      </Dropdown>
    </div>
  );

  return (
    <div
      className={`jo-card${selected ? ' is-selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick();
      }}
    >
      <div className="jo-card__top">
        <span className="jo-card__number">{job.jobNumber || job.id.slice(0, 8).toUpperCase()}</span>
        <JobStatusBadge job={job} />
        {menu}
      </div>
      <div className="jo-card__title" title={job.title}>
        {job.title}
      </div>
      <div className="jo-card__client">{job.clientName || 'No client'}</div>
      <div className="jo-card__pills">
        <DuePill job={job} />
        {!isDraftTab ? <FinishCell job={job} /> : null}
      </div>
      {isDraftTab ? (
        <div className="jo-card__stage">{job.draftStage || '—'}</div>
      ) : (
        <div className="jo-card__progress">
          <div className="jo-card__progress-label">
            {done}/{total} ops
          </div>
          <div className="jo-card__bar">
            <div className="jo-card__bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      <div className="jo-card__foot">
        {modified && dayjs(modified).isValid()
          ? `Modified ${formatShop(modified, 'MMM D, YYYY')}`
          : '—'}
        {isDraftTab && job.createdByName ? ` · ${job.createdByName}` : ''}
      </div>
    </div>
  );
}

function jobSearchHaystack(job: JobOrder) {
  return [
    job.jobNumber,
    job.id.slice(0, 8),
    job.title,
    job.clientName,
    job.clientPoNumber,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export default function JobOrderListPage({ mode = 'active' }: JobOrderListPageProps) {
  const archivedOnly = mode === 'archived';
  const [jobs, setJobs] = useState<JobOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [listTab, setListTab] = useState<ListTab>(() =>
    archivedOnly ? 'archived' : tabFromSearch(searchParams.get('tab'))
  );
  const [draftCount, setDraftCount] = useState(0);
  const [archivedCount, setArchivedCount] = useState(0);
  const [releasedCount, setReleasedCount] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<JobOrderStatus[]>([]);
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const [awaitingMaterialOnly, setAwaitingMaterialOnly] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [error, setError] = useState('');
  const [delivering, setDelivering] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);
  const navigate = useNavigate();

  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_STORAGE_KEY, mode);
  };

  const toggleSelected = (jobId: string) =>
    setSelectedKeys((keys) =>
      keys.includes(jobId) ? keys.filter((k) => k !== jobId) : [...keys, jobId]
    );
  const { isAdmin, isOfficeStaff } = useAuth();
  const isPhone = useIsPhone();

  useEffect(() => {
    if (archivedOnly) {
      setListTab('archived');
      return;
    }
    // Old bookmark: send people to the dedicated archived page.
    if (searchParams.get('tab') === 'archived') {
      navigate('/job-orders/archived', { replace: true });
      return;
    }
    const next = tabFromSearch(searchParams.get('tab'));
    setListTab((prev) => (prev === next ? prev : next));
  }, [searchParams, archivedOnly, navigate]);

  const selectListTab = (tab: ListTab) => {
    if (archivedOnly) return;
    setListTab(tab);
    setStatusFilter([]);
    setAwaitingMaterialOnly(false);
    setSelectedKeys([]);
    if (tab === 'drafts') setSearchParams({ tab: 'drafts' }, { replace: true });
    else setSearchParams({}, { replace: true });
  };

  const fetchJobs = async (tab: ListTab = listTab) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await jobOrdersApi.list({
        scope: tab,
        awaitingMaterial: tab === 'production' && awaitingMaterialOnly ? true : undefined,
      });
      setJobs(data);
      if (tab === 'drafts') setDraftCount(data.length);
      else if (tab === 'archived') setArchivedCount(data.length);
      else if (!awaitingMaterialOnly) setReleasedCount(data.length);
    } catch (err) {
      setJobs([]);
      setError(getErrorMessage(err));
      return;
    } finally {
      setLoading(false);
    }
    if (isAdmin || isOfficeStaff) {
      if (tab !== 'drafts') {
        jobOrdersApi
          .list({ scope: 'drafts' })
          .then((drafts) => setDraftCount(drafts.data.length))
          .catch(() => undefined);
      }
      if (tab !== 'archived') {
        jobOrdersApi
          .list({ scope: 'archived' })
          .then((archived) => setArchivedCount(archived.data.length))
          .catch(() => undefined);
      }
    }
  };

  useOverdueCheck();

  useEffect(() => {
    fetchJobs(listTab);
  }, [listTab, awaitingMaterialOnly]);

  const clientOptions = useMemo(() => {
    const names = new Set<string>();
    jobs.forEach((j) => {
      if (j.clientName) names.add(j.clientName);
    });
    return [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ value: name, label: name }));
  }, [jobs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter((job) => {
      if (q && !jobSearchHaystack(job).includes(q)) return false;
      if (statusFilter.length && !statusFilter.includes(job.status)) return false;
      if (clientFilter.length && !clientFilter.includes(job.clientName || '')) return false;
      return true;
    });
  }, [jobs, search, statusFilter, clientFilter]);

  const selectedJobs = useMemo(
    () => filtered.filter((j) => selectedKeys.includes(j.id)),
    [filtered, selectedKeys]
  );
  const selectedCompletable = selectedJobs.filter((j) => j.status === 'COMPLETED');
  const activeFilterCount =
    (statusFilter.length ? 1 : 0) +
    (clientFilter.length ? 1 : 0) +
    (awaitingMaterialOnly ? 1 : 0);
  const overdueCount = filtered.filter(isJobOverdue).length;
  const doneCount = filtered.filter((j) => j.status === 'COMPLETED' || j.status === 'DELIVERED').length;

  const clearJobFilters = () => {
    setStatusFilter([]);
    setClientFilter([]);
    setAwaitingMaterialOnly(false);
  };

  const toggleSelectMode = () => {
    if (selectMode) {
      setSelectMode(false);
      setSelectedKeys([]);
    } else {
      setSelectMode(true);
    }
  };

  const handleBulkDeliver = async () => {
    if (!selectedCompletable.length) {
      message.info('Select completed jobs to set For Delivery.');
      return;
    }
    setDelivering(true);
    try {
      for (const job of selectedCompletable) {
        await jobOrdersApi.deliver(job.id);
      }
      message.success(
        selectedCompletable.length === 1
          ? 'Set For Delivery'
          : `${selectedCompletable.length} jobs set For Delivery`
      );
      setSelectedKeys([]);
      await fetchJobs();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setDelivering(false);
    }
  };

  const handleBulkPrint = () => {
    if (!selectedJobs.length) return;
    selectedJobs.forEach((job) => {
      window.open(`/job-orders/${job.id}/print`, '_blank', 'noopener,noreferrer');
    });
  };

  const [cancelJob, setCancelJob] = useState<JobOrder | null>(null);

  const canCancelJob = (record: JobOrder) =>
    (isOfficeStaff || isAdmin) &&
    record.status !== 'COMPLETED' &&
    record.status !== 'DELIVERED' &&
    record.status !== 'CANCELLED' &&
    !record.salesInvoice;

  const jobActionItems = (record: JobOrder): MenuProps['items'] => {
    const isDraft = record.status === 'DRAFT';

    if (isDraft) {
      const items: MenuProps['items'] = [];
      if (isOfficeStaff || isAdmin) {
        items.push({
          key: 'view',
          icon: <EyeOutlined />,
          label: 'View',
          onClick: () => navigate(`/job-orders/${record.id}`),
        });
        if (isAdmin) {
          items.push({
            key: 'plan',
            icon: <CalendarOutlined />,
            label: 'Plan',
            onClick: () => navigate(`/job-orders/${record.id}/plan`),
          });
        }
        if (isOfficeStaff) {
          items.push({
            key: 'edit',
            icon: <EditOutlined />,
            label: 'Edit details',
            onClick: () => navigate(`/job-orders/${record.id}/edit`),
          });
        }
        if (canCancelJob(record)) {
          items.push({
            key: 'cancel',
            icon: <StopOutlined />,
            label: 'Cancel job order',
            danger: true,
            onClick: () => setCancelJob(record),
          });
        }
      }
      return items;
    }

    const items: MenuProps['items'] = [
      {
        key: 'view',
        icon: <EyeOutlined />,
        label: 'View',
        onClick: () => navigate(`/job-orders/${record.id}`),
      },
    ];
    items.push({
      key: 'print',
      icon: <PrinterOutlined />,
      label: 'Print',
      onClick: () => navigate(`/job-orders/${record.id}/print`),
    });
    if (record.status === 'COMPLETED' && isAdmin) {
      items.push({
        key: 'deliver',
        icon: <CheckOutlined />,
        label: 'Set For Delivery',
        onClick: async () => {
          try {
            await jobOrdersApi.deliver(record.id);
            message.success('Set For Delivery');
            fetchJobs();
          } catch (err) {
            message.error(getErrorMessage(err));
          }
        },
      });
    }
    if (canCancelJob(record)) {
      items.push({
        key: 'cancel',
        icon: <StopOutlined />,
        label: 'Cancel job order',
        danger: true,
        onClick: () => setCancelJob(record),
      });
    }
    if (
      (isOfficeStaff || isAdmin) &&
      (record.status === 'COMPLETED' ||
        record.status === 'DELIVERED' ||
        record.status === 'CANCELLED')
    ) {
      if (record.isArchived || record.archivedAt) {
        items.push({
          key: 'unarchive',
          icon: <InboxOutlined />,
          label: 'Unarchive',
          onClick: async () => {
            try {
              await jobOrdersApi.unarchive(record.id);
              message.success('Job unarchived');
              await fetchJobs();
            } catch (err) {
              message.error(getErrorMessage(err));
            }
          },
        });
      } else {
        items.push({
          key: 'archive',
          icon: <InboxOutlined />,
          label: 'Archive',
          onClick: async () => {
            try {
              await jobOrdersApi.archive(record.id);
              message.success('Job archived');
              await fetchJobs();
            } catch (err) {
              message.error(getErrorMessage(err));
            }
          },
        });
      }
    }
    return items;
  };

  const productionColumns: TableColumnsType<JobOrder> = [
    {
      title: 'Job #',
      dataIndex: 'jobNumber',
      key: 'jobNumber',
      width: 136,
      sorter: (a, b) =>
        (a.jobNumber || a.id).localeCompare(b.jobNumber || b.id, undefined, { numeric: true }),
      render: (n: string, record) => <IdChip>{n || record.id.slice(0, 8).toUpperCase()}</IdChip>,
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      sorter: (a, b) => a.title.localeCompare(b.title),
      render: (t: string) => (
        <EllipsisText title={t}>
          <span style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{t}</span>
        </EllipsisText>
      ),
    },
    {
      title: 'Client',
      dataIndex: 'clientName',
      key: 'clientName',
      width: 160,
      ellipsis: true,
      sorter: (a, b) => (a.clientName || '').localeCompare(b.clientName || ''),
      render: (v: string | undefined) => <EllipsisText>{v || '—'}</EllipsisText>,
    },
    {
      title: 'Last modified',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 124,
      sorter: (a, b) =>
        dayjs(a.updatedAt || a.createdAt).valueOf() - dayjs(b.updatedAt || b.createdAt).valueOf(),
      render: (_: string | null | undefined, record) => {
        const d = record.updatedAt || record.createdAt;
        return (
          <span style={{ fontSize: 13, whiteSpace: 'nowrap', color: '#0f172a' }}>
            {d && dayjs(d).isValid() ? formatShop(d, 'MMM D, YYYY') : '—'}
          </span>
        );
      },
    },
    {
      title: 'Due Date',
      dataIndex: 'dueDate',
      key: 'dueDate',
      width: 112,
      defaultSortOrder: 'ascend',
      sorter: compareByDue,
      render: (_d: string, record) => <DuePill job={record} />,
    },
    {
      title: (
        <Tooltip title={`Scheduled finish, and the estimated finish. ${ESTIMATE_HINT}`}>
          <span>Finish</span>
        </Tooltip>
      ),
      key: 'finish',
      width: 124,
      render: (_: unknown, record) => <FinishCell job={record} />,
    },
    {
      title: 'Progress',
      key: 'progress',
      width: 82,
      sorter: (a, b) => {
        const pa = a.opsTotal ? (a.opsCompleted || 0) / a.opsTotal : 0;
        const pb = b.opsTotal ? (b.opsCompleted || 0) / b.opsTotal : 0;
        return pa - pb;
      },
      render: (_: unknown, record) => {
        const total = record.opsTotal || 0;
        const done = record.opsCompleted || 0;
        const pct = total ? Math.round((done / total) * 100) : 0;
        return (
          <div>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.2, marginBottom: 4 }}>
              {done}/{total} ops
            </div>
            <div
              style={{
                width: '100%',
                maxWidth: 56,
                height: 3,
                borderRadius: 999,
                background: '#f1f5f9',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: '#2563eb',
                  borderRadius: 999,
                }}
              />
            </div>
          </div>
        );
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 150,
      render: (_s: JobOrderStatus, record) => <JobStatusBadge job={record} />,
    },
    {
      title: '',
      key: 'actions',
      width: 40,
      align: 'center',
      render: (_: unknown, record) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Dropdown menu={{ items: jobActionItems(record) }} trigger={['click']} placement="bottomRight">
            <Button
              type="text"
              size="small"
              icon={<MoreOutlined style={{ fontSize: 18 }} />}
              aria-label="More actions"
            />
          </Dropdown>
        </div>
      ),
    },
  ];

  const draftColumns: TableColumnsType<JobOrder> = [
    productionColumns[0],
    productionColumns[1],
    productionColumns[2],
    {
      title: 'Stage',
      key: 'draftStage',
      width: 200,
      ellipsis: true,
      render: (_: unknown, record) => (
        <span style={{ fontSize: 13, color: '#475569' }}>{record.draftStage || '—'}</span>
      ),
    },
    {
      title: 'Created by',
      key: 'createdByName',
      width: 120,
      ellipsis: true,
      render: (_: unknown, record) => (
        <span style={{ fontSize: 13 }}>{record.createdByName || '—'}</span>
      ),
    },
    {
      title: 'Last modified',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 124,
      sorter: (a, b) =>
        dayjs(a.updatedAt || a.createdAt).valueOf() - dayjs(b.updatedAt || b.createdAt).valueOf(),
      render: (_: string | null | undefined, record) => {
        const d = record.updatedAt || record.createdAt;
        return (
          <span style={{ fontSize: 13, whiteSpace: 'nowrap', color: '#0f172a' }}>
            {d && dayjs(d).isValid() ? formatShop(d, 'MMM D, YYYY') : '—'}
          </span>
        );
      },
    },
    productionColumns[productionColumns.length - 1],
  ];

  const columns = listTab === 'drafts' ? draftColumns : productionColumns;

  const listTabs =
    !archivedOnly && (isAdmin || isOfficeStaff) ? (
      <div style={{ marginBottom: isPhone ? 10 : 14 }}>
        <TabBar<ListTab>
          block={isPhone}
          value={listTab === 'archived' ? 'production' : listTab}
          onChange={selectListTab}
          items={[
            { label: 'Released', value: 'production', count: releasedCount },
            {
              label: isAdmin ? 'To plan' : 'Pending',
              value: 'drafts',
              count: draftCount,
              countTone: draftCount > 0 ? 'red' : undefined,
            },
          ]}
        />
      </div>
    ) : null;

  const openJob = (job: JobOrder) => {
    if (job.status === 'DRAFT' && isAdmin) navigate(`/job-orders/${job.id}/plan`);
    else navigate(`/job-orders/${job.id}`);
  };

  return (
    <div className="jo-list-page">
      {listTabs}
      {isPhone ? (
        <div className="sched-m jo-m-chrome">
          <div className="sched-m__top">
            <div className="jo-m__nav">
              <Input
                allowClear
                variant="borderless"
                prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                placeholder="Search jobs…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="jo-m__search"
              />
              {isOfficeStaff && (
                <button
                  type="button"
                  className="sched-m__icon jo-m__add"
                  onClick={() => navigate('/job-orders/new')}
                  aria-label="New job order"
                >
                  <PlusOutlined />
                </button>
              )}
              <button
                type="button"
                className={`sched-m__icon${selectMode ? ' is-on' : ''}`}
                onClick={toggleSelectMode}
                aria-label={selectMode ? 'Done selecting' : 'Select multiple'}
              >
                <SelectMultipleIcon />
              </button>
              <Badge count={activeFilterCount} size="small" offset={[-4, 4]} className="sched-m__filter">
                <button
                  type="button"
                  className="sched-m__icon"
                  onClick={() => setFiltersOpen(true)}
                  aria-label="Filters"
                >
                  <FilterOutlined />
                </button>
              </Badge>
            </div>
          </div>
          <div className="sched-m__stats">
            <div className="sched-m__stat">
              <div className="sched-m__stat-n">{loading ? '—' : filtered.length}</div>
              <div className="sched-m__stat-l">Jobs</div>
            </div>
            <div className={`sched-m__stat${overdueCount ? ' is-danger' : ''}`}>
              <div className="sched-m__stat-n">{loading ? '—' : overdueCount}</div>
              <div className="sched-m__stat-l">Overdue</div>
            </div>
            <div className="sched-m__stat">
              <div className="sched-m__stat-n">{loading ? '—' : doneCount}</div>
              <div className="sched-m__stat-l">Done</div>
            </div>
          </div>
          {selectMode ? (
            <div className="jo-m__bulk">
              <span className="jo-m__bulk-count">{selectedKeys.length} selected</span>
              {listTab !== 'drafts' ? (
                <>
                  <Button
                    size="small"
                    icon={<PrinterOutlined />}
                    disabled={!selectedJobs.length}
                    onClick={handleBulkPrint}
                  >
                    Print
                  </Button>
                  {isAdmin ? (
                    <Button
                      size="small"
                      icon={<CheckOutlined />}
                      loading={delivering}
                      disabled={!selectedCompletable.length}
                      onClick={handleBulkDeliver}
                    >
                      Set For Delivery
                      {selectedCompletable.length ? ` (${selectedCompletable.length})` : ''}
                    </Button>
                  ) : null}
                </>
              ) : (
                <span className="jo-m__bulk-count" style={{ opacity: 0.7 }}>
                  Cancel jobs one at a time from the menu
                </span>
              )}
            </div>
          ) : null}
        </div>
      ) : (
      <div className="jo-list-toolbar">
        <div className="jo-list-filters">
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
            placeholder="Search job #, title, client, PO…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="jo-list-search"
          />
          {listTab === 'production' && (
          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            placeholder="Status"
            className="jo-list-filter"
            value={statusFilter}
            onChange={setStatusFilter}
            options={PRODUCTION_STATUS_OPTIONS}
          />
          )}
          {listTab === 'production' && (
            <Select
              allowClear
              placeholder="Material"
              className="jo-list-filter jo-list-filter--sm"
              value={awaitingMaterialOnly ? 'awaiting' : undefined}
              onChange={(v) => setAwaitingMaterialOnly(v === 'awaiting')}
              options={[{ value: 'awaiting', label: 'Awaiting material' }]}
            />
          )}
          <Select
            mode="multiple"
            allowClear
            showSearch
            optionFilterProp="label"
            maxTagCount="responsive"
            placeholder="Client"
            className="jo-list-filter"
            value={clientFilter}
            onChange={setClientFilter}
            options={clientOptions}
          />
        </div>
        <div className="jo-list-actions">
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              selectable: true,
              selectedKeys: [viewMode],
              items: VIEW_OPTIONS.map((o) => ({ key: o.key, label: o.label, icon: o.icon })),
              onClick: ({ key }) => changeViewMode(key as ViewMode),
            }}
          >
            <Tooltip title="View">
              <Button
                icon={VIEW_OPTIONS.find((o) => o.key === viewMode)?.icon}
                aria-label="Change view"
              />
            </Tooltip>
          </Dropdown>
          <Tooltip title={selectMode ? 'Done selecting' : 'Select multiple'}>
            <Button
              icon={<SelectMultipleIcon />}
              type={selectMode ? 'primary' : 'default'}
              ghost={selectMode}
              onClick={toggleSelectMode}
              aria-label={selectMode ? 'Done selecting' : 'Select multiple'}
            />
          </Tooltip>
          {!archivedOnly ? (
            <Button type="link" onClick={() => navigate('/job-orders/archived')}>
              Archived{archivedCount ? ` (${archivedCount})` : ''}
            </Button>
          ) : (
            <Button type="link" onClick={() => navigate('/job-orders')}>
              Back to job orders
            </Button>
          )}
          {isOfficeStaff && !archivedOnly && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/job-orders/new')}
              style={{ fontWeight: 700 }}
            >
              New Job Order
            </Button>
          )}
        </div>
      </div>
      )}

      {selectMode && !isPhone && (
        <div className="jo-list-bulk">
          <span className="jo-list-bulk__count">
            {selectedKeys.length}
            {' selected'}
            {selectedKeys.length > 0 && selectedJobs.length !== selectedKeys.length
              ? ` (${selectedJobs.length} in view)`
              : ''}
          </span>
          <Space size={8}>
            {listTab !== 'drafts' ? (
              <>
                <Button
                  size="small"
                  icon={<PrinterOutlined />}
                  disabled={!selectedJobs.length}
                  onClick={handleBulkPrint}
                >
                  Print
                </Button>
                {isAdmin ? (
                  <Button
                    size="small"
                    icon={<CheckOutlined />}
                    loading={delivering}
                    disabled={!selectedCompletable.length}
                    onClick={handleBulkDeliver}
                  >
                    Set For Delivery
                    {selectedCompletable.length ? ` (${selectedCompletable.length})` : ''}
                  </Button>
                ) : null}
              </>
            ) : null}
            {selectedKeys.length > 0 && (
              <Button size="small" type="text" onClick={() => setSelectedKeys([])}>
                Clear
              </Button>
            )}
          </Space>
        </div>
      )}

      {error ? (
        <Alert
          type="error"
          showIcon
          title="Job orders could not be loaded"
          description={error}
          action={
            <Button type="primary" onClick={() => fetchJobs(listTab)}>
              Try again
            </Button>
          }
        />
      ) : isPhone ? (
        <div className="admin-cards">
          {loading && (
            <div className="page-spinner">
              <Spin />
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="admin-cards__empty">No job orders match your filters yet</div>
          )}
          {!loading &&
            filtered.map((job) => {
              const selected = selectedKeys.includes(job.id);
              return (
                <div
                  key={job.id}
                  className="admin-card"
                  style={selected ? { borderColor: '#2563eb', background: '#eff6ff' } : undefined}
                  onClick={() => {
                    if (selectMode) {
                      setSelectedKeys((keys) =>
                        keys.includes(job.id) ? keys.filter((k) => k !== job.id) : [...keys, job.id]
                      );
                      return;
                    }
                    openJob(job);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="admin-card__top">
                    <div>
                      <div className="admin-card__kicker">
                        {job.jobNumber || job.id.slice(0, 8).toUpperCase()}
                      </div>
                      <div className="admin-card__title">{job.title}</div>
                      <div className="admin-card__meta">
                        {job.clientName || 'No client'}
                        {' · '}
                        Due {formatShop(job.dueDate, 'MMM D')}
                        {job.opsTotal ? ` · ${job.opsCompleted || 0}/${job.opsTotal} ops` : ''}
                      </div>
                    </div>
                    <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <JobStatusBadge job={job} />
                      {listTab === 'drafts' && job.draftStage ? (
                        <span style={{ fontSize: 11, color: '#64748b' }}>{job.draftStage}</span>
                      ) : null}
                      <Dropdown menu={{ items: jobActionItems(job) }} trigger={['click']} placement="bottomRight">
                        <Button type="text" size="small" icon={<MoreOutlined style={{ fontSize: 18 }} />} aria-label="More actions" />
                      </Dropdown>
                    </div>
                  </div>
                  <div className="admin-card__row">
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      {(() => {
                        const d = job.updatedAt || job.createdAt;
                        return d && dayjs(d).isValid()
                          ? `Modified ${formatShop(d, 'MMM D, YYYY')}`
                          : '—';
                      })()}
                    </span>
                  </div>
                </div>
              );
            })}
        </div>
      ) : viewMode === 'cards' ? (
        <div className="jo-cards">
          {loading && (
            <div className="page-spinner">
              <Spin />
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="jo-cards__empty">No job orders match your filters yet</div>
          )}
          {!loading &&
            filtered.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                isDraftTab={listTab === 'drafts'}
                selected={selectedKeys.includes(job.id)}
                actions={jobActionItems(job)}
                onClick={() => (selectMode ? toggleSelected(job.id) : openJob(job))}
              />
            ))}
          {!loading && filtered.length > 0 && (
            <div className="jo-cards__total">
              {filtered.length} job{filtered.length === 1 ? '' : 's'}
            </div>
          )}
        </div>
      ) : (
      <Table
        className="jo-list-table"
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={filtered}
        loading={loading}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50],
          showTotal: (total) => `${total} job${total === 1 ? '' : 's'}`,
        }}
        locale={{ emptyText: 'No job orders match your filters yet' }}
        showSorterTooltip={false}
        tableLayout="fixed"
        rowSelection={
          selectMode
            ? {
                selectedRowKeys: selectedKeys,
                onChange: (keys) => setSelectedKeys(keys.map(String)),
                preserveSelectedRowKeys: true,
              }
            : undefined
        }
        onRow={(record) => ({
          onClick: () => openJob(record),
          style: { cursor: 'pointer' },
        })}
      />
      )}
      {isPhone ? (
        <Drawer
          className="sched-f-drawer"
          rootClassName="sched-f-drawer"
          placement="bottom"
          size="auto"
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          closable={false}
          title={null}
          styles={{
            section: {
              padding: 0,
              borderRadius: '16px 16px 0 0',
              overflow: 'hidden',
              background: '#f1f5f9',
            },
            header: { display: 'none', padding: 0 },
            body: { padding: 0, background: '#f1f5f9' },
          }}
        >
          <div className="sched-f">
            <div className="sched-f__handle" />
            <div className="sched-f__head">
              <div>
                <div className="sched-f__title">Filters</div>
                <div className="sched-f__sub">{activeFilterCount ? `${activeFilterCount} on` : 'None on'}</div>
              </div>
              {activeFilterCount ? (
                <button type="button" className="sched-f__text" onClick={clearJobFilters}>
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                className="sched-m__icon"
                onClick={() => setFiltersOpen(false)}
                aria-label="Close"
              >
                <CloseOutlined />
              </button>
            </div>
            <div className="sched-f__card">
              <div className="sched-f__label">Narrow by</div>
              <div className="sched-f__rows">
                {listTab === 'production' ? (
                <div className="sched-f__row">
                  <span className="sched-f__row-k">Status</span>
                  <Select
                    mode="multiple"
                    allowClear
                    variant="borderless"
                    maxTagCount={1}
                    placeholder="All"
                    className="sched-f__select"
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={PRODUCTION_STATUS_OPTIONS}
                  />
                </div>
                ) : null}
                {listTab === 'production' ? (
                <div className="sched-f__row">
                  <span className="sched-f__row-k">Material</span>
                  <Select
                    allowClear
                    variant="borderless"
                    placeholder="All"
                    className="sched-f__select"
                    value={awaitingMaterialOnly ? 'awaiting' : undefined}
                    onChange={(v) => setAwaitingMaterialOnly(v === 'awaiting')}
                    options={[{ value: 'awaiting', label: 'Awaiting material' }]}
                  />
                </div>
                ) : null}
                <div className="sched-f__row">
                  <span className="sched-f__row-k">Client</span>
                  <Select
                    mode="multiple"
                    allowClear
                    showSearch
                    variant="borderless"
                    optionFilterProp="label"
                    maxTagCount={1}
                    placeholder="All"
                    className="sched-f__select"
                    value={clientFilter}
                    onChange={setClientFilter}
                    options={clientOptions}
                  />
                </div>
              </div>
            </div>
            <button type="button" className="sched-f__done" onClick={() => setFiltersOpen(false)}>
              Done
            </button>
          </div>
        </Drawer>
      ) : null}

      {cancelJob ? (
        <CancelJobModal
          job={cancelJob}
          open
          onClose={() => setCancelJob(null)}
          onCancelled={async () => {
            setCancelJob(null);
            setSelectedKeys((keys) => keys.filter((k) => k !== cancelJob.id));
            await fetchJobs();
          }}
        />
      ) : null}
    </div>
  );
}
