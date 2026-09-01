import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Collapse,
  Col,
  Input,
  Modal,
  Row,
  Space,
  Spin,
  Table,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  CheckOutlined,
  EditOutlined,
  PrinterOutlined,
} from '@ant-design/icons';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { operationsApi } from '../../api/operations.api';
import { notificationsApi } from '../../api/notifications.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import StatusPill, { type PillColor } from '../../components/StatusPill';
import type {
  JobOrder,
  JobOrderStatus,
  JobPriority,
  NotificationLog,
  Operation,
  OperationStatus,
} from '../../types';
import { formatDifferenceFromTarget } from '../analytics/analyticsPeriod';
import { WorkerPageHeader } from '../../layouts/WorkerLayout';

const { Title, Text } = Typography;

const STATUS_PILL: Record<JobOrderStatus, { label: string; color: PillColor }> = {
  DRAFT: { label: 'Draft', color: 'gray' },
  SCHEDULED: { label: 'Scheduled', color: 'blue' },
  IN_PROGRESS: { label: 'In Progress', color: 'blue' },
  COMPLETED: { label: 'Completed', color: 'green' },
  DELIVERED: { label: 'Delivered', color: 'green' },
};

const OP_STATUS: Record<OperationStatus, { label: string; color: PillColor }> = {
  PENDING: { label: 'Pending', color: 'amber' },
  SCHEDULED: { label: 'Scheduled', color: 'blue' },
  IN_PROGRESS: { label: 'In Progress', color: 'blue' },
  COMPLETED: { label: 'Completed', color: 'green' },
  REWORK: { label: 'Redo', color: 'amber' },
};

const PRIORITY_PILL: Record<JobPriority, { label: string; color: PillColor }> = {
  HIGH: { label: 'High', color: 'red' },
  MODERATE: { label: 'Moderate', color: 'amber' },
  LOW: { label: 'Low', color: 'green' },
};

const GREEN = '#16a34a';
const GREEN_SOFT = 'rgba(22,163,74,0.12)';
const NAVY = '#0f1c2e';
const BORDER = '#e2e8f0';
const MUTED = '#64748b';

const PART_STAGE_LABEL: Record<string, string> = {
  RAW_MATERIAL: 'Raw material',
  CLIENT_SUPPLIED_ITEM: 'Client supplied item',
  BLANK: 'Blank',
  WORK_IN_PROCESS: 'Work in process',
  MACHINED: 'Machined',
  HEAT_TREATED: 'Heat treated',
  FINISHED: 'Finished',
};

const JOB_TYPE_LABEL: Record<string, string> = {
  FABRICATION: 'Fabrication',
  MODIFICATION: 'Modification',
  REPAIR: 'Repair',
};

const NOTIF_UPDATE_LABEL: Record<string, string> = {
  JOB_RECEIVED: 'Job received',
  JOB_STARTED: 'Job started',
  JOB_COMPLETED: 'Job finished',
  JOB_DELIVERED: 'Job delivered',
};

const NOTIF_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  SENT: 'Sent',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
};

const NOTIF_CHANNEL_LABEL: Record<string, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  CONSOLE: 'Console',
};

const TIME_EVENT_LABEL: Record<string, string> = {
  START: 'Started',
  PAUSE: 'Paused',
  RESUME: 'Resumed',
  COMPLETE: 'Finished',
};

const PAUSE_REASON_LABEL: Record<string, string> = {
  END_OF_SHIFT: 'End of shift',
  BREAK: 'Break',
  MACHINE_DOWN: 'Machine down',
  WAITING_MATERIAL: 'Waiting for material',
  WAITING_PRIOR_OPERATION: 'Waiting on prior operation',
  OTHER: 'Other',
};

