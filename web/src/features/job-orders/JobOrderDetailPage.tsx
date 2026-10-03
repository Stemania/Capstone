import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  PrinterOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { jobOrdersApi, workersApi } from '../../api/jobOrders.api';
import { operationsApi } from '../../api/operations.api';
import { notificationsApi } from '../../api/notifications.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import StatusPill, { type PillColor } from '../../components/StatusPill';
import MaterialWaitTag from '../../components/MaterialWaitTag';
import MaterialDelayTag from '../../components/MaterialDelayTag';
import type {
  JobOrder,
  JobOrderStatus,
  JobPriority,
  MachineDowntimeRecord,
  MaterialPurchase,
  NotificationLog,
  Operation,
  OperationPauseReason,
  OperationStatus,
  ReworkReasonCategory,
  User,
} from '../../types';
import { formatDifferenceFromTarget } from '../analytics/analyticsPeriod';
import { WorkerPageHeader } from '../../layouts/WorkerLayout';
import { jobOrdersListPath } from './jobOrderListPaths';
import JobScheduleColorPicker from './JobScheduleColorPicker';
import OrderMaterialsModal from '../supplier-orders/OrderMaterialsModal';
import { MaterialArrivalNote, PlannedMaterialsTable } from './MaterialOrdersSummary';
import { ORDER_STATUS_PILL } from '../supplier-orders/supplierOrderUi';
import { ReproposeModal } from '../calendar/RescheduleAffectedJobs';

const { Title, Text } = Typography;

const STATUS_PILL: Record<JobOrderStatus, { label: string; color: PillColor }> = {
  DRAFT: { label: 'Pending', color: 'gray' },
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

const REWORK_CATEGORY_OPTIONS: { value: ReworkReasonCategory; label: string }[] = [
  { value: 'DIMENSION_OUT_OF_TOLERANCE', label: 'Dimension out of tolerance' },
  { value: 'SURFACE_FINISH', label: 'Surface finish' },
  { value: 'WRONG_MATERIAL', label: 'Wrong material' },
  { value: 'MACHINE_FAULT', label: 'Machine fault' },
  { value: 'OPERATOR_ERROR', label: 'Operator error' },
  { value: 'OTHER', label: 'Other' },
];

function reworkCategoryLabel(cat: string | null | undefined) {
  if (!cat) return null;
  return REWORK_CATEGORY_OPTIONS.find((o) => o.value === cat)?.label || cat;
}

const GREEN = '#16a34a';
const GREEN_SOFT = 'rgba(22,163,74,0.12)';
const NAVY = '#0f1c2e';
const BORDER = '#e2e8f0';
const MUTED = '#64748b';

const PART_STAGE_LABEL: Record<string, string> = {
  RAW_MATERIAL: 'Raw material',
  CLIENT_SUPPLIED_ITEM: 'Client supplied item',
  WORK_IN_PROCESS: 'Work in process',
  CUT: 'Cut',
  BLANK: 'Blank',
  FORMED: 'Formed',
  MACHINED: 'Machined',
  ASSEMBLED: 'Assembled',
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

const PAUSE_REASONS: { value: OperationPauseReason; label: string }[] = [
  { value: 'END_OF_SHIFT', label: 'End of shift' },
  { value: 'BREAK', label: 'Break' },
  { value: 'MACHINE_DOWN', label: 'Machine down' },
  { value: 'WAITING_MATERIAL', label: 'Waiting for material' },
  { value: 'WAITING_PRIOR_OPERATION', label: 'Waiting on prior operation' },
  { value: 'OTHER', label: 'Other' },
];

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

const VAT_RATE_PCT = 12;

const PURCHASE_STATUS_PILL: Record<string, { label: string; color: PillColor }> = {
  DRAFT: { label: 'On draft PO', color: 'gray' },
  ORDERED: { label: 'Ordered', color: 'amber' },
  RECEIVED: { label: 'Received', color: 'green' },
  CONSUMED: { label: 'Consumed', color: 'gray' },
  CANCELLED: { label: 'Cancelled', color: 'red' },
};

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

const SUBHEAD: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: MUTED,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  marginBottom: 6,
};

const DETAIL_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: '8px 16px',
  fontSize: 13,
};

const ACTIVITY_ROW: CSSProperties = {
  padding: '8px 0',
  borderTop: `1px solid ${BORDER}`,
  fontSize: 12,
  color: MUTED,
};

