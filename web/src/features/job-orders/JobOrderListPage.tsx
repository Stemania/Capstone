import { useEffect, useMemo, useState } from 'react';
import { Table, Button, Typography, Select, Dropdown, Input, Space, Spin, message, Drawer, Badge } from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  CheckOutlined,
  PrinterOutlined,
  EyeOutlined,
  CalendarOutlined,
  MoreOutlined,
  SearchOutlined,
  CheckSquareOutlined,
  FilterOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { scheduleFlagStyle } from '../../utils/shopTime';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import StatusPill, { type PillColor } from '../../components/StatusPill';
import { useAuth } from '../../hooks/useAuth';
import { useIsPhone } from '../../hooks/useIsPhone';
import type { JobOrder, JobOrderStatus, JobPriority } from '../../types';

const PLANNING_STATUSES = new Set<JobOrderStatus>(['DRAFT', 'PLANNING']);

const STATUS_OPTIONS: { value: JobOrderStatus; label: string }[] = [
  { value: 'DRAFT', label: 'Internal draft' },
  { value: 'PLANNING', label: 'Internal planning' },
  { value: 'RELEASED', label: 'Released' },
  { value: 'UNASSIGNED', label: 'Unassigned' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'DELIVERED', label: 'Delivered' },
];

const statusStyle: Record<JobOrderStatus, { label: string; color: PillColor }> = {
  DRAFT: { label: 'Draft', color: 'gray' },
  PLANNING: { label: 'Planning', color: 'gray' },
  RELEASED: { label: 'Released', color: 'blue' },
  UNASSIGNED: { label: 'Unassigned', color: 'gray' },
  ASSIGNED: { label: 'Assigned', color: 'blue' },
  IN_PROGRESS: { label: 'In Progress', color: 'blue' },
  COMPLETED: { label: 'Completed', color: 'green' },
  DELIVERED: { label: 'Delivered', color: 'green' },
};

const priorityStyle: Record<JobPriority, { label: string; color: PillColor }> = {
  HIGH: { label: 'High', color: 'red' },
  MODERATE: { label: 'Moderate', color: 'amber' },
  LOW: { label: 'Low', color: 'green' },
};

function formatAmount(n?: number | null) {
  if (n == null) return '—';
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function isJobOverdue(job: JobOrder) {
  return (
    job.status !== 'COMPLETED' &&
    job.status !== 'DELIVERED' &&
    dayjs(job.dueDate).isBefore(dayjs(), 'day')
  );
}

function JobStatusBadge({ job }: { job: JobOrder }) {
  if (PLANNING_STATUSES.has(job.status)) {
    return (
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
          color: '#94a3b8',
          whiteSpace: 'nowrap',
        }}
      >
        {job.status === 'DRAFT' ? 'Draft' : 'Planning'}
      </span>
    );
  }
  const overdue = isJobOverdue(job);
  if (overdue) return <StatusPill color="red" compact>Overdue</StatusPill>;
  const st = statusStyle[job.status] || statusStyle.RELEASED;
  return <StatusPill color={st.color} compact>{st.label}</StatusPill>;
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

