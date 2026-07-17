import { useEffect, useState } from 'react';
import { Button, Spin, message } from 'antd';
import {
  PlayCircleOutlined,
  CheckCircleOutlined,
  CheckCircleFilled,
  FileTextOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { operationsApi } from '../../api/operations.api';
import { getErrorMessage } from '../../api/client';
import { useWorkerTheme, WorkerPageHeader } from '../../layouts/WorkerLayout';
import type { JobOrder, Operation } from '../../types';

export default function AssignmentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { colors } = useWorkerTheme();
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

  if (loading) {
    return (
      <div>
        <WorkerPageHeader title="Job Details" onBack={() => navigate('/my-assignments')} />
        <Spin size="large" style={{ display: 'block', margin: '64px auto' }} />
      </div>
    );
  }

  if (!job) {
    return (
      <div>
        <WorkerPageHeader title="Job Details" onBack={() => navigate('/my-assignments')} />
        <p style={{ color: colors.red, padding: 16 }}>Job not found</p>
      </div>
    );
  }

  const overdue = job.status !== 'COMPLETED' && dayjs(job.dueDate).isBefore(dayjs(), 'day');
  const statusLabel =
    job.status === 'COMPLETED'
      ? 'Completed'
      : job.status === 'IN_PROGRESS'
        ? 'In Progress'
        : overdue
          ? 'Overdue'
          : 'Assigned';
  const statusColor =
    job.status === 'COMPLETED' || job.status === 'IN_PROGRESS'
      ? colors.green
      : overdue
        ? colors.red
        : colors.accent;

  const ops = job.operations || [];

  return (
    <div>
      <WorkerPageHeader
        title="Job Details"
        subtitle={job.jobNumber || job.id.slice(0, 8).toUpperCase()}
        onBack={() => navigate('/my-assignments')}
      />

      <div style={{ padding: 16 }}>
        <div
          style={{
            background: colors.card,
            border: `1px solid ${colors.cardBorder}`,
            borderRadius: 14,
            padding: 16,
            marginBottom: 16,
            boxShadow: colors.shadow,
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: colors.greenSoft,
              color: colors.green,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              flexShrink: 0,
            }}
          >
            <CheckCircleFilled />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 2 }}>{job.title}</div>
            <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 8 }}>
              {job.clientName}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: `${statusColor}22`,
                  color: statusColor,
                }}
              >
                {statusLabel}
              </span>
              <span style={{ fontSize: 12, color: overdue ? colors.red : colors.textSecondary }}>
                Due {dayjs(job.dueDate).format('MMM D, YYYY')}
              </span>
            </div>
          </div>
        </div>

        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>Operations</div>

        <div style={{ position: 'relative', paddingLeft: 8 }}>
          {ops.map((op, index) => {
            const done = op.status === 'COMPLETED';
            const active = op.status === 'IN_PROGRESS';
            const isLast = index === ops.length - 1;

            return (
              <div key={op.id} style={{ display: 'flex', gap: 14, position: 'relative' }}>
                {!isLast && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 15,
                      top: 32,
                      bottom: 0,
                      width: 2,
                      background: done ? colors.green : colors.cardBorder,
                    }}
                  />
                )}

                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: 13,
                    zIndex: 1,
                    background: done
                      ? colors.green
                      : active
                        ? colors.accent
                        : colors.chipBg,
                    color: done || active ? '#fff' : colors.textSecondary,
                    border: done || active ? 'none' : `2px solid ${colors.cardBorder}`,
                  }}
                >
                  {done ? <CheckCircleFilled /> : op.seq}
                </div>

                <div
                  style={{
                    flex: 1,
                    background: colors.card,
                    border: `1px solid ${active ? colors.accent : colors.cardBorder}`,
                    borderRadius: 14,
                    padding: 14,
                    marginBottom: 12,
                    boxShadow: colors.shadow,
                    opacity: done ? 0.85 : 1,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontWeight: 800, fontSize: 15 }}>{op.name}</span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: done ? colors.green : active ? colors.accent : colors.textSecondary,
                      }}
                    >
                      {done ? 'Completed' : active ? 'In Progress' : 'Pending'}
                    </span>
                  </div>

                  {(op.startedAt || op.completedAt) && (
                    <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 10 }}>
                      {op.startedAt && `Started ${dayjs(op.startedAt).format('MMM D, h:mm A')}`}
                      {op.completedAt && ` · Done ${dayjs(op.completedAt).format('MMM D, h:mm A')}`}
                    </div>
                  )}

                  {op.status === 'PENDING' && (
                    <Button
                      type="default"
                      block
                      size="large"
                      icon={<PlayCircleOutlined />}
                      loading={actionLoading === op.id}
                      onClick={() => runAction(op, 'start')}
                      style={{ height: 44, fontWeight: 700 }}
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
                      style={{ height: 44, fontWeight: 700 }}
                    >
                      Mark Complete
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {job.description && (
          <div
            style={{
              background: colors.card,
              border: `1px solid ${colors.cardBorder}`,
              borderRadius: 14,
              padding: 14,
              marginTop: 4,
              boxShadow: colors.shadow,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontWeight: 800,
                fontSize: 14,
                marginBottom: 8,
              }}
            >
              <FileTextOutlined style={{ color: colors.accent }} />
              Job Notes
            </div>
            <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.55 }}>
              {job.description}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
