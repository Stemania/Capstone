import { useEffect, useMemo, useState } from 'react';
import { Table, Button, Typography, Select, Dropdown, Input, Space, message } from 'antd';
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
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { scheduleFlagStyle } from '../../utils/shopTime';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import StatusPill, { type PillColor } from '../../components/StatusPill';
import { useAuth } from '../../hooks/useAuth';
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
  const [error, setError] = useState('');
  const [delivering, setDelivering] = useState(false);
  const navigate = useNavigate();
  const { isAdmin, isOfficeStaff } = useAuth();

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
      render: (s: JobOrderStatus, record) => {
        if (PLANNING_STATUSES.has(s)) {
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
              {s === 'DRAFT' ? 'Draft' : 'Planning'}
            </span>
          );
        }
        const overdue =
          s !== 'COMPLETED' &&
          s !== 'DELIVERED' &&
          dayjs(record.dueDate).isBefore(dayjs(), 'day');
        if (overdue) return <StatusPill color="red" compact>Overdue</StatusPill>;
        const st = statusStyle[s] || statusStyle.RELEASED;
        return <StatusPill color={st.color} compact>{st.label}</StatusPill>;
      },
    },
    {
      title: '',
      key: 'actions',
      width: 40,
      align: 'center',
      render: (_: unknown, record) => {
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
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
              <Button
                type="text"
                size="small"
                icon={<MoreOutlined style={{ fontSize: 18 }} />}
                aria-label="More actions"
              />
            </Dropdown>
          </div>
        );
      },
    },
  ];

  return (
    <div className="jo-list-page">
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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            icon={<CheckSquareOutlined />}
            type={selectMode ? 'primary' : 'default'}
            ghost={selectMode}
            onClick={() => {
              if (selectMode) {
                setSelectMode(false);
                setSelectedKeys([]);
              } else {
                setSelectMode(true);
              }
            }}
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

      {selectMode && (
        <div className="jo-list-bulk">
          <span className="jo-list-bulk__count">
            {selectedKeys.length
              ? `${selectedKeys.length} selected${
                  selectedJobs.length !== selectedKeys.length
                    ? ` (${selectedJobs.length} in view)`
                    : ''
                }`
              : 'Select jobs to print or mark delivered'}
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
    </div>
  );
}