export default function JobOrderListPage() {
  const [jobs, setJobs] = useState<JobOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobOrderStatus[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<JobPriority[]>([]);
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [error, setError] = useState('');
  const [delivering, setDelivering] = useState(false);
  const navigate = useNavigate();
  const { isAdmin, isOfficeStaff } = useAuth();
  const isPhone = useIsPhone();

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const { data } = await jobOrdersApi.list();
      setJobs(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

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
      if (priorityFilter.length && !priorityFilter.includes(job.priority || 'MODERATE')) return false;
      if (clientFilter.length && !clientFilter.includes(job.clientName || '')) return false;
      return true;
    });
  }, [jobs, search, statusFilter, priorityFilter, clientFilter]);

  const selectedJobs = useMemo(
    () => filtered.filter((j) => selectedKeys.includes(j.id)),
    [filtered, selectedKeys]
  );
  const selectedCompletable = selectedJobs.filter((j) => j.status === 'COMPLETED');
  const activeFilterCount =
    (statusFilter.length ? 1 : 0) + (priorityFilter.length ? 1 : 0) + (clientFilter.length ? 1 : 0);
  const overdueCount = filtered.filter(isJobOverdue).length;
  const doneCount = filtered.filter((j) => j.status === 'COMPLETED' || j.status === 'DELIVERED').length;

  const clearJobFilters = () => {
    setStatusFilter([]);
    setPriorityFilter([]);
    setClientFilter([]);
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
      message.info('Select completed jobs to mark delivered.');
      return;
    }
    setDelivering(true);
    try {
      for (const job of selectedCompletable) {
        await jobOrdersApi.deliver(job.id);
      }
      message.success(
        selectedCompletable.length === 1
          ? 'Marked delivered'
          : `Marked ${selectedCompletable.length} jobs delivered`
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

  const jobActionItems = (record: JobOrder): MenuProps['items'] => {
    const planning = PLANNING_STATUSES.has(record.status);
    const items: MenuProps['items'] = [
      {
        key: 'view',
        icon: <EyeOutlined />,
        label: 'View',
        onClick: () => navigate(`/job-orders/${record.id}`),
      },
    ];
    if (planning && isAdmin) {
      items.push({
        key: 'plan',
        icon: <CalendarOutlined />,
        label: 'Plan operations',
        onClick: () => navigate(`/job-orders/${record.id}/plan`),
      });
    }
    if (isOfficeStaff || isAdmin) {
      items.push({
        key: 'edit',
        icon: <EditOutlined />,
        label: planning ? 'Edit PO' : 'Edit',
        onClick: () => navigate(`/job-orders/${record.id}/edit`),
      });
    }
    items.push({
      key: 'print',
      icon: <PrinterOutlined />,
      label: 'Print',
      onClick: () => navigate(`/job-orders/${record.id}/print`),
    });
    if (record.status === 'COMPLETED') {
      items.push({ type: 'divider' });
      items.push({
        key: 'deliver',
        icon: <CheckOutlined />,
        label: 'Mark delivered',
        onClick: async () => {
          try {
            await jobOrdersApi.deliver(record.id);
            message.success('Marked delivered');
            fetchJobs();
          } catch (err) {
            message.error(getErrorMessage(err));
          }
        },
      });
    }
    return items;
  };

  const columns: TableColumnsType<JobOrder> = [
    {
      title: 'Job #',
      dataIndex: 'jobNumber',
      key: 'jobNumber',
      width: 108,
      sorter: (a, b) =>
        (a.jobNumber || a.id).localeCompare(b.jobNumber || b.id, undefined, { numeric: true }),
      render: (n: string, record) => (
        <span style={{ fontWeight: 600, color: '#64748b', fontSize: 12 }}>
          {n || record.id.slice(0, 8).toUpperCase()}
        </span>
      ),
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      sorter: (a, b) => a.title.localeCompare(b.title),
      render: (t: string) => (
        <span style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{t}</span>
      ),
    },
    {
      title: 'Client',
      dataIndex: 'clientName',
      key: 'clientName',
      ellipsis: true,
      sorter: (a, b) => (a.clientName || '').localeCompare(b.clientName || ''),
      render: (v: string | undefined) => (
        <span style={{ fontSize: 14, color: '#0f172a' }}>{v || '—'}</span>
      ),
    },
    {
      title: 'Qty',
      key: 'quantity',
      width: 72,
      sorter: (a, b) => (a.quantity ?? 0) - (b.quantity ?? 0),
      render: (_: unknown, record) => (
        <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
          {record.quantity != null
            ? `${record.quantity}${record.unitOfMeasure ? ` ${record.unitOfMeasure}` : ''}`
            : '—'}
        </span>
      ),
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      width: 100,
      sorter: (a, b) => (a.amount ?? 0) - (b.amount ?? 0),
      render: (a: number | null | undefined) => (
        <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{formatAmount(a)}</span>
      ),
    },
    {
      title: 'Priority',
      dataIndex: 'priority',
      key: 'priority',
      width: 90,
      render: (p: JobPriority | undefined) => {
        const st = priorityStyle[p || 'MODERATE'];
        return <StatusPill color={st.color} compact>{st.label}</StatusPill>;
      },
    },
    {
      title: 'Due Date',
      dataIndex: 'dueDate',
      key: 'dueDate',
      width: 112,
      defaultSortOrder: 'ascend',
      sorter: (a, b) => dayjs(a.dueDate).valueOf() - dayjs(b.dueDate).valueOf(),
      render: (d: string, record) => {
        const flag = record.scheduleFlag;
        const st = flag ? scheduleFlagStyle[flag] : null;
        return (
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
            {dayjs(d).format('MMM D, YYYY')}
          </span>
        );
      },
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
      width: 108,
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

  return (
    <div className="jo-list-page">
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
              <button
                type="button"
                className="sched-m__icon jo-m__add"
                onClick={() => navigate('/job-orders/new')}
                aria-label="New job order"
              >
                <PlusOutlined />
              </button>
              <button
                type="button"
                className={`sched-m__icon${selectMode ? ' is-on' : ''}`}
                onClick={toggleSelectMode}
                aria-label={selectMode ? 'Done selecting' : 'Select multiple'}
              >
                <CheckOutlined />
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
              <Button
                size="small"
                icon={<PrinterOutlined />}
                disabled={!selectedJobs.length}
                onClick={handleBulkPrint}
              >
                Print
              </Button>
              <Button
                size="small"
                icon={<CheckOutlined />}
                loading={delivering}
                disabled={!selectedCompletable.length}
                onClick={handleBulkDeliver}
              >
                Deliver{selectedCompletable.length ? ` (${selectedCompletable.length})` : ''}
              </Button>
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
          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            placeholder="Status"
            className="jo-list-filter"
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_OPTIONS}
          />
          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            placeholder="Priority"
            className="jo-list-filter jo-list-filter--sm"
            value={priorityFilter}
            onChange={setPriorityFilter}
            options={[
              { value: 'HIGH', label: 'High' },
              { value: 'MODERATE', label: 'Moderate' },
              { value: 'LOW', label: 'Low' },
            ]}
          />
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
          <Button
            icon={<CheckSquareOutlined />}
            type={selectMode ? 'primary' : 'default'}
            ghost={selectMode}
            onClick={toggleSelectMode}
          >
            {selectMode ? 'Done selecting' : 'Select multiple'}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/job-orders/new')}
            style={{ fontWeight: 700 }}
          >
            New Job Order
          </Button>
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
            <Button
              size="small"
              icon={<PrinterOutlined />}
              disabled={!selectedJobs.length}
              onClick={handleBulkPrint}
            >
              Print
            </Button>
            <Button
              size="small"
              icon={<CheckOutlined />}
              loading={delivering}
              disabled={!selectedCompletable.length}
              onClick={handleBulkDeliver}
            >
              Mark delivered{selectedCompletable.length ? ` (${selectedCompletable.length})` : ''}
            </Button>
            {selectedKeys.length > 0 && (
              <Button size="small" type="text" onClick={() => setSelectedKeys([])}>
                Clear
              </Button>
            )}
          </Space>
        </div>
      )}

      {error && (
        <Typography.Text type="danger" style={{ display: 'block', marginBottom: 12 }}>
          {error}
        </Typography.Text>
      )}

      {isPhone ? (
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
              const pri = priorityStyle[job.priority || 'MODERATE'];
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
                    navigate(`/job-orders/${job.id}`);
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
                        Due {dayjs(job.dueDate).format('MMM D')}
                        {job.opsTotal ? ` · ${job.opsCompleted || 0}/${job.opsTotal} ops` : ''}
                      </div>
                    </div>
                    <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <JobStatusBadge job={job} />
                      <Dropdown menu={{ items: jobActionItems(job) }} trigger={['click']} placement="bottomRight">
                        <Button type="text" size="small" icon={<MoreOutlined style={{ fontSize: 18 }} />} aria-label="More actions" />
                      </Dropdown>
                    </div>
                  </div>
                  <div className="admin-card__row">
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#0f1c2e' }}>{formatAmount(job.amount)}</span>
                    <StatusPill color={pri.color} compact>
                      {pri.label}
                    </StatusPill>
                  </div>
                </div>
              );
            })}
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
          onClick: () => navigate(`/job-orders/${record.id}`),
          style: { cursor: 'pointer' },
        })}
      />
      )}
      {isPhone ? (
        <Drawer
          className="sched-f-drawer"
          rootClassName="sched-f-drawer"
          placement="bottom"
          height="auto"
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          closable={false}
          title={null}
          styles={{
            container: {
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
                    options={STATUS_OPTIONS}
                  />
                </div>
                <div className="sched-f__row">
                  <span className="sched-f__row-k">Priority</span>
                  <Select
                    mode="multiple"
                    allowClear
                    variant="borderless"
                    maxTagCount={1}
                    placeholder="All"
                    className="sched-f__select"
                    value={priorityFilter}
                    onChange={setPriorityFilter}
                    options={[
                      { value: 'HIGH', label: 'High' },
                      { value: 'MODERATE', label: 'Moderate' },
                      { value: 'LOW', label: 'Low' },
                    ]}
                  />
                </div>
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
    </div>
  );
}