function OperationWorkerSelect({ op, onAssigned }: { op: Operation; onAssigned: () => Promise<void> }) {
  const [workers, setWorkers] = useState<User[] | null>(null);
  const [saving, setSaving] = useState(false);
  const isChecking =
    (op.operationTypeCode || '').toUpperCase() === 'CHECKING' ||
    op.operationName.trim().toLowerCase() === 'checking';

  const loadWorkers = async () => {
    if (workers) return;
    try {
      const { data } = await workersApi.list(
        isChecking
          ? { forChecking: true, operationName: op.operationName }
          : {
              machineTypeId: op.machineTypeId || undefined,
              operationTypeId: op.operationTypeId || undefined,
              operationName: op.operationName,
            }
      );
      setWorkers(data);
    } catch (err) {
      message.error(getErrorMessage(err));
      setWorkers([]);
    }
  };

  const options = useMemo(() => {
    const list = (workers || []).map((w) => ({ value: w.id, label: w.fullName }));
    if (op.assignedWorkerId && !list.some((o) => o.value === op.assignedWorkerId)) {
      list.unshift({ value: op.assignedWorkerId, label: op.assignedWorkerName || 'Current worker' });
    }
    return list;
  }, [workers, op.assignedWorkerId, op.assignedWorkerName]);

  return (
    <Select
      size="small"
      style={{ minWidth: 160 }}
      placeholder="Assign a worker"
      value={op.assignedWorkerId || undefined}
      options={options}
      loading={saving}
      disabled={saving}
      showSearch
      optionFilterProp="label"
      onDropdownVisibleChange={(open) => {
        if (open) void loadWorkers();
      }}
      onChange={async (workerId: string) => {
        setSaving(true);
        try {
          await operationsApi.assign(op.id, workerId);
          message.success('Worker assigned. Re-propose the schedule to fit their time.');
          await onAssigned();
        } catch (err) {
          message.error(getErrorMessage(err));
        } finally {
          setSaving(false);
        }
      }}
    />
  );
}

