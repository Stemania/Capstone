import { useEffect, useState } from 'react';
import { Table, Button, Typography, Space, Select } from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import StatusPill, { type PillColor } from '../../components/StatusPill';
import type { JobOrder, JobOrderStatus } from '../../types';

const statusStyle: Record<JobOrderStatus, { label: string; color: PillColor }> = {
  UNASSIGNED: { label: 'Unassigned', color: 'gray' },
  ASSIGNED: { label: 'Assigned', color: 'blue' },
  IN_PROGRESS: { label: 'In Progress', color: 'green' },
  COMPLETED: { label: 'Completed', color: 'gray' },
};

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
      render: (t: string) => <span style={{ fontWeight: 600 }}>{t}</span>,
    },
    { title: 'Client', dataIndex: 'clientName', key: 'clientName' },
    {
      title: 'Due Date',
      dataIndex: 'dueDate',
      key: 'dueDate',
      render: (d: string, record: JobOrder) => {
        const overdue = record.status !== 'COMPLETED' && dayjs(d).isBefore(dayjs(), 'day');
        return (
          <span style={{ color: overdue ? '#dc2626' : undefined, fontWeight: overdue ? 600 : 400 }}>
            {dayjs(d).format('MMM D, YYYY')}
          </span>
        );
      },
    },
    {
      title: 'Progress',
      key: 'progress',
      render: (_: unknown, record: JobOrder) => {
        const total = record.opsTotal || 0;
        const done = record.opsCompleted || 0;
        const pct = total ? Math.round((done / total) * 100) : 0;
        return (
          <div style={{ minWidth: 110 }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>
              {done} / {total} ops
            </div>
            <div style={{ height: 5, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}>
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
      render: (s: JobOrderStatus, record: JobOrder) => {
        const overdue = s !== 'COMPLETED' && dayjs(record.dueDate).isBefore(dayjs(), 'day');
        if (overdue) return <StatusPill color="red">Overdue</StatusPill>;
        const st = statusStyle[s];
        return <StatusPill color={st.color}>{st.label}</StatusPill>;
      },
    },
    { title: 'Assigned Worker', dataIndex: 'assignedWorkerName', key: 'assignedWorkerName' },
    {
      title: '',
      key: 'actions',
      render: (_: unknown, record: JobOrder) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/job-orders/${record.id}/edit`)}>
          Edit
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'flex-end' }} wrap>
        <Space>
          <Select
            allowClear
            placeholder="Filter by status"
            style={{ width: 180 }}
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'ASSIGNED', label: 'Assigned' },
              { value: 'IN_PROGRESS', label: 'In Progress' },
              { value: 'COMPLETED', label: 'Completed' },
            ]}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/job-orders/new')}>
            New Job Order
          </Button>
        </Space>
      </Space>

      {error && <Typography.Text type="danger">{error}</Typography.Text>}

      <Table
        rowKey="id"
        columns={columns}
        dataSource={jobs}
        loading={loading}
        locale={{ emptyText: 'No job orders found' }}
        scroll={{ x: true }}
      />
    </div>
  );
}
