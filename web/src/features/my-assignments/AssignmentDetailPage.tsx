import { useEffect, useState } from 'react';
import { Button, Spin, message } from 'antd';
import { PlayCircleOutlined, CheckCircleOutlined, LeftOutlined, CheckCircleFilled } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { operationsApi } from '../../api/operations.api';
import { getErrorMessage } from '../../api/client';
import { workerColors } from '../../layouts/WorkerLayout';
import type { JobOrder, Operation } from '../../types';

const opStatusStyle: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'PENDING', color: workerColors.textSecondary },
  IN_PROGRESS: { label: 'IN PROGRESS', color: workerColors.green },
  COMPLETED: { label: 'DONE', color: '#3b82f6' },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const runAction = async (op: Operation, action: 'start' | 'complete') => {
    setActionLoading(op.id);
    try {
      if (action === 'start') {
        await operationsApi.start(op.id, new Date().toISOString());
        message.success('Operation started');
      } else {
        await operationsApi.complete(op.id, new Date().toISOString());
        message.success('Operation completed');
      }
      await fetchJob();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '64px auto' }} />;
  if (!job) return <p style={{ color: workerColors.red }}>Job not found</p>;

  const overdue = job.status !== 'COMPLETED' && dayjs(job.dueDate).isBefore(dayjs(), 'day');

  return (
    <div>
      <button
        onClick={() => navigate('/my-assignments')}
        style={{
          background: 'none',
          border: 'none',
          color: workerColors.green,
          fontSize: 14,
          fontWeight: 600,
          padding: '4px 0',
          marginBottom: 12,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <LeftOutlined /> Back to jobs
      </button>

      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 1,
          color: workerColors.textSecondary,
          textTransform: 'uppercase',
          marginBottom: 4,
        }}
      >
        {job.clientName}
      </div>
      <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 8px' }}>{job.title}</h2>
      <div style={{ fontSize: 13, color: overdue ? workerColors.red : workerColors.textSecondary, marginBottom: 24 }}>
        Due {dayjs(job.dueDate).format('MMM D, YYYY')}
        {overdue && ' · running behind'}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(job.operations || []).map((op) => {
          const style = opStatusStyle[op.status];
          const done = op.status === 'COMPLETED';
          return (
            <div
              key={op.id}
              style={{
                background: workerColors.card,
                border: `1px solid ${workerColors.cardBorder}`,
                borderRadius: 12,
                padding: '14px 16px',
                opacity: done ? 0.65 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: done ? 0 : 12 }}>
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: 'rgba(255,255,255,0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {done ? <CheckCircleFilled style={{ color: '#3b82f6' }} /> : op.seq}
                </span>
                <span style={{ flex: 1, fontWeight: 700, fontSize: 15 }}>{op.name}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: style.color }}>{style.label}</span>
              </div>

              {(op.startedAt || op.completedAt) && (
                <div style={{ fontSize: 12, color: workerColors.textSecondary, margin: '4px 0 10px 38px' }}>
                  {op.startedAt && `Started ${dayjs(op.startedAt).format('MMM D, h:mm A')}`}
                  {op.completedAt && ` · Done ${dayjs(op.completedAt).format('MMM D, h:mm A')}`}
                </div>
              )}

              {op.status === 'PENDING' && (
                <Button
                  type="primary"
                  block
                  size="large"
                  icon={<PlayCircleOutlined />}
                  loading={actionLoading === op.id}
                  onClick={() => runAction(op, 'start')}
                  style={{ height: 48, fontWeight: 700 }}
                >
                  Start
                </Button>
              )}
              {op.status === 'IN_PROGRESS' && (
                <Button
                  type="primary"
                  block
                  size="large"
                  icon={<CheckCircleOutlined />}
                  loading={actionLoading === op.id}
                  onClick={() => runAction(op, 'complete')}
                  style={{ height: 48, fontWeight: 700 }}
                >
                  Complete
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