function friendlyEnum(value: string | null | undefined, map: Record<string, string>) {
  if (!value) return '—';
  return map[value] || value.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function dash(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—';
  return String(v);
}

function fmtDate(v?: string | null) {
  if (!v) return '—';
  return dayjs(v).format('MMM D, YYYY');
}

function fmtDateTime(v?: string | null) {
  if (!v) return '—';
  return dayjs(v).format('MMM D, YYYY h:mm A');
}

function fmtHours(v?: number | null) {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v.toFixed(1)}h`;
}

function fmtVariance(hours?: number | null, pct?: number | null) {
  return formatDifferenceFromTarget(hours, pct);
}

function fmtMoney(n?: number | null) {
  if (n == null) return '—';
  return `₱${Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function cardStyle(extra?: CSSProperties): CSSProperties {
  return {
    background: '#fff',
    border: `1px solid ${BORDER}`,
    borderRadius: 14,
    padding: 16,
    boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
    ...extra,
  };
}

export default function JobOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin, isOfficeStaff, isWorker } = useAuth();
  const canManage = isAdmin || isOfficeStaff;

  if (isWorker && id) {
    return <Navigate to={`/my-assignments/${id}`} replace />;
  }

  const [job, setJob] = useState<JobOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [reworkLoading, setReworkLoading] = useState<string | null>(null);
  const [delivering, setDelivering] = useState(false);
  const [notifications, setNotifications] = useState<NotificationLog[] | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const fetchJob = useCallback(async () => {
    if (!id) return;
    const { data } = await jobOrdersApi.get(id);
    setJob(data);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await fetchJob();
      } catch (err) {
        if (!cancelled) message.error(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, fetchJob]);

  const ops = useMemo(
    () => [...(job?.operations || [])].sort((a, b) => a.sequenceNo - b.sequenceNo),
    [job]
  );

  useEffect(() => {
    if (!id || !canManage) {
      setNotifications([]);
      return;
    }
    let cancelled = false;
    notificationsApi
      .list({ jobOrderId: id, limit: 200 })
      .then(({ data }) => {
        if (!cancelled) setNotifications(data);
      })
      .catch(() => {
        if (!cancelled) setNotifications([]);
      });
    return () => {
      cancelled = true;
    };
  }, [id, canManage, ops.length, job?.status]);

  const totals = useMemo(() => {
    let est = 0;
    let worked = 0;
    let estN = 0;
    let workedN = 0;
    for (const op of ops) {
      if (op.estimatedHours != null) {
        est += op.estimatedHours;
        estN += 1;
      }
      if (op.actualWorkedHours != null) {
        worked += op.actualWorkedHours;
        workedN += 1;
      }
    }
    return {
      estimated: estN ? est : null,
      worked: workedN ? worked : null,
      varianceHours: estN && workedN ? worked - est : null,
    };
  }, [ops]);

  const backTo = isWorker ? '/my-assignments' : '/job-orders';

  const refreshNotifications = useCallback(async () => {
    if (!id || !canManage) return;
    try {
      const { data } = await notificationsApi.list({ jobOrderId: id, limit: 200 });
      setNotifications(data);
    } catch {
      setNotifications([]);
    }
  }, [id, canManage]);

  const handleResend = async (logId: string) => {
    setResendingId(logId);
    try {
      await notificationsApi.resend(logId);
      message.success('Sent again');
      await refreshNotifications();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setResendingId(null);
    }
  };

  const handleRework = (op: Operation) => {
    let reason = '';
    Modal.confirm({
      title: `Send “${op.operationName}” for redo`,
      content: (
        <Input.TextArea
          rows={3}
          placeholder="Reason for redo"
          onChange={(e) => {
            reason = e.target.value;
          }}
        />
      ),
      okText: 'Create redo operation',
      onOk: async () => {
        if (!reason.trim()) {
          message.error('Reason is required');
          return Promise.reject();
        }
        setReworkLoading(op.id);
        try {
          await operationsApi.rework(op.id, reason.trim());
          message.success('Redo operation created');
          await fetchJob();
        } catch (err) {
          message.error(getErrorMessage(err));
          return Promise.reject();
        } finally {
          setReworkLoading(null);
        }
      },
    });
  };

  const handleDeliver = async () => {
    if (!job) return;
    setDelivering(true);
    try {
      await jobOrdersApi.deliver(job.id);
      message.success('Marked delivered');
      await fetchJob();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setDelivering(false);
    }
  };

  if (loading && !job) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!job) {
    return (
      <div style={{ padding: 24 }}>
        <Text type="secondary">Job order not found.</Text>
        <div style={{ marginTop: 12 }}>
          <Button onClick={() => navigate(backTo)}>Back</Button>
        </div>
      </div>
    );
  }

  const status = STATUS_PILL[job.status] || STATUS_PILL.SCHEDULED;
  const priority = job.priority ? PRIORITY_PILL[job.priority] : null;
  const overdue =
    job.status !== 'COMPLETED' &&
    job.status !== 'DELIVERED' &&
    job.status !== 'DRAFT' &&
    dayjs(job.dueDate).isBefore(dayjs(), 'day');
  const isDraft = job.status === 'DRAFT';

  return (
    <div className="jo-detail-page" style={{ maxWidth: 1200, margin: '0 auto', padding: isWorker ? '0 12px 24px' : undefined }}>
      {isWorker ? (
        <div style={{ margin: '0 -12px 12px' }}>
          <WorkerPageHeader
            title="Job Order"
            subtitle={job.jobNumber || job.id.slice(0, 8).toUpperCase()}
            onBack={() => navigate(backTo)}
          />
        </div>
      ) : (
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <Space wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(backTo)}>
            Back
          </Button>
          <div>
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>
              {job.jobNumber || job.id.slice(0, 8).toUpperCase()}
            </Text>
            <Title level={4} style={{ margin: 0, color: NAVY }}>
              Job Order
            </Title>
          </div>
        </Space>
        <Space wrap>
          {isDraft && isAdmin && (
            <Button
              type="primary"
              onClick={() => navigate(`/job-orders/${job.id}/plan`)}
            >
              Plan Operations
            </Button>
          )}
          {canManage && (
            <Button
              icon={<EditOutlined />}
              onClick={() => navigate(`/job-orders/${job.id}/edit`)}
            >
              {isDraft ? 'Edit PO' : 'Edit'}
            </Button>
          )}
          <Button
            icon={<PrinterOutlined />}
            onClick={() => navigate(`/job-orders/${job.id}/print`)}
          >
            Print
          </Button>
          {canManage && job.status === 'COMPLETED' && (
            <Button
              type="primary"
              icon={<CheckOutlined />}
              loading={delivering}
              onClick={handleDeliver}
            >
              Deliver
            </Button>
          )}
        </Space>
      </div>
      )}

      {/* Header card */}
      <div style={cardStyle({ marginBottom: 16, display: 'flex', gap: 14 })}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: GREEN_SOFT,
            color: GREEN,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            flexShrink: 0,
          }}
        >
          <CheckCircleFilled />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: NAVY, marginBottom: 2 }}>
            {job.title}
          </div>
          <div style={{ fontSize: 14, color: MUTED, marginBottom: 10 }}>
            {dash(job.clientName)}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {isDraft ? (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                  color: '#94a3b8',
                }}
              >
                {job.draftStage || 'Draft'}
              </span>
            ) : (
              <StatusPill color={status.color}>{status.label}</StatusPill>
            )}
            {priority && <StatusPill color={priority.color}>{priority.label}</StatusPill>}
            <span style={{ fontSize: 13, color: overdue ? '#dc2626' : MUTED, fontWeight: 600 }}>
              Due {fmtDate(job.dueDate)}
            </span>
            {(job.quantity != null || (!isWorker && job.amount != null)) && (
              <span style={{ fontSize: 13, color: MUTED }}>
                {job.quantity != null && (
                  <>
                    Qty {job.quantity}
                    {job.unitOfMeasure ? ` ${job.unitOfMeasure}` : ''}
                  </>
                )}
                {!isWorker && job.quantity != null && job.amount != null && ' · '}
                {!isWorker && job.amount != null && fmtMoney(job.amount)}
              </span>
            )}
          </div>
        </div>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={14}>
          <div style={cardStyle()}>
            <div style={{ fontWeight: 800, fontSize: 14, color: NAVY, marginBottom: 12 }}>
              Reference
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: '10px 20px',
                fontSize: 13,
              }}
            >
              <RefItem label="Client PO #" value={dash(job.clientPoNumber)} />
              <RefItem label="PO date" value={fmtDate(job.poDate)} />
              <RefItem label="Job type" value={friendlyEnum(job.jobType, JOB_TYPE_LABEL)} />
              <RefItem
                label="Stage of the part"
                value={friendlyEnum(job.partCondition, PART_STAGE_LABEL)}
              />
              <RefItem label="Created" value={fmtDate(job.createdAt)} />
            </div>
            {job.description ? (
              <div style={{ marginTop: 14, fontSize: 13, color: MUTED }}>
                <div style={{ fontWeight: 700, color: '#475569', marginBottom: 4 }}>Description</div>
                {job.description}
              </div>
            ) : null}
          </div>
        </Col>
        <Col xs={24} lg={10}>
          <div style={cardStyle({ height: '100%' })}>
            <div style={{ fontWeight: 800, fontSize: 14, color: NAVY, marginBottom: 12 }}>
              Raw Materials
            </div>
            {!job.rawMaterials?.length ? (
              <Text type="secondary">—</Text>
            ) : (
              job.rawMaterials.map((m, i) => (
                <div
                  key={`${m.name}-${i}`}
                  style={{ fontSize: 13, color: MUTED, marginBottom: 6 }}
                >
                  <span style={{ color: NAVY, fontWeight: 600 }}>{m.name}</span>
                  {(m.quantity != null || m.unit) && (
                    <>
                      {' '}
                      — {[m.quantity, m.unit].filter((x) => x != null && x !== '').join(' ')}
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </Col>
      </Row>

      <div style={{ fontWeight: 800, fontSize: 15, color: NAVY, marginBottom: 12 }}>
        Operations
      </div>

      <div style={{ position: 'relative', paddingLeft: 4, marginBottom: 20 }}>
        {ops.map((op, index) => {
          const done = op.status === 'COMPLETED';
          const active = op.status === 'IN_PROGRESS';
          const isLast = index === ops.length - 1;
          const opSt = OP_STATUS[op.status] || OP_STATUS.PENDING;
          const machine =
            op.machineUnitLabel ||
            op.machineTypeName ||
            op.machineTypeCode ||
            null;
          const logs = [...(op.timeLogs || [])].sort(
            (a, b) => dayjs(a.eventAt).valueOf() - dayjs(b.eventAt).valueOf()
          );

          return (
            <div key={op.id} style={{ display: 'flex', gap: 16, position: 'relative' }}>
              {!isLast && (
                <div
                  style={{
                    position: 'absolute',
                    left: 15,
                    top: 36,
                    bottom: 0,
                    width: 2,
                    background: done ? GREEN : BORDER,
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
                  background: done ? GREEN : active ? '#2563eb' : 'rgba(217,119,6,0.15)',
                  color: done || active ? '#fff' : '#d97706',
                  border: done || active ? 'none' : '2px solid #d97706',
                }}
              >
                {done ? <CheckCircleFilled /> : op.sequenceNo}
              </div>

              <div
                style={cardStyle({
                  flex: 1,
                  marginBottom: 12,
                  borderColor: active ? '#2563eb' : BORDER,
                  opacity: done ? 0.95 : 1,
                })}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    alignItems: 'center',
                    marginBottom: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontWeight: 800, fontSize: 15, color: NAVY }}>
                    {op.operationName}
                    {op.reworkOfOperationId ? (
                      <Text type="secondary" style={{ fontWeight: 600, fontSize: 12 }}>
                        {' '}
                        (redo)
                      </Text>
                    ) : null}
                  </span>
                  <StatusPill color={opSt.color} compact>
                    {opSt.label}
                    {active && op.isPaused ? ' · Paused' : ''}
                  </StatusPill>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                    gap: '8px 16px',
                    fontSize: 12,
                    color: MUTED,
                    marginBottom: 10,
                  }}
                >
                  <span>
                    <strong style={{ color: '#475569' }}>Machine:</strong> {dash(machine)}
                  </span>
                  <span>
                    <strong style={{ color: '#475569' }}>Worker:</strong>{' '}
                    {dash(op.assignedWorkerName)}
                  </span>
                  <span>
                    <strong style={{ color: '#475569' }}>Scheduled:</strong>{' '}
                    {op.scheduledStart || op.scheduledEnd
                      ? `${fmtDateTime(op.scheduledStart)} → ${fmtDateTime(op.scheduledEnd)}`
                      : '—'}
                  </span>
                  <span>
                    <strong style={{ color: '#475569' }}>Started–finished:</strong>{' '}
                    {op.actualStart || op.actualEnd
                      ? `${fmtDateTime(op.actualStart)} → ${fmtDateTime(op.actualEnd)}`
                      : '—'}
                  </span>
                  <span>
                    <strong style={{ color: '#475569' }}>Target hours:</strong>{' '}
                    {fmtHours(op.estimatedHours)}
                  </span>
                  <span>
                    <strong style={{ color: '#475569' }}>Hours worked:</strong>{' '}
                    {fmtHours(op.actualWorkedHours)}
                  </span>
                  <span>
                    <strong style={{ color: '#475569' }}>Difference from target:</strong>{' '}
                    {fmtVariance(op.varianceHours, op.variancePct)}
                  </span>
                </div>

                {op.reworkReason ? (
                  <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>
                    Redo reason: {op.reworkReason}
                  </div>
                ) : null}

                <Collapse
                  size="small"
                  ghost
                  items={[
                    {
                      key: 'logs',
                      label: (
                        <span style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>
                          Time log ({logs.length})
                        </span>
                      ),
                      children:
                        logs.length === 0 ? (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            —
                          </Text>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: MUTED }}>
                            {logs.map((log) => (
                              <li key={log.id}>
                                {TIME_EVENT_LABEL[log.event] || log.event}
                                {log.reason
                                  ? ` / ${PAUSE_REASON_LABEL[log.reason] || log.reason}`
                                  : ''}
                                {' · '}
                                {fmtDateTime(log.eventAt)}
                                {log.workerName ? ` · ${log.workerName}` : ''}
                                {log.note ? ` — ${log.note}` : ''}
                              </li>
                            ))}
                          </ul>
                        ),
                    },
                  ]}
                />

                {canManage && op.status === 'COMPLETED' && (
                  <Button
                    size="small"
                    style={{ marginTop: 8 }}
                    loading={reworkLoading === op.id}
                    onClick={() => handleRework(op)}
                  >
                    Send for redo
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {ops.length === 0 && (
          <Text type="secondary">No operations on this job yet.</Text>
        )}
      </div>

      <div style={cardStyle({ marginBottom: 16 })}>
        <div style={{ fontWeight: 800, fontSize: 14, color: NAVY, marginBottom: 12 }}>
          Time taken
        </div>
        <Row gutter={16}>
          <Col xs={8}>
            <div style={{ fontSize: 12, color: MUTED }}>Total target hours</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtHours(totals.estimated)}</div>
          </Col>
          <Col xs={8}>
            <div style={{ fontSize: 12, color: MUTED }}>Total hours worked</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtHours(totals.worked)}</div>
          </Col>
          <Col xs={8}>
            <div style={{ fontSize: 12, color: MUTED }}>Difference from target</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {fmtVariance(totals.varianceHours, null)}
            </div>
          </Col>
        </Row>
      </div>

      {canManage && (
        <div style={cardStyle({ marginBottom: 24 })}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 14, color: NAVY }}>
              Notification history
            </div>
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            loading={notifications == null}
            dataSource={notifications || []}
            locale={{ emptyText: 'No client notifications sent for this job yet' }}
            columns={[
              {
                title: 'When',
                dataIndex: 'createdAt',
                width: 140,
                render: (v?: string) => (v ? dayjs(v).format('MMM D, HH:mm') : '—'),
              },
              {
                title: 'Update',
                dataIndex: 'milestone',
                width: 130,
                render: (m: string) => friendlyEnum(m, NOTIF_UPDATE_LABEL),
              },
              {
                title: 'Channel',
                dataIndex: 'channel',
                width: 80,
                render: (c: string) => friendlyEnum(c, NOTIF_CHANNEL_LABEL),
              },
              { title: 'To', dataIndex: 'recipient', ellipsis: true },
              {
                title: 'Status',
                dataIndex: 'status',
                width: 90,
                render: (s: string) => friendlyEnum(s, NOTIF_STATUS_LABEL),
              },
              {
                title: 'Time sent',
                dataIndex: 'sentAt',
                width: 140,
                render: (v?: string | null) =>
                  v ? dayjs(v).format('MMM D, HH:mm') : '—',
              },
              {
                title: '',
                key: 'actions',
                width: 100,
                render: (_: unknown, row: NotificationLog) =>
                  row.status === 'FAILED' ? (
                    <Button
                      size="small"
                      loading={resendingId === row.id}
                      onClick={() => handleResend(row.id)}
                    >
                      Send again
                    </Button>
                  ) : null,
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}

function RefItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 2 }}>{label}</div>
      <div style={{ color: NAVY, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
