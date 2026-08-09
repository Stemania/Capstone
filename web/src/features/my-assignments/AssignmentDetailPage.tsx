import { useEffect, useState } from 'react';
import { Button, Spin, message } from 'antd';
import {
  CheckCircleFilled,
  FileTextOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { operationsApi } from '../../api/operations.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useWorkerTheme, WorkerPageHeader } from '../../layouts/WorkerLayout';
import type { JobOrder, Operation } from '../../types';

export default function AssignmentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
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
        <div className="page-spinner">
          <Spin size="large" />
        </div>
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
    job.status === 'COMPLETED'
      ? colors.green
      : job.status === 'IN_PROGRESS'
        ? colors.accent
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
              {job.priority && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '3px 10px',
                    borderRadius: 999,
                    background:
                      job.priority === 'HIGH'
                        ? 'rgba(220,38,38,0.12)'
                        : job.priority === 'LOW'
                          ? colors.greenSoft
                          : 'rgba(217,119,6,0.12)',
                    color:
                      job.priority === 'HIGH'
                        ? colors.red
                        : job.priority === 'LOW'
                          ? colors.green
                          : colors.amber,
                  }}
                >
                  {job.priority === 'HIGH' ? 'High' : job.priority === 'LOW' ? 'Low' : 'Moderate'}
                </span>
              )}
              <span style={{ fontSize: 12, color: overdue ? colors.red : colors.textSecondary }}>
                Due {dayjs(job.dueDate).format('MMM D, YYYY')}
              </span>
            </div>
            {(job.quantity != null || job.amount != null) && (
              <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 8 }}>
                {job.quantity != null && (
                  <>
                    Qty {job.quantity}
                    {job.unitOfMeasure ? ` ${job.unitOfMeasure}` : ''}
                  </>
                )}
                {job.quantity != null && job.amount != null && ' · '}
                {job.amount != null &&
                  `₱${Number(job.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`}
              </div>
            )}
          </div>
        </div>

        {!!job.rawMaterials?.length && (
          <div
            style={{
              background: colors.card,
              border: `1px solid ${colors.cardBorder}`,
              borderRadius: 14,
              padding: 14,
              marginBottom: 16,
              boxShadow: colors.shadow,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>Raw Materials</div>
            {job.rawMaterials.map((m, i) => (
              <div key={`${m.name}-${i}`} style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 4 }}>
                {m.name}
                {(m.quantity != null || m.unit) && (
                  <> — {[m.quantity, m.unit].filter((x) => x != null && x !== '').join(' ')}</>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>Operations</div>

        <div style={{ position: 'relative', paddingLeft: 8 }}>
          {ops.map((op, index) => {
            const done = op.status === 'COMPLETED';
            const active = op.status === 'IN_PROGRESS';
            const isMine = op.assignedWorkerId === user?.id;
            const canStart =
              isMine &&
              (op.status === 'PENDING' || op.status === 'SCHEDULED' || op.status === 'REWORK') &&
              ops.slice(0, index).every((o) => o.status === 'COMPLETED');
            const isLast = index === ops.length - 1;
            const opName = op.operationName || op.name || 'Operation';
            const seq = op.sequenceNo ?? op.seq ?? index + 1;
            const machineLabel =
              op.machineTypeName ||
              (op.machineNames && op.machineNames[0]) ||
              null;
            const started = op.actualStart || op.startedAt;
            const completed = op.actualEnd || op.completedAt;

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
                        : 'rgba(217,119,6,0.15)',
                    color: done || active ? '#fff' : colors.amber,
                    border: done || active ? 'none' : `2px solid ${colors.amber}`,
                  }}
                >
                  {done ? <CheckCircleFilled /> : seq}
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
                    opacity: done ? 0.85 : isMine ? 1 : 0.7,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontWeight: 800, fontSize: 15 }}>{opName}</span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '3px 10px',
                        borderRadius: 999,
                        background: done
                          ? colors.greenSoft
                          : active
                            ? 'rgba(37,99,235,0.12)'
                            : 'rgba(217,119,6,0.12)',
                        color: done ? colors.green : active ? colors.accent : colors.amber,
                      }}
                    >
                      {done
                        ? 'Completed'
                        : active
                          ? 'In Progress'
                          : op.status === 'SCHEDULED'
                            ? 'Scheduled'
                            : op.status === 'REWORK'
                              ? 'Rework'
                              : 'Pending'}
                    </span>
                  </div>

                  {machineLabel ? (
                    <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 8 }}>
                      Machine: {machineLabel}
                    </div>
                  ) : null}

                  {!isMine && op.assignedWorkerName && (
                    <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 8 }}>
                      Assigned to {op.assignedWorkerName}
                    </div>
                  )}

                  {(started || completed) && (
                    <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 10 }}>
                      {started && `Started ${dayjs(started).format('MMM D, h:mm A')}`}
                      {completed && ` · Done ${dayjs(completed).format('MMM D, h:mm A')}`}
                    </div>
                  )}

                  {canStart && (
                    <Button
                      type="default"
                      block
                      size="large"
                      loading={actionLoading === op.id}
                      onClick={() => runAction(op, 'start')}
                      style={{ height: 44, fontWeight: 700 }}
                    >
                      Start Operation
                    </Button>
                  )}
                  {isMine && op.status === 'IN_PROGRESS' && (
                    <Button
                      type="primary"
                      block
                      size="large"
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