export default function JobOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin, isOfficeStaff, isWorker } = useAuth();
  const canManage = isAdmin || isOfficeStaff;

  if (isWorker && id) {
    return <Navigate to={`/my-assignments/${id}`} replace />;
  }

  const [job, setJob] = useState<JobOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [reworkLoading, setReworkLoading] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pauseForOp, setPauseForOp] = useState<Operation | null>(null);
  const [delivering, setDelivering] = useState(false);
  const [markingMaterial, setMarkingMaterial] = useState(false);
  const [notifications, setNotifications] = useState<NotificationLog[] | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [purchases, setPurchases] = useState<MaterialPurchase[]>([]);
  const [breakdowns, setBreakdowns] = useState<MachineDowntimeRecord[]>([]);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [reproposeOpen, setReproposeOpen] = useState(false);
  const [stockSavingId, setStockSavingId] = useState<string | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceSaving, setInvoiceSaving] = useState(false);
  const [invoiceForm] = Form.useForm();
  const invoiceSubtotal = Form.useWatch('subtotal', invoiceForm) as number | null | undefined;
  const invoiceApplyVat = Form.useWatch('applyVat', invoiceForm) as boolean | undefined;
  const fetchJob = useCallback(async () => {
    if (!id) return;
    const { data } = await jobOrdersApi.get(id);
    setJob(data);
  }, [id]);

  const hasJob = Boolean(job);
  useEffect(() => {
    if (!hasJob || !location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [hasJob, location.hash]);

  const fetchPurchases = useCallback(async () => {
    if (!id || !canManage) return;
    try {
      const { data } = await jobOrdersApi.listMaterialPurchases(id);
      setPurchases(data);
    } catch {
      setPurchases([]);
    }
  }, [id, canManage]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await fetchJob();
        if (canManage) {
          await fetchPurchases();
          try {
            const { data } = await jobOrdersApi.listBreakdowns(id);
            if (!cancelled) setBreakdowns(data);
          } catch {
            if (!cancelled) setBreakdowns([]);
          }
        }
      } catch (err) {
        if (!cancelled) message.error(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, fetchJob, fetchPurchases, canManage]);

  const ops = useMemo(
    () => [...(job?.operations || [])].sort((a, b) => a.sequenceNo - b.sequenceNo),
    [job]
  );
  const jobStarted = ops.some((o) => !!o.actualStart);
  const placedLines = useMemo(
    () => purchases.filter((p) => p.status !== 'DRAFT' && p.status !== 'CANCELLED'),
    [purchases]
  );
  const outstandingLines = useMemo(
    () => placedLines.filter((p) => !p.dateReceived),
    [placedLines]
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

  const backTo = isWorker
    ? '/my-assignments'
    : jobOrdersListPath(job?.status);

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
    let category: ReworkReasonCategory | undefined;
    let note = '';
    Modal.confirm({
      title: `Send “${op.operationName}” for redo`,
      content: (
        <div style={{ marginTop: 8 }}>
          <div style={{ marginBottom: 8, fontSize: 13, color: '#475569' }}>Category</div>
          <Select
            style={{ width: '100%', marginBottom: 12 }}
            placeholder="Select reason category"
            options={REWORK_CATEGORY_OPTIONS}
            onChange={(v: ReworkReasonCategory) => {
              category = v;
            }}
          />
          <div style={{ marginBottom: 8, fontSize: 13, color: '#475569' }}>Note (optional)</div>
          <Input.TextArea
            rows={3}
            placeholder="Extra detail"
            onChange={(e) => {
              note = e.target.value;
            }}
          />
        </div>
      ),
      okText: 'Create redo operation',
      onOk: async () => {
        if (!category) {
          message.error('Category is required');
          return Promise.reject();
        }
        if (category === 'OTHER' && !note.trim()) {
          message.error('Note is required when category is Other');
          return Promise.reject();
        }
        setReworkLoading(op.id);
        try {
          await operationsApi.rework(op.id, {
            category,
            reason: note.trim() || undefined,
          });
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

  const handleMarkMaterialReceived = async (receivedDate?: string) => {
    if (!job) return;
    setMarkingMaterial(true);
    try {
      const { data } = await jobOrdersApi.markMaterialReceived(job.id, receivedDate);
      setJob(data);
      await fetchPurchases();
      message.success('All outstanding materials marked received');
    } catch (err) {
      message.error(getErrorMessage(err));
      throw err;
    } finally {
      setMarkingMaterial(false);
    }
  };

  const openMaterialReceived = () => {
    let receivedDate = dayjs();
    Modal.confirm({
      title: 'Mark material received?',
      content: (
        <div style={{ marginTop: 8 }}>
          <div style={{ marginBottom: 8, fontSize: 13, color: '#475569' }}>
            Every purchase line still on order will be marked received on this date.
          </div>
          <div style={{ marginBottom: 8, fontSize: 13, color: '#475569' }}>Date received</div>
          <DatePicker
            style={{ width: '100%' }}
            defaultValue={dayjs()}
            format="YYYY-MM-DD"
            allowClear={false}
            onChange={(d) => {
              if (d) receivedDate = d;
            }}
          />
        </div>
      ),
      okText: 'Mark received',
      onOk: () => handleMarkMaterialReceived(receivedDate.format('YYYY-MM-DD')),
    });
  };

  const markLineReceived = (p: MaterialPurchase) => {
    let receivedDate = dayjs();
    Modal.confirm({
      title: `Mark “${p.materialName}” received?`,
      content: (
        <div style={{ marginTop: 8 }}>
          <DatePicker
            style={{ width: '100%' }}
            defaultValue={dayjs()}
            format="YYYY-MM-DD"
            allowClear={false}
            onChange={(d) => {
              if (d) receivedDate = d;
            }}
          />
        </div>
      ),
      okText: 'Mark received',
      onOk: async () => {
        if (!job) return;
        try {
          await jobOrdersApi.markPurchaseReceived(
            job.id,
            p.id,
            receivedDate.format('YYYY-MM-DD')
          );
          message.success('Line marked received');
          await fetchPurchases();
          await fetchJob();
        } catch (err) {
          message.error(getErrorMessage(err));
          throw err;
        }
      },
    });
  };

  const runOpAction = async (op: Operation, action: 'start' | 'resume' | 'complete') => {
    setActionLoading(op.id);
    try {
      const ts = new Date().toISOString();
      if (action === 'start') await operationsApi.start(op.id, ts);
      else if (action === 'resume') await operationsApi.resume(op.id, ts);
      else await operationsApi.complete(op.id, ts);
      message.success(
        action === 'start'
          ? 'Operation started'
          : action === 'resume'
            ? 'Operation resumed'
            : 'Operation completed',
      );
      await fetchJob();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  const confirmPause = async (reason: OperationPauseReason) => {
    if (!pauseForOp) return;
    setActionLoading(pauseForOp.id);
    try {
      await operationsApi.pause(pauseForOp.id, reason, undefined, new Date().toISOString());
      message.success('Operation paused');
      setPauseForOp(null);
      await fetchJob();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  const openIssueInvoice = () => {
    if (!job) return;
    invoiceForm.setFieldsValue({
      invoiceDate: dayjs(),
      description: job.description?.trim() || job.title,
      subtotal: job.amount ?? null,
      applyVat: false,
    });
    setInvoiceOpen(true);
  };

  const onIssueInvoice = async (values: {
    invoiceDate: Dayjs;
    description: string;
    subtotal: number;
    applyVat?: boolean;
  }) => {
    if (!job) return;
    setInvoiceSaving(true);
    try {
      const { data } = await jobOrdersApi.issueInvoice(job.id, {
        invoiceDate: values.invoiceDate.format('YYYY-MM-DD'),
        description: values.description,
        subtotal: values.subtotal,
        vatRate: values.applyVat ? VAT_RATE_PCT : null,
      });
      message.success(`Invoice ${data.invoiceNumber} issued`);
      setInvoiceOpen(false);
      await fetchJob();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setInvoiceSaving(false);
    }
  };

  const toggleFromStock = async (materialId: string, fromStock: boolean) => {
    if (!job) return;
    setStockSavingId(materialId);
    try {
      const { data } = await jobOrdersApi.setPlannedMaterialFromStock(job.id, materialId, fromStock);
      setJob(data);
      message.success(fromStock ? 'Marked From stock: it will not be ordered' : 'Material needs ordering again');
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setStockSavingId(null);
    }
  };

  const handleSetMaterialNotRequired = () => {
    if (!job) return;
    Modal.confirm({
      title: 'Set material to Not required?',
      content:
        'Use this only when the shop already has the material for this job. The first operation will then be able to start without a purchase.',
      okText: 'Set not required',
      onOk: async () => {
        try {
          await jobOrdersApi.update(job.id, { materialStatus: 'NOT_REQUIRED' });
          message.success('Material set to Not required');
          await fetchJob();
        } catch (err) {
          message.error(getErrorMessage(err));
          throw err;
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

  const handleDelete = () => {
    if (!job) return;
    const label = job.jobNumber || 'This job order';
    Modal.confirm({
      title: 'Delete this pending job?',
      content: `${label} will be permanently removed. This cannot be undone.`,
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          await jobOrdersApi.delete(job.id);
          message.success('Pending job deleted');
          navigate(backTo, { replace: true });
        } catch (err) {
          message.error(getErrorMessage(err));
          throw err;
        }
      },
    });
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
  const isInvoicedOrDelivered = Boolean(job.salesInvoice) || job.status === 'DELIVERED';
  const isNotStarted = (op: Operation) =>
    op.status !== 'IN_PROGRESS' && op.status !== 'COMPLETED' && !op.actualStart;
  const canRepropose =
    !isDraft && job.status !== 'DELIVERED' && (job.operations || []).some(isNotStarted);

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
        <Space wrap align="center">
          {isDraft && isAdmin && (
            <Button
              type="primary"
              onClick={() => navigate(`/job-orders/${job.id}/plan`)}
            >
              Plan
            </Button>
          )}
          {canManage && (
            <>
              <JobScheduleColorPicker
                value={job.scheduleColor}
                onChange={async (hex) => {
                  const prev = job.scheduleColor;
                  setJob({ ...job, scheduleColor: hex });
                  try {
                    const { data } = await jobOrdersApi.update(job.id, {
                      scheduleColor: hex,
                    });
                    setJob((j) =>
                      j ? { ...j, scheduleColor: data.scheduleColor ?? hex } : j
                    );
                  } catch (err) {
                    setJob((j) => (j ? { ...j, scheduleColor: prev } : j));
                    message.error(getErrorMessage(err));
                  }
                }}
              />
              <Button
                icon={<EditOutlined />}
                onClick={() => navigate(`/job-orders/${job.id}/edit`)}
              >
                {isDraft ? 'Edit details' : 'Edit'}
              </Button>
            </>
          )}
          <Button
            icon={<PrinterOutlined />}
            onClick={() => navigate(`/job-orders/${job.id}/print`)}
          >
            Print
          </Button>
          {isOfficeStaff &&
            job.materialStatus &&
            job.materialStatus !== 'NOT_REQUIRED' &&
            job.materialStatus !== 'RECEIVED' && (
              <Tooltip
                title={
                  placedLines.length === 0
                    ? 'Nothing has been ordered yet. Material on a draft supplier order counts once the order is issued.'
                    : undefined
                }
              >
                <Button
                  icon={<CheckOutlined />}
                  loading={markingMaterial}
                  disabled={placedLines.length === 0}
                  onClick={openMaterialReceived}
                >
                  Material received
                </Button>
              </Tooltip>
            )}
          {canManage && job.salesInvoice && (
            <Button
              icon={<FileTextOutlined />}
              onClick={() => navigate(`/job-orders/${job.id}/invoice/print`)}
            >
              Invoice {job.salesInvoice.invoiceNumber}
            </Button>
          )}
          {canManage && job.status === 'COMPLETED' && !job.salesInvoice && (
            <Button type="primary" icon={<FileTextOutlined />} onClick={openIssueInvoice}>
              Issue invoice
            </Button>
          )}
          {canManage && job.status === 'COMPLETED' && (
            <Tooltip
              title={job.salesInvoice ? undefined : 'Issue a sales invoice before delivery'}
            >
              <Button
                type={job.salesInvoice ? 'primary' : 'default'}
                icon={<CheckOutlined />}
                loading={delivering}
                disabled={!job.salesInvoice}
                onClick={handleDeliver}
              >
                Deliver
              </Button>
            </Tooltip>
          )}
          {isAdmin && canRepropose && (
            <Button icon={<ReloadOutlined />} onClick={() => setReproposeOpen(true)}>
              Re-propose schedule
            </Button>
          )}
          {canManage && isDraft && (
            <Button danger icon={<DeleteOutlined />} onClick={handleDelete}>
              Delete
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
            <StatusPill color={status.color}>
              {status.label}
              {isDraft && job.draftStage ? ` · ${job.draftStage}` : ''}
            </StatusPill>
            {priority && <StatusPill color={priority.color}>{priority.label}</StatusPill>}
            <MaterialWaitTag wait={job} compact={false} />
            <MaterialDelayTag job={job} compact={false} />
            <span style={{ fontSize: 13, color: overdue ? '#7A1528' : MUTED, fontWeight: 600 }}>
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

      {canManage && job.materialDelay ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            job.materialDelay.kind === 'MATERIAL'
              ? 'Schedule moved later because of materials'
              : 'Rescheduled because the planned start date had passed'
          }
          description={
            <>
              <div>
                Originally planned to start {fmtDateTime(job.materialDelay.originalStart)}
                {job.materialDelay.currentStart
                  ? `; now starts ${fmtDateTime(job.materialDelay.currentStart)}`
                  : ''}
                .
              </div>
              {job.materialDelay.reason && <div>{job.materialDelay.reason}</div>}
              {job.materialDelay.supplierOrderId && (
                <div>
                  Supplier order:{' '}
                  <a onClick={() => navigate(`/supplier-orders/${job.materialDelay!.supplierOrderId}`)}>
                    {job.materialDelay.poNumber || 'View order'}
                  </a>
                </div>
              )}
            </>
          }
        />
      ) : null}

      {canManage && job.materialStatus !== 'NOT_REQUIRED' && outstandingLines.length > 0 && !jobStarted ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="The first operation cannot start until all materials are received"
          description={
            <>
              Still on order:{' '}
              {outstandingLines
                .map((p) => (p.gradeOrSpec ? `${p.materialName} (${p.gradeOrSpec})` : p.materialName))
                .join(', ')}
              .
            </>
          }
        />
      ) : null}

      {canManage &&
      job.materialStatus !== 'NOT_REQUIRED' &&
      placedLines.length === 0 &&
      !jobStarted ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="The first operation cannot start: no materials have been ordered"
          description={
            (purchases.some((p) => p.status === 'DRAFT')
              ? 'This job\u2019s materials are on a draft supplier order that has not been issued yet. '
              : isOfficeStaff
                ? 'Nothing has been ordered for this job. Use Order materials below. '
                : 'Nothing has been ordered for this job. Office Staff order it from the Materials section. ') +
            (isAdmin
              ? 'If the shop already has a material, mark it From stock under Materials, or set the whole job to Not required.'
              : 'If the shop already has a material, ask the Admin to mark it From stock.')
          }
          action={
            isAdmin ? (
              <Button size="small" onClick={handleSetMaterialNotRequired}>
                Set not required
              </Button>
            ) : undefined
          }
        />
      ) : null}

      <Row gutter={[16, 16]} align="top" style={{ marginBottom: 24 }}>
        <Col xs={24} lg={16}>
          <div id="supplier-orders" style={{ ...cardStyle(), marginBottom: 16, scrollMarginTop: 80 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                marginBottom: 12,
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 14, color: NAVY }}>Materials</div>
              {isOfficeStaff && job.materialStatus !== 'NOT_REQUIRED' ? (
                <Button type="primary" onClick={() => setPurchaseOpen(true)}>
                  Order materials
                </Button>
              ) : null}
            </div>
            <div style={SUBHEAD}>Planned</div>
            {!job.rawMaterials?.length ? (
              <Text type="secondary">—</Text>
            ) : job.plannedMaterials?.length ? (
              <PlannedMaterialsTable
                materials={job.plannedMaterials}
                showStatus={job.materialStatus !== 'NOT_REQUIRED'}
                renderAction={(m) =>
                  isAdmin &&
                  (m.fromStock || (m.purchasedQuantity === 0 && m.draftQuantity === 0)) ? (
                    <div>
                      <Button
                        type="link"
                        size="small"
                        style={{ padding: 0, fontSize: 11 }}
                        loading={stockSavingId === m.id}
                        onClick={() => toggleFromStock(m.id, !m.fromStock)}
                      >
                        {m.fromStock ? 'Buy it instead' : 'Use from stock'}
                      </Button>
                    </div>
                  ) : null
                }
              />
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
            {canManage && job.materialStatus !== 'NOT_REQUIRED' ? (
              <div style={{ marginTop: 18 }}>
                <div style={SUBHEAD}>On supplier orders</div>
                {purchases.length === 0 ? (
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    Nothing ordered yet.
                  </Text>
                ) : (
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={purchases}
                    columns={[
                      {
                        title: 'Material',
                        key: 'material',
                        render: (_: unknown, r: MaterialPurchase) => (
                          <>
                            <div style={{ color: NAVY, fontWeight: 600 }}>{r.materialName}</div>
                            <div style={{ fontSize: 11, color: MUTED }}>
                              {[r.gradeOrSpec, `${r.quantity} ${r.unit}`, `${fmtMoney(r.unitCost)} each`]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                            {!r.plannedMaterialId && job.rawMaterials?.length ? (
                              <div style={{ fontSize: 11, color: MUTED }}>Not on the planned list</div>
                            ) : null}
                          </>
                        ),
                      },
                      {
                        title: 'Supplier order',
                        key: 'po',
                        render: (_: unknown, r: MaterialPurchase) => (
                          <>
                            <div>{r.supplierName || '—'}</div>
                            {r.supplierOrderId ? (
                              <Space size={6} wrap>
                                <a onClick={() => navigate(`/supplier-orders/${r.supplierOrderId}`)}>
                                  {r.poNumber || 'Draft (not issued)'}
                                </a>
                                {r.orderStatus ? (
                                  <StatusPill color={ORDER_STATUS_PILL[r.orderStatus].color} compact>
                                    {ORDER_STATUS_PILL[r.orderStatus].label}
                                  </StatusPill>
                                ) : null}
                              </Space>
                            ) : (
                              <div style={{ fontSize: 11, color: MUTED }}>Recorded without a PO</div>
                            )}
                          </>
                        ),
                      },
                      {
                        title: 'Dates',
                        key: 'dates',
                        width: 150,
                        render: (_: unknown, r: MaterialPurchase) => (
                          <div style={{ fontSize: 12, color: MUTED }}>
                            <div>Ordered {r.dateOrdered ? fmtDate(r.dateOrdered) : '—'}</div>
                            {r.dateReceived ? (
                              <div>Received {fmtDate(r.dateReceived)}</div>
                            ) : r.expectedDeliveryDate ? (
                              <div>Expected {fmtDate(r.expectedDeliveryDate)}</div>
                            ) : null}
                          </div>
                        ),
                      },
                      {
                        title: 'Status',
                        key: 'status',
                        width: 120,
                        render: (_: unknown, r: MaterialPurchase) => {
                          const pill =
                            PURCHASE_STATUS_PILL[r.status || (r.dateReceived ? 'RECEIVED' : 'ORDERED')] ||
                            PURCHASE_STATUS_PILL.ORDERED;
                          const canReceive =
                            isOfficeStaff &&
                            !r.dateReceived &&
                            r.status !== 'DRAFT' &&
                            r.status !== 'CANCELLED';
                          return (
                            <>
                              <StatusPill color={pill.color} compact>
                                {pill.label}
                              </StatusPill>
                              {canReceive ? (
                                <div style={{ marginTop: 4 }}>
                                  <Button size="small" onClick={() => markLineReceived(r)}>
                                    Received
                                  </Button>
                                </div>
                              ) : null}
                            </>
                          );
                        },
                      },
                    ]}
                  />
                )}
                <div style={{ marginTop: 10 }}>
                  <MaterialArrivalNote readiness={job.materialReadiness} />
                </div>
              </div>
            ) : null}
          </div>

          <div style={cardStyle({ marginBottom: 16 })}>
            <div style={{ fontWeight: 800, fontSize: 14, color: NAVY, marginBottom: 12 }}>
              Operations
            </div>
            {ops.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {!isDraft
                    ? 'No operations on this job.'
                    : isAdmin
                      ? 'No operations yet. Add them in the planning step.'
                      : 'No operations yet. The Admin adds them in the planning step.'}
                </Text>
                {isDraft && isAdmin ? (
                  <Button size="small" onClick={() => navigate(`/job-orders/${job.id}/plan`)}>
                    Open planning
                  </Button>
                ) : null}
              </div>
            ) : (
              <div style={{ position: 'relative', paddingLeft: 4 }}>
                {ops.map((op, index) => {
                  const done = op.status === 'COMPLETED';
                  const active = op.status === 'IN_PROGRESS';
                  const isLast = index === ops.length - 1;
                  const opSt = OP_STATUS[op.status] || OP_STATUS.PENDING;
                  const isMine = op.assignedWorkerId === user?.id;
                  const canStart =
                    !isDraft &&
                    isMine &&
                    (op.status === 'PENDING' || op.status === 'SCHEDULED' || op.status === 'REWORK') &&
                    ops.slice(0, index).every((o) => o.status === 'COMPLETED');
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
                            {isAdmin && !isDraft && !isInvoicedOrDelivered && isNotStarted(op) ? (
                              <OperationWorkerSelect op={op} onAssigned={fetchJob} />
                            ) : (
                              dash(op.assignedWorkerName)
                            )}
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

                        {op.reworkReasonCategory || op.reworkReason ? (
                          <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>
                            Redo reason
                            {op.reworkReasonCategory
                              ? `: ${reworkCategoryLabel(op.reworkReasonCategory)}`
                              : ''}
                            {op.reworkReason
                              ? `${op.reworkReasonCategory ? ' — ' : ': '}${op.reworkReason}`
                              : ''}
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

                        {!isDraft && isMine && (canStart || active) && (
                          <Space wrap style={{ marginTop: 10 }}>
                            {canStart && (
                              <Tooltip
                                title={
                                  job.waitingForMaterials
                                    ? job.materialWaitReason
                                    : undefined
                                }
                              >
                                <Button
                                  type="primary"
                                  size="small"
                                  loading={actionLoading === op.id}
                                  disabled={!!job.waitingForMaterials}
                                  onClick={() => runOpAction(op, 'start')}
                                >
                                  Start
                                </Button>
                              </Tooltip>
                            )}
                            {canStart && job.waitingForMaterials && (
                              <span style={{ fontSize: 12, color: '#d97706', fontWeight: 600 }}>
                                Waiting for materials
                              </span>
                            )}
                            {active && !op.isPaused && (
                              <>
                                <Button
                                  size="small"
                                  loading={actionLoading === op.id}
                                  onClick={() => setPauseForOp(op)}
                                >
                                  Pause
                                </Button>
                                <Button
                                  type="primary"
                                  size="small"
                                  loading={actionLoading === op.id}
                                  onClick={() => runOpAction(op, 'complete')}
                                >
                                  Complete
                                </Button>
                              </>
                            )}
                            {active && op.isPaused && (
                              <Button
                                type="primary"
                                size="small"
                                loading={actionLoading === op.id}
                                onClick={() => runOpAction(op, 'resume')}
                              >
                                Resume
                              </Button>
                            )}
                          </Space>
                        )}

                        {canManage && !isDraft && !isInvoicedOrDelivered && op.status === 'COMPLETED' && (
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
              </div>
            )}
          </div>
        </Col>

        <Col xs={24} lg={8}>
          <div style={cardStyle({ marginBottom: 16 })}>
            <div style={{ fontWeight: 800, fontSize: 14, color: NAVY, marginBottom: 12 }}>
              Details
            </div>
            <div style={DETAIL_GRID}>
              <DetailRow label="Client PO #" value={dash(job.clientPoNumber)} />
              <DetailRow label="PO date" value={fmtDate(job.poDate)} />
              <DetailRow label="Job type" value={friendlyEnum(job.jobType, JOB_TYPE_LABEL)} />
              <DetailRow
                label="Material"
                value={
                  job.materialStatus === 'NOT_REQUIRED'
                    ? 'Not required'
                    : job.materialStatus === 'RECEIVED'
                      ? `Received ${fmtDate(job.materialReceivedDate)}`
                      : job.materialStatus === 'ORDERED'
                        ? `Ordered · expected ${fmtDate(job.materialReadiness?.expectedDate)}`
                        : job.materialStatus === 'TO_ORDER'
                          ? 'To order'
                          : '—'
                }
              />
              <DetailRow
                label="Stage of the part"
                value={friendlyEnum(job.partCondition, PART_STAGE_LABEL)}
              />
              <DetailRow label="Created" value={fmtDate(job.createdAt)} />
            </div>
            {job.description ? (
              <div style={{ marginTop: 14, fontSize: 13, color: MUTED }}>
                <div style={SUBHEAD}>Description</div>
                {job.description}
              </div>
            ) : null}
          </div>

          {jobStarted ? (
            <div style={cardStyle({ marginBottom: 16 })}>
              <div style={{ fontWeight: 800, fontSize: 14, color: NAVY, marginBottom: 12 }}>
                Time taken
              </div>
              <div style={DETAIL_GRID}>
                <DetailRow label="Target hours" value={fmtHours(totals.estimated)} />
                <DetailRow label="Hours worked" value={fmtHours(totals.worked)} />
                <DetailRow
                  label="Difference from target"
                  value={fmtVariance(totals.varianceHours, null)}
                />
              </div>
            </div>
          ) : null}

          {canManage ? (
            <div style={cardStyle({ marginBottom: 16 })}>
              <div style={{ fontWeight: 800, fontSize: 14, color: NAVY, marginBottom: 4 }}>
                Activity
              </div>
              <Collapse
                size="small"
                ghost
                items={[
                  {
                    key: 'breakdowns',
                    label: (
                      <ActivityLabel
                        title="Machine breakdowns"
                        count={breakdowns.length}
                        alert={
                          breakdowns.some((b) => !b.endedAt) ? 'still down' : undefined
                        }
                      />
                    ),
                    children: breakdowns.length ? (
                      breakdowns.map((b) => (
                        <div key={b.id} style={ACTIVITY_ROW}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <span style={{ fontWeight: 700, color: NAVY }}>{b.machineUnitLabel}</span>
                            {b.endedAt ? null : (
                              <StatusPill color="red" compact>
                                Still down
                              </StatusPill>
                            )}
                          </div>
                          <div>
                            {b.reason}
                            {b.operationName ? ` · ${b.operationName}` : ''}
                          </div>
                          <div>
                            {fmtDateTime(b.startedAt)} → {b.endedAt ? fmtDateTime(b.endedAt) : 'now'}
                            {b.reportedByName ? ` · ${b.reportedByName}` : ''}
                          </div>
                          {b.note ? <div>{b.note}</div> : null}
                        </div>
                      ))
                    ) : (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        No breakdowns linked to this job.
                      </Text>
                    ),
                  },
                  {
                    key: 'notifications',
                    label: (
                      <ActivityLabel
                        title="Client notifications"
                        count={notifications?.length ?? 0}
                        alert={
                          notifications?.some((n) => n.status === 'FAILED') ? 'failed' : undefined
                        }
                      />
                    ),
                    children:
                      notifications == null ? (
                        <Spin size="small" />
                      ) : notifications.length ? (
                        notifications.map((n) => (
                          <div key={n.id} style={ACTIVITY_ROW}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                              <span style={{ fontWeight: 700, color: NAVY }}>
                                {friendlyEnum(n.milestone, NOTIF_UPDATE_LABEL)}
                              </span>
                              <span style={{ color: n.status === 'FAILED' ? '#b91c1c' : MUTED }}>
                                {friendlyEnum(n.status, NOTIF_STATUS_LABEL)}
                              </span>
                            </div>
                            <div>
                              {friendlyEnum(n.channel, NOTIF_CHANNEL_LABEL)} to {n.recipient}
                            </div>
                            <div>
                              {n.sentAt
                                ? `Sent ${dayjs(n.sentAt).format('MMM D, HH:mm')}`
                                : n.createdAt
                                  ? `Queued ${dayjs(n.createdAt).format('MMM D, HH:mm')}`
                                  : '—'}
                            </div>
                            {n.status === 'FAILED' ? (
                              <Button
                                size="small"
                                style={{ marginTop: 4 }}
                                loading={resendingId === n.id}
                                onClick={() => handleResend(n.id)}
                              >
                                Send again
                              </Button>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          No client notifications sent for this job yet.
                        </Text>
                      ),
                  },
                ]}
              />
            </div>
          ) : null}
        </Col>
      </Row>

      <Modal
        open={invoiceOpen}
        onCancel={() => setInvoiceOpen(false)}
        footer={null}
        title="Issue sales invoice"
        destroyOnHidden
      >
        <Form form={invoiceForm} layout="vertical" onFinish={onIssueInvoice}>
          <Form.Item name="invoiceDate" label="Invoice date" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" allowClear={false} />
          </Form.Item>
          <Form.Item name="description" label="Description" rules={[{ required: true }]}>
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} />
          </Form.Item>
          <Form.Item
            name="subtotal"
            label="Amount (subtotal)"
            extra="Defaults to the job order amount. Adjust before issuing if needed."
            rules={[{ required: true, message: 'Enter the invoice amount' }]}
          >
            <InputNumber min={0} precision={2} prefix="₱" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="applyVat" valuePropName="checked">
            <Checkbox>Add VAT ({VAT_RATE_PCT}%)</Checkbox>
          </Form.Item>
          {(() => {
            const sub = Number(invoiceSubtotal || 0);
            const vat = invoiceApplyVat ? Math.round(sub * VAT_RATE_PCT) / 100 : 0;
            return (
              <div style={{ fontSize: 13, color: MUTED, marginBottom: 16 }}>
                {invoiceApplyVat ? <div>VAT: {fmtMoney(vat)}</div> : null}
                <div style={{ fontWeight: 700, color: NAVY, fontSize: 15 }}>
                  Total: {fmtMoney(sub + vat)}
                </div>
              </div>
            );
          })()}
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setInvoiceOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={invoiceSaving}>
              Issue invoice
            </Button>
          </Space>
        </Form>
      </Modal>

      <OrderMaterialsModal
        open={purchaseOpen}
        onClose={() => setPurchaseOpen(false)}
        jobId={job.id}
        defaultSupplierId={job.supplierId}
        onSaved={async (order) => {
          setPurchaseOpen(false);
          await fetchPurchases();
          await fetchJob();
          Modal.info({
            title: 'Added to the draft supplier order',
            content: `The lines are on the ${order.supplierName} draft order (${order.lineCount} line${
              order.lineCount === 1 ? '' : 's'
            }, ${order.jobCount} job${order.jobCount === 1 ? '' : 's'}). The material counts as ordered once the Admin issues it.`,
            okText: 'Open supplier order',
            onOk: () => navigate(`/supplier-orders/${order.id}`),
            closable: true,
          });
        }}
      />

      {reproposeOpen && (
        <ReproposeModal
          jobId={job.id}
          onClose={() => setReproposeOpen(false)}
          onConfirmed={async () => {
            setReproposeOpen(false);
            await fetchJob();
          }}
        />
      )}

      <Modal
        open={Boolean(pauseForOp)}
        title="Pause operation"
        onCancel={() => setPauseForOp(null)}
        footer={null}
        destroyOnHidden
        centered
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Why are you pausing {pauseForOp?.operationName || 'this operation'}?
        </Text>
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          {PAUSE_REASONS.map((r) => (
            <Button
              key={r.value}
              block
              loading={actionLoading === pauseForOp?.id}
              onClick={() => confirmPause(r.value)}
            >
              {r.label}
            </Button>
          ))}
        </Space>
      </Modal>

    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div style={{ color: MUTED }}>{label}</div>
      <div style={{ color: NAVY, fontWeight: 600, textAlign: 'right' }}>{value}</div>
    </>
  );
}

function ActivityLabel({ title, count, alert }: { title: string; count: number; alert?: string }) {
  return (
    <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>
      {title}
      <span style={{ color: MUTED, fontWeight: 400 }}> · {count}</span>
      {alert ? <span style={{ color: '#b91c1c', fontWeight: 600 }}> · {alert}</span> : null}
    </span>
  );
}
