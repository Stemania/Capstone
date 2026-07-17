import { useEffect, useState } from 'react';
import { Table, Button, Tag, Typography, Space, Select } from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import type { JobOrder, JobOrderStatus } from '../../types';

const { Title } = Typography;

const statusColors: Record<JobOrderStatus, string> = {
  UNASSIGNED: 'default',
  ASSIGNED: 'blue',
  IN_PROGRESS: 'processing',
  COMPLETED: 'success',
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
    { title: 'Title', dataIndex: 'title', key: 'title' },
    { title: 'Client', dataIndex: 'clientName', key: 'clientName' },
    {
      title: 'Due Date',
      dataIndex: 'dueDate',
      key: 'dueDate',
      render: (d: string) => dayjs(d).format('MMM D, YYYY'),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: JobOrderStatus) => <Tag color={statusColors[s]}>{s.replace('_', ' ')}</Tag>,
    },
    { title: 'Assigned Worker', dataIndex: 'assignedWorkerName', key: 'assignedWorkerName' },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: unknown, record: JobOrder) => (
        <Button icon={<EditOutlined />} onClick={() => navigate(`/job-orders/${record.id}/edit`)}>
          Edit
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
        <Title level={4} style={{ margin: 0 }}>Job Orders</Title>
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
