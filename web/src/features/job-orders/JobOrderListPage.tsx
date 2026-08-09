import { useEffect, useState } from 'react';
import { Table, Button, Typography, Select } from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import StatusPill, { type PillColor } from '../../components/StatusPill';
import type { JobOrder, JobOrderStatus, JobPriority } from '../../types';

const statusStyle: Record<JobOrderStatus, { label: string; color: PillColor }> = {
  UNASSIGNED: { label: 'Unassigned', color: 'gray' },
  ASSIGNED: { label: 'Assigned', color: 'blue' },
  IN_PROGRESS: { label: 'In Progress', color: 'blue' },
  COMPLETED: { label: 'Completed', color: 'green' },
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

export default function JobOrderListPage() {
  const [jobs, setJobs] = useState<JobOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const { data } = await jobOrdersApi.list(statusFilter);
      setJobs(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [statusFilter]);

  const columns = [
    {
      title: 'Job #',
      dataIndex: 'jobNumber',
      key: 'jobNumber',
      width: 120,
      render: (n: string, record: JobOrder) => (
        <span style={{ fontWeight: 600, color: '#64748b', fontSize: 12 }}>
          {n || record.id.slice(0, 8).toUpperCase()}
        </span>
      ),
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      width: 240,
      ellipsis: true,
      render: (t: string) => (
        <span style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{t}</span>
      ),
    },
    {
      title: 'Client',
      dataIndex: 'clientName',
      key: 'clientName',
      width: 160,
      ellipsis: true,
      render: (v: string | undefined) => (
        <span style={{ fontSize: 14, color: '#0f172a' }}>{v || '—'}</span>
      ),
    },
    {
      title: 'Qty',
      key: 'quantity',
      width: 72,
      render: (_: unknown, record: JobOrder) => (
        <span style={{ fontSize: 13 }}>
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
      width: 104,
      render: (a: number | null | undefined) => (
        <span style={{ fontSize: 13 }}>{formatAmount(a)}</span>
      ),
    },
    {
      title: 'Priority',
      dataIndex: 'priority',
      key: 'priority',
      width: 96,
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
      render: (d: string, record: JobOrder) => {
        const overdue = record.status !== 'COMPLETED' && dayjs(d).isBefore(dayjs(), 'day');
        return (
          <span
            style={{
              fontSize: 13,
              color: overdue ? '#dc2626' : '#0f172a',
              fontWeight: overdue ? 600 : 400,
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
      width: 100,
      render: (_: unknown, record: JobOrder) => {
        const total = record.opsTotal || 0;
        const done = record.opsCompleted || 0;
        const pct = total ? Math.round((done / total) * 100) : 0;
        return (
          <div>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.2, marginBottom: 4 }}>
              {done} / {total} ops
            </div>
            <div
              style={{
                width: 56,
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
      width: 104,
      render: (s: JobOrderStatus, record: JobOrder) => {
        const overdue = s !== 'COMPLETED' && dayjs(record.dueDate).isBefore(dayjs(), 'day');
        if (overdue) return <StatusPill color="red" compact>Overdue</StatusPill>;
        const st = statusStyle[s];
        return <StatusPill color={st.color} compact>{st.label}</StatusPill>;
      },
    },
    {
      title: 'Next Worker',
      dataIndex: 'nextOperationWorkerName',
      key: 'nextOperationWorkerName',
      width: 150,
      ellipsis: true,
      render: (v: string | undefined | null) => (
        <span style={{ fontSize: 14, color: '#0f172a' }}>{v || '—'}</span>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      fixed: 'right' as const,
      width: 88,
      render: (_: unknown, record: JobOrder) => (
        <Button
          size="small"
          icon={<EditOutlined />}
          className="jo-list-edit-btn"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/job-orders/${record.id}/edit`);
          }}
        >
          Edit
        </Button>
      ),
    },
  ];

  return (
    <div className="jo-list-page">
      <div className="jo-list-toolbar">
        <Select
          allowClear
          placeholder="All statuses"
          className="jo-list-filter"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'UNASSIGNED', label: 'Unassigned' },
            { value: 'ASSIGNED', label: 'Assigned' },
            { value: 'IN_PROGRESS', label: 'In Progress' },
            { value: 'COMPLETED', label: 'Completed' },
          ]}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => navigate('/job-orders/new')}
          style={{ fontWeight: 700 }}
        >
          New Job Order
        </Button>
      </div>

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
        dataSource={jobs}
        loading={loading}
        pagination={false}
        locale={{ emptyText: 'No job orders found' }}
        scroll={{ x: 1450 }}
        onRow={(record) => ({
          onClick: () => navigate(`/job-orders/${record.id}/edit`),
          style: { cursor: 'pointer' },
        })}
      />
    </div>
  );
}
