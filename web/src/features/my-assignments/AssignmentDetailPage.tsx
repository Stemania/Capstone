import { useEffect, useState } from 'react';
import { Button, List, Tag, Typography, Spin, message, Space } from 'antd';
import { PlayCircleOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { operationsApi } from '../../api/operations.api';
import { getErrorMessage } from '../../api/client';
import type { JobOrder, Operation, OperationStatus } from '../../types';

const { Title, Text } = Typography;

const opStatusColors: Record<OperationStatus, string> = {
  PENDING: 'default',
  IN_PROGRESS: 'processing',
  COMPLETED: 'success',
};

export default function AssignmentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchJob = async () => {
    if (!id) return;
    try {
      const { data } = await jobOrdersApi.get(id);
      setJob(data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJob();
  }, [id]);

  const handleStart = async (op: Operation) => {
    setActionLoading(op.id);
    try {
      await operationsApi.start(op.id, new Date().toISOString());
      message.success('Operation started');
      await fetchJob();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  const handleComplete = async (op: Operation) => {
    setActionLoading(op.id);
    try {
      await operationsApi.complete(op.id, new Date().toISOString());
      message.success('Operation completed');
      await fetchJob();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '48px auto' }} />;
  if (!job) return <Text type="danger">Job not found</Text>;

  return (
    <div>
      <Button type="link" onClick={() => navigate('/my-assignments')} style={{ paddingLeft: 0 }}>
        &larr; Back to assignments
      </Button>

      <Title level={4}>{job.title}</Title>
      <Text type="secondary">{job.clientName}</Text>
      <div style={{ margin: '8px 0 24px' }}>
        <Tag>{job.status.replace('_', ' ')}</Tag>
        <Text> Due: {dayjs(job.dueDate).format('MMM D, YYYY')}</Text>
      </div>

      <Title level={5}>Operations</Title>
      <List
        dataSource={job.operations || []}
        renderItem={(op) => (
          <List.Item
            style={{ padding: '16px 0' }}
            actions={[
              op.status === 'PENDING' && (
                <Button
                  key="start"
                  type="primary"
                  size="large"
                  icon={<PlayCircleOutlined />}
                  loading={actionLoading === op.id}
                  onClick={() => handleStart(op)}
                  style={{ minWidth: 100 }}
                >
                  Start
                </Button>
              ),
              op.status === 'IN_PROGRESS' && (
                <Button
                  key="complete"
                  type="primary"
                  size="large"
                  icon={<CheckCircleOutlined />}
                  loading={actionLoading === op.id}
                  onClick={() => handleComplete(op)}
                  style={{ minWidth: 100 }}
                >
                  Complete
                </Button>
              ),
            ].filter(Boolean)}
          >
            <List.Item.Meta
              title={
                <Space>
                  <Text strong>#{op.seq}</Text>
                  <Text>{op.name}</Text>
                  <Tag color={opStatusColors[op.status]}>{op.status.replace('_', ' ')}</Tag>
                </Space>
              }
              description={
                op.startedAt || op.completedAt ? (
                  <Text type="secondary">
                    {op.startedAt && `Started: ${dayjs(op.startedAt).format('MMM D, h:mm A')}`}
                    {op.completedAt && ` | Completed: ${dayjs(op.completedAt).format('MMM D, h:mm A')}`}
                  </Text>
                ) : null
              }
            />
          </List.Item>
        )}
      />
    </div>
  );
}
