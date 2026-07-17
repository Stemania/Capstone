import { useEffect, useState } from 'react';
import { Card, List, Tag, Typography, Spin, Empty } from 'antd';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import type { JobOrder, JobOrderStatus } from '../../types';

const { Title, Text } = Typography;

const statusColors: Record<JobOrderStatus, string> = {
  UNASSIGNED: 'default',
  ASSIGNED: 'blue',
  IN_PROGRESS: 'processing',
  COMPLETED: 'success',
};

export default function MyAssignmentsPage() {
  const [jobs, setJobs] = useState<JobOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    jobOrdersApi
      .list()
      .then(({ data }) => setJobs(data))
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '48px auto' }} />;

  return (
    <div>
      <Title level={4}>My Assignments</Title>
      {error && <Text type="danger">{error}</Text>}

      {jobs.length === 0 ? (
        <Empty description="No assignments yet" />
      ) : (
        <List
          grid={{ gutter: 16, xs: 1, sm: 1, md: 2, lg: 2 }}
          dataSource={jobs}
          renderItem={(job) => (
            <List.Item>
              <Card
                hoverable
                onClick={() => navigate(`/my-assignments/${job.id}`)}
                style={{ width: '100%' }}
              >
                <Title level={5} style={{ marginTop: 0 }}>{job.title}</Title>
                <Text type="secondary">{job.clientName}</Text>
                <div style={{ marginTop: 8 }}>
                  <Tag color={statusColors[job.status]}>{job.status.replace('_', ' ')}</Tag>
                  <Text> Due: {dayjs(job.dueDate).format('MMM D, YYYY')}</Text>
                </div>
              </Card>
            </List.Item>
          )}
        />
      )}
    </div>
  );
}
