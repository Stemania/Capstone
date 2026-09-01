import { useEffect, useMemo, useRef, useState } from 'react';
import {
  InputNumber,
  Button,
  Select,
  Typography,
  Alert,
  Tag,
  Spin,
  Table,
  Tooltip,
  Space,
  message,
} from 'antd';
import SplitActionButton from '../../components/SplitActionButton';
import type { ColumnsType } from 'antd/es/table';
import {
  CalendarOutlined,
  DeleteOutlined,
  PlusOutlined,
  StarFilled,
  ArrowUpOutlined,
  ArrowDownOutlined,
  ArrowLeftOutlined,
  CheckCircleFilled,
} from '@ant-design/icons';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { jobOrdersApi, workersApi } from '../../api/jobOrders.api';
import { operationTypesApi } from '../../api/users.api';
import { getErrorMessage } from '../../api/client';
import { MACHINE_OPTIONS } from '../../types';
import ScheduleProposalPanel from './ScheduleProposalPanel';
import ScheduleWeekView from './ScheduleWeekView';
import ScheduleExpandShell from '../schedule/ScheduleExpandShell';
import JobOrderFlowSteps, {
  resolveJobFlowStep,
  type JobFlowStepId,
} from './JobOrderFlowSteps';
import type {
  JobOrder,
  MachineInfo,
  MachineUnitInfo,
  OperationType,
  ProposedOperation,
  ScheduleWarning,
  User,
  WorkerSuggestion,
} from '../../types';

const { Title, Text } = Typography;

function isPlanningStatus(status: string) {
  return status === 'DRAFT';
}

type OpFormRow = {
  key: string;
  id?: string;
  operationTypeId?: string;
  operationName?: string;
  machineTypeId?: string;
  machineUnitId?: string;
  assignedWorkerId?: string;
  estimatedHours?: number | null;
  scheduledStart?: string;
  scheduledEnd?: string;
  status?: string;
};

function machineOptionsForRow(catalog: MachineInfo[], operations: OpFormRow[], rowIndex: number) {
  const reservedByOthers: Record<string, number> = {};
  operations.forEach((op, i) => {
    if (i === rowIndex) return;
    if (op.status === 'IN_PROGRESS' || op.status === 'COMPLETED') return;
    const code = catalog.find((m) => m.id === op.machineTypeId)?.code;
    if (!code) return;
    reservedByOthers[code] = (reservedByOthers[code] || 0) + 1;
  });
  const selectedId = operations[rowIndex]?.machineTypeId;
  return catalog
    .map((m) => {
      const baseAvailable = m.available ?? m.units;
      const remaining = Math.max(0, baseAvailable - (reservedByOthers[m.code] || 0));
      const keep = remaining > 0 || m.id === selectedId;
      return {
        value: m.id || m.code,
        label: `${m.name} (${remaining} available)`,
        keep,
      };
    })
    .filter((o) => o.keep)
    .map(({ value, label }) => ({ value, label }));
}

function workerOptions(workers: User[]) {
  return workers.map((w) => {
    const free = w.available !== false;
    const title =
      !free && w.activeJobTitle && w.activeJobTitle !== 'another job'
        ? w.activeJobTitle
        : undefined;
    return {
      value: w.id,
      disabled: !free,
      label: free
        ? w.fullName
        : `${w.fullName} (unavailable${title ? ` · ${title}` : ''})`,
    };
  });
}

function pickBestWorkerId(
  suggestions: WorkerSuggestion[],
  qualifiedWorkers?: User[],
): string | undefined {
  const fromSuggestion = suggestions.find(
    (s) => s.qualified !== false && s.available !== false,
  );
  if (fromSuggestion) return fromSuggestion.workerId;
  const fromList = qualifiedWorkers?.find((w) => w.available !== false);
  return fromList?.id;
}

function newRowKey() {
  return `op-${Math.random().toString(36).slice(2, 10)}`;
}

export default function JobOrderPlanningPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [job, setJob] = useState<JobOrder | null>(null);
  const [wizardStep, setWizardStep] = useState<JobFlowStepId>(2);
  const [operations, setOperations] = useState<OpFormRow[]>([]);
  const [rowWorkers, setRowWorkers] = useState<Record<number, User[]>>({});
  const [machines, setMachines] = useState<MachineInfo[]>(MACHINE_OPTIONS);
  const [operationTypes, setOperationTypes] = useState<OperationType[]>([]);
  const [rowSuggestions, setRowSuggestions] = useState<Record<number, WorkerSuggestion[]>>({});
  const [machineUnits, setMachineUnits] = useState<MachineUnitInfo[]>([]);
  const [scheduleOps, setScheduleOps] = useState<ProposedOperation[] | null>(null);
  const [scheduleMeta, setScheduleMeta] = useState<{
    projectedCompletion?: string | null;
    scheduleFlag?: 'GREEN' | 'AMBER' | 'RED' | null;
  } | null>(null);
  const [scheduleWarnings, setScheduleWarnings] = useState<Record<number, ScheduleWarning[]>>({});
  const [proposing, setProposing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState('');
  const workerFetchSeq = useRef<Record<number, number>>({});
  const suggestionFetchSeq = useRef<Record<number, number>>({});
  const rowDataRef = useRef<
    Record<number, { workers: User[]; suggestions: WorkerSuggestion[] }>
  >({});

  const syncRowWorkerAssignment = (
    rowIndex: number,
    options?: { preserveExisting?: boolean },
  ) => {
    const { preserveExisting = false } = options || {};
    const rowData = rowDataRef.current[rowIndex];
    if (!rowData) return;
    const { workers, suggestions } = rowData;
    if (!workers.length && !suggestions.length) return;

    setOperations((prev) => {
      const row = prev[rowIndex];
      if (!row) return prev;

      if (preserveExisting && row.assignedWorkerId) {
        const worker = workers.find((w) => w.id === row.assignedWorkerId);
        const suggestion = suggestions.find((s) => s.workerId === row.assignedWorkerId);
        const stillValid =
          worker &&
          worker.available !== false &&
          (suggestion ? suggestion.qualified !== false && suggestion.available !== false : true);
        if (stillValid) return prev;
      }

      const bestId = pickBestWorkerId(suggestions, workers);
      if (row.assignedWorkerId === bestId) return prev;
      const next = [...prev];
      next[rowIndex] = { ...row, assignedWorkerId: bestId };
      return next;
    });
  };

  const goToStep = (step: JobFlowStepId) => {
    if (step === 1 && id) {
      navigate(`/job-orders/${id}/edit?step=1`);
      return;
    }
    setWizardStep(step);
    setSearchParams({ step: String(step) }, { replace: true });
  };

  const goBackStep = () => {
    if (!job) {
      navigate('/job-orders');
      return;
    }
    if (!isPlanningStatus(job.status) || wizardStep === 4) {
      navigate(`/job-orders/${job.id}`);
      return;
    }
    if (wizardStep === 2) {
      goToStep(1);
      return;
    }
    if (wizardStep === 3) {
      goToStep(2);
      return;
    }
    navigate('/job-orders');
  };

  const operationsMissingItems = useMemo(() => {
    const items: string[] = [];
    if (operations.length === 0) {
      items.push('Add at least one operation');
      return items;
    }
    operations.forEach((op, index) => {
      const name =
        op.operationName ||
        operationTypes.find((t) => t.id === op.operationTypeId)?.name ||
        `Operation ${index + 1}`;
      if (!op.assignedWorkerId) items.push(`#${index + 1} ${name}: assign a worker`);
      if (op.estimatedHours == null) items.push(`#${index + 1} ${name}: set target hours`);
    });
    return items;
  }, [operations, operationTypes]);

  const canAdvanceToSchedule = operationsMissingItems.length === 0;
  const advanceTooltip = !canAdvanceToSchedule
    ? operationsMissingItems.join('; ')
    : undefined;

  const operationsMissingWorkers = useMemo(
    () =>
      operations
        .map((op, index) => {
          if (op.assignedWorkerId) return null;
          const name =
            op.operationName ||
            operationTypes.find((t) => t.id === op.operationTypeId)?.name ||
            `Operation ${index + 1}`;
          return { index: index + 1, name };
        })
        .filter((x): x is { index: number; name: string } => x != null),
    [operations, operationTypes]
  );

  const canProposeSchedule = operations.length > 0 && operationsMissingWorkers.length === 0;
  const proposeTooltip = !canProposeSchedule
    ? operations.length === 0
      ? 'Add at least one operation first.'
      : `Assign a worker to: ${operationsMissingWorkers.map((o) => `#${o.index} ${o.name}`).join(', ')}`
    : undefined;

  const loadRowWorkers = async (
    rowIndex: number,
    machineTypeId?: string | null,
    clearInvalidAssignment = true
  ) => {
    const seq = (workerFetchSeq.current[rowIndex] || 0) + 1;
    workerFetchSeq.current[rowIndex] = seq;
    try {
      const { data } = await workersApi.list(machineTypeId ? { machineTypeId } : undefined);
      if (workerFetchSeq.current[rowIndex] !== seq) return;
      setRowWorkers((prev) => ({ ...prev, [rowIndex]: data }));
      rowDataRef.current[rowIndex] = {
        workers: data,
        suggestions: rowDataRef.current[rowIndex]?.suggestions || [],
      };
      if (clearInvalidAssignment) {
        syncRowWorkerAssignment(rowIndex);
      }
    } catch {
      if (workerFetchSeq.current[rowIndex] !== seq) return;
      setRowWorkers((prev) => ({ ...prev, [rowIndex]: [] }));
    }
  };

  const loadSuggestions = async (
    rowIndex: number,
    op: OpFormRow,
    options?: { autoAssign?: boolean; preserveExisting?: boolean }
  ) => {
    const { autoAssign = true, preserveExisting = false } = options || {};
    if (!op.operationTypeId && !op.machineTypeId && !op.operationName) {
      setRowSuggestions((prev) => ({ ...prev, [rowIndex]: [] }));
      return;
    }
    const seq = (suggestionFetchSeq.current[rowIndex] || 0) + 1;
    suggestionFetchSeq.current[rowIndex] = seq;
    try {
      const { data } = await workersApi.suggest([], {
        excludeJobId: id,
        excludeOperationId: op.id,
        machineTypeId: op.machineTypeId,
        operationTypeId: op.operationTypeId,
        operationName: op.operationName,
      });
      if (suggestionFetchSeq.current[rowIndex] !== seq) return;
      const suggestions = data.suggestions || [];
      setRowSuggestions((prev) => ({ ...prev, [rowIndex]: suggestions }));
      rowDataRef.current[rowIndex] = {
        workers: rowDataRef.current[rowIndex]?.workers || [],
        suggestions,
      };
      if (!autoAssign) return;
      syncRowWorkerAssignment(rowIndex, { preserveExisting });
    } catch {
      if (suggestionFetchSeq.current[rowIndex] !== seq) return;
      setRowSuggestions((prev) => ({ ...prev, [rowIndex]: [] }));
    }
  };

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [jobRes, machinesRes, unitsRes, typesRes] = await Promise.all([
          jobOrdersApi.get(id),
          jobOrdersApi.machines(),
          jobOrdersApi.machineUnits(),
          operationTypesApi.list(),
        ]);
        if (cancelled) return;
        const j = jobRes.data;
        const land = resolveJobFlowStep(j);
        const rawStep = Number(searchParams.get('step'));
        const requested =
          rawStep === 2 || rawStep === 3 || rawStep === 4 ? (rawStep as JobFlowStepId) : null;

        if (!isPlanningStatus(j.status) && requested !== 4 && land !== 4) {
          message.info('This job is already released. Opening confirmation.');
        }

        let initial: JobFlowStepId = requested || land;
        if (!isPlanningStatus(j.status)) {
          initial = requested && requested <= land ? requested : 4;
        } else if (initial === 4) {
          initial = land >= 2 ? land : 2;
        } else if (initial === 3 && j.status === 'DRAFT') {
          initial = 2;
        } else if (initial < 2) {
          initial = 2;
        }

        setJob(j);
        setWizardStep(initial);
        if (String(searchParams.get('step')) !== String(initial)) {
          setSearchParams({ step: String(initial) }, { replace: true });
        }
        setMachines(machinesRes.data?.length ? machinesRes.data : MACHINE_OPTIONS);
        setMachineUnits(unitsRes.data || []);
        setOperationTypes(typesRes.data || []);
        const opsList = j.operations || [];
        const rows: OpFormRow[] =
          opsList.length > 0
            ? opsList
                .slice()
                .sort((a, b) => a.sequenceNo - b.sequenceNo)
                .map((op) => ({
                  key: op.id || newRowKey(),
                  id: op.id,
                  operationTypeId: op.operationTypeId || undefined,
                  operationName: op.operationName,
                  machineTypeId: op.machineTypeId || undefined,
                  machineUnitId: op.machineUnitId || undefined,
                  assignedWorkerId: op.assignedWorkerId || undefined,
                  estimatedHours: op.estimatedHours,
                  scheduledStart: op.scheduledStart || undefined,
                  scheduledEnd: op.scheduledEnd || undefined,
                  status: op.status,
                }))
            : [
                {
                  key: newRowKey(),
                  operationTypeId: undefined,
                  operationName: '',
                  machineTypeId: undefined,
                  assignedWorkerId: undefined,
                },
              ];
        setOperations(rows);
        rows.forEach((row, index) => {
          void loadRowWorkers(index, row.machineTypeId, false);
          void loadSuggestions(index, row, { preserveExisting: true });
        });
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const patchRow = (index: number, patch: Partial<OpFormRow>) => {
    setOperations((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const onOperationTypeChange = (index: number, typeId: string) => {
    const ot = operationTypes.find((t) => t.id === typeId);
    const machineTypeId = ot?.defaultMachineTypeId || undefined;
    patchRow(index, {
      operationTypeId: typeId,
      operationName: ot?.name || '',
      machineTypeId,
      assignedWorkerId: undefined,
    });
    void loadRowWorkers(index, machineTypeId);
    void loadSuggestions(index, {
      ...operations[index],
      operationTypeId: typeId,
      operationName: ot?.name || '',
      machineTypeId,
    });
  };

  const onMachineTypeChange = (index: number, machineTypeId?: string) => {
    patchRow(index, { machineTypeId, assignedWorkerId: undefined });
    void loadRowWorkers(index, machineTypeId);
    void loadSuggestions(index, {
      ...operations[index],
      machineTypeId,
      assignedWorkerId: undefined,
    });
  };

  const buildOperationsPayload = () =>
    operations.map((op, i) => {
      const mt = machines.find((m) => m.id === op.machineTypeId || m.code === op.machineTypeId);
      const ot = operationTypes.find((t) => t.id === op.operationTypeId);
      return {
        id: op.id,
        sequenceNo: i + 1,
        operationTypeId: op.operationTypeId || null,
        operationName: op.operationName || ot?.name,
        ...(mt?.id ? { machineTypeId: mt.id } : { machinesNeeded: mt ? [mt.code] : [] }),
        assignedWorkerId: op.assignedWorkerId || null,
        estimatedHours: op.estimatedHours ?? null,
        machineUnitId: op.machineUnitId || null,
        scheduledStart: op.scheduledStart || null,
        scheduledEnd: op.scheduledEnd || null,
        status: op.status || 'PENDING',
      };
    });

  const buildReleasePayload = () =>
    buildOperationsPayload().map((op, i) => {
      const proposed = scheduleOps?.find((p) => p.sequenceNo === i + 1);
      if (!proposed?.scheduled) return op;
      return {
        ...op,
        scheduledStart: proposed.scheduledStart || null,
        scheduledEnd: proposed.scheduledEnd || null,
        machineUnitId: proposed.machineUnitId || op.machineUnitId,
        status: 'SCHEDULED',
      };
    });

  const savePlanning = async (exit = false) => {
    if (!id) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await jobOrdersApi.update(id, { operations: buildOperationsPayload() });
      setJob(data);
      message.success(exit ? 'Saved' : 'Planning saved');
      if (exit) navigate('/job-orders');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleViewProposedSchedule = async () => {
    if (!id || !job || !canAdvanceToSchedule) return;
    setProposing(true);
    setError('');
    try {
      const { data: saved } = await jobOrdersApi.update(id, {
        operations: buildOperationsPayload(),
        advanceToPlanning: true,
      });
      setJob(saved);
      const { data } = await jobOrdersApi.proposeSchedule(id, {
        operations: buildOperationsPayload(),
      });
      setScheduleOps(data.operations);
      setScheduleMeta({
        projectedCompletion: data.projectedCompletion,
        scheduleFlag: data.scheduleFlag,
      });
      setScheduleWarnings({});
      goToStep(3);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setProposing(false);
    }
  };

  const handleProposeSchedule = async () => {
    if (!id || !job) return;
    setProposing(true);
    setError('');
    try {
      await jobOrdersApi.update(id, { operations: buildOperationsPayload() });
      const { data } = await jobOrdersApi.proposeSchedule(id, {
        operations: buildOperationsPayload(),
      });
      setScheduleOps(data.operations);
      setScheduleMeta({
        projectedCompletion: data.projectedCompletion,
        scheduleFlag: data.scheduleFlag,
      });
      setScheduleWarnings({});
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setProposing(false);
    }
  };

  const handleScheduleOpChange = (sequenceNo: number, patch: Partial<ProposedOperation>) => {
    setScheduleOps((prev) =>
      (prev || []).map((op) => (op.sequenceNo === sequenceNo ? { ...op, ...patch } : op))
    );
  };

  const runValidateSchedule = async (ops: ProposedOperation[]) => {
    if (!job?.dueDate) return;
    try {
      const { data } = await jobOrdersApi.validateSchedule({
        dueDate: job.dueDate,
        operations: ops.map((op) => ({
          sequenceNo: op.sequenceNo,
          operationName: op.operationName,
          assignedWorkerId: op.assignedWorkerId,
          machineTypeId: op.machineTypeId,
          machineUnitId: op.machineUnitId,
          scheduledStart: op.scheduledStart,
          scheduledEnd: op.scheduledEnd,
        })),
      });
      const bySeq: Record<number, ScheduleWarning[]> = {};
      for (const w of data.warnings || []) {
        bySeq[w.sequenceNo] = [...(bySeq[w.sequenceNo] || []), w];
      }
      setScheduleWarnings(bySeq);
      if (data.projectedCompletion) {
        setScheduleMeta((prev) => ({
          ...prev,
          projectedCompletion: data.projectedCompletion,
          scheduleFlag: data.scheduleFlag ?? prev?.scheduleFlag ?? null,
        }));
      }
    } catch {
      setScheduleWarnings({});
    }
  };

  const handleRelease = async () => {
    if (!id || !scheduleOps?.some((o) => o.scheduled)) return;
    setReleasing(true);
    setError('');
    try {
      await jobOrdersApi.update(id, { operations: buildReleasePayload() });
      const { data } = await jobOrdersApi.release(id);
      setJob(data);
      message.success('Released to production');
      goToStep(4);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setReleasing(false);
    }
  };

  const moveRow = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= operations.length) return;
    setOperations((prev) => {
      const next = [...prev];
      const tmp = next[index];
      next[index] = next[target];
      next[target] = tmp;
      return next;
    });
  };

  if (loading) {
    return (
      <div className="page-spinner">
        <Spin size="large" />
      </div>
    );
  }

  if (!job) {
    return <Alert type="error" message={error || 'Job order not found'} />;
  }

  const qtyLabel =
    job.quantity != null
      ? `${job.quantity}${job.unitOfMeasure ? ` ${job.unitOfMeasure}` : ''}`
      : '—';
  const readOnly = !isPlanningStatus(job.status);
  const canRelease = Boolean(scheduleOps?.some((o) => o.scheduled));

  const columns: ColumnsType<OpFormRow> = [
    {
      title: '#',
      width: 56,
      render: (_: unknown, __: OpFormRow, index: number) => (
        <span style={{ fontWeight: 700, color: '#64748b' }}>{index + 1}</span>
      ),
    },
    {
      title: 'Operation type',
      width: 220,
      render: (_: unknown, record: OpFormRow, index: number) => (
        <Select
          showSearch
          optionFilterProp="label"
          style={{ width: '100%' }}
          placeholder="Operation type"
          value={record.operationTypeId}
          disabled={readOnly}
          options={operationTypes.map((t) => ({ value: t.id, label: t.name }))}
          onChange={(v) => onOperationTypeChange(index, v)}
        />
      ),
    },
    {
      title: 'Machine',
      width: 180,
      render: (_: unknown, record: OpFormRow, index: number) => (
        <Select
          allowClear
          style={{ width: '100%' }}
          placeholder="Machine"
          value={record.machineTypeId}
          disabled={readOnly}
          options={machineOptionsForRow(machines, operations, index)}
          onChange={(v) => onMachineTypeChange(index, v)}
        />
      ),
    },
    {
      title: 'Worker',
      width: 200,
      render: (_: unknown, record: OpFormRow, index: number) => {
        const qualifiedWorkers = rowWorkers[index] || [];
        const rowMachineId =
          record.machineTypeId ||
          operationTypes.find((t) => t.id === record.operationTypeId)?.defaultMachineTypeId;
        return (
          <Select
            allowClear
            style={{ width: '100%' }}
            placeholder={rowMachineId ? 'Qualified workers' : 'Assign worker'}
            value={record.assignedWorkerId}
            disabled={readOnly}
            options={workerOptions(qualifiedWorkers)}
            onChange={(v) => patchRow(index, { assignedWorkerId: v })}
          />
        );
      },
    },
    {
      title: 'Target hours',
      width: 120,
      render: (_: unknown, record: OpFormRow, index: number) => (
        <InputNumber
          style={{ width: '100%' }}
          min={0}
          step={0.5}
          placeholder="Hours"
          value={record.estimatedHours ?? undefined}
          disabled={readOnly}
          onChange={(v) => patchRow(index, { estimatedHours: v })}
        />
      ),
    },
    {
      title: '',
      width: 120,
      render: (_: unknown, __: OpFormRow, index: number) =>
        readOnly ? null : (
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            type="text"
            size="small"
            icon={<ArrowUpOutlined />}
            disabled={index === 0}
            onClick={() => moveRow(index, -1)}
          />
          <Button
            type="text"
            size="small"
            icon={<ArrowDownOutlined />}
            disabled={index === operations.length - 1}
            onClick={() => moveRow(index, 1)}
          />
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={operations.length <= 1}
            onClick={() => {
              setOperations((prev) => prev.filter((_, i) => i !== index));
              setRowWorkers({});
              setRowSuggestions({});
            }}
          />
        </div>
      ),
    },
  ];

  const pageTitle =
    wizardStep === 2
      ? 'Operations'
      : wizardStep === 3
        ? 'Schedule'
        : wizardStep === 4
          ? 'Released'
          : 'Plan Job Order';

  return (
    <div className="jo-form-page">
      <div className="jo-form-page__header">
        <Space wrap size={8}>
          <Button icon={<ArrowLeftOutlined />} onClick={goBackStep}>
            Back
          </Button>
          <div>
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>
              {job.jobNumber || job.id.slice(0, 8).toUpperCase()}
            </Text>
            <Title level={4} style={{ margin: 0, color: '#0f1c2e', lineHeight: 1.25 }}>
              {pageTitle}
            </Title>
          </div>
        </Space>
      </div>

      <JobOrderFlowSteps
        current={wizardStep}
        reached={resolveJobFlowStep(job)}
        maxInteractive={4}
        onStepClick={goToStep}
      />

      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}

      <div className="jo-plan__summary">
        {[
          ['Client', job.clientName || '—'],
          ['Title', job.title],
          ['Date required', job.dueDate ? dayjs(job.dueDate).format('MMM D, YYYY') : '—'],
          ['Quantity', qtyLabel],
          ['Job type', job.jobType?.replace(/_/g, ' ') || '—'],
        ].map(([label, value]) => (
          <div key={label}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
              {label}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#0f1c2e' }}>{value}</div>
          </div>
        ))}
      </div>

      {wizardStep === 4 ? (
        <div className="jo-plan__released">
          <CheckCircleFilled style={{ fontSize: 40, color: '#0f1c2e', marginBottom: 12 }} />
          <h2 className="jo-plan__released-title">Job released to production</h2>
          <p className="jo-plan__released-copy">
            {job.jobNumber || 'This job'} is on the shop floor. Workers can see assigned operations,
            and the client was notified that the job was received.
          </p>
          <div className="jo-plan__released-actions">
            <Link to={`/job-orders/${job.id}`}>
              <Button type="primary" style={{ fontWeight: 600 }}>
                Open job order
              </Button>
            </Link>
            <Link to="/schedule">
              <Button style={{ fontWeight: 600 }}>View schedule board</Button>
            </Link>
          </div>
        </div>
      ) : null}

      {wizardStep === 2 ? (
      <div className="jo-plan__panel">
        <div className="jo-plan__section-title">Operations</div>
        <Table
          size="middle"
          pagination={false}
          rowKey="key"
          dataSource={operations}
          columns={columns}
          expandable={{
            expandedRowRender: (_record, index) => {
              const suggestions = rowSuggestions[index] || [];
              const qualifiedWorkers = rowWorkers[index] || [];
              if (!suggestions.length) return null;
              const qualified = suggestions.filter((s) => s.qualified !== false);
              const unqualified = suggestions.filter((s) => s.qualified === false);
              const topId = qualified[0]?.workerId;
              const assignedId = operations[index]?.assignedWorkerId;
              return (
                <div style={{ padding: '4px 0' }}>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
                    Best match auto-selected — click another to override
                  </Text>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {qualified.slice(0, 5).map((s) => {
                      const inDropdown = qualifiedWorkers.some((w) => w.id === s.workerId);
                      const isTop = s.workerId === topId;
                      const isAssigned = s.workerId === assignedId;
                      return (
                        <div
                          key={s.workerId}
                          onClick={() => {
                            if (!inDropdown || readOnly) return;
                            patchRow(index, { assignedWorkerId: s.workerId });
                          }}
                          style={{
                            cursor: inDropdown && !readOnly ? 'pointer' : 'not-allowed',
                            opacity: inDropdown ? 1 : 0.55,
                            padding: '6px 10px',
                            borderRadius: 6,
                            border: isAssigned
                              ? '1.5px solid #c9a227'
                              : isTop
                                ? '1px solid #e8e8e8'
                                : '1px solid #e8e8e8',
                            background: isAssigned ? '#fffbeb' : isTop ? '#fafafa' : '#fafafa',
                            minWidth: 160,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {(isTop || isAssigned) && (
                              <StarFilled style={{ color: '#c9a227', fontSize: 12 }} />
                            )}
                            <Text strong style={{ fontSize: 12 }}>
                              {s.fullName}
                            </Text>
                            <Tag
                              color={isAssigned ? 'gold' : 'default'}
                              style={{ margin: 0, fontSize: 11 }}
                            >
                              {(s.score * 100).toFixed(0)}%
                            </Tag>
                          </div>
                          {s.reason && (
                            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                              {s.reason}
                            </Text>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {unqualified.length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ fontSize: 11, color: '#8c8c8c', cursor: 'pointer' }}>
                        Unqualified ({unqualified.length})
                      </summary>
                    </details>
                  )}
                </div>
              );
            },
            rowExpandable: (_record) => {
              const index = operations.findIndex((o) => o.key === _record.key);
              return (rowSuggestions[index] || []).length > 0;
            },
          }}
        />
        {!readOnly && (
          <Button
            type="dashed"
            block
            icon={<PlusOutlined />}
            style={{ marginTop: 12 }}
            onClick={() => {
              setOperations((prev) => [
                ...prev,
                {
                  key: newRowKey(),
                  operationTypeId: undefined,
                  operationName: '',
                  machineTypeId: undefined,
                  assignedWorkerId: undefined,
                },
              ]);
            }}
          >
            Add Operation
          </Button>
        )}

        {wizardStep === 2 && !readOnly ? (
          <div className="jo-plan__footer">
            <Button onClick={goBackStep}>Cancel</Button>
            <Tooltip title={advanceTooltip}>
              <span>
                <SplitActionButton
                  loading={proposing || saving}
                  disabled={!canAdvanceToSchedule}
                  onClick={handleViewProposedSchedule}
                  menu={{
                    items: [
                      {
                        key: 'exit',
                        label: 'Save and exit',
                        onClick: () => savePlanning(true),
                      },
                    ],
                  }}
                >
                  View proposed schedule
                </SplitActionButton>
              </span>
            </Tooltip>
          </div>
        ) : null}
      </div>
      ) : null}

      {wizardStep === 3 ? (
      <div className="jo-plan__panel">
        <div className="jo-plan__section-head">
          <div>
            <div className="jo-plan__section-title">Schedule</div>
            <Text type="secondary" style={{ display: 'block', fontSize: 13 }}>
              Review the proposed schedule, adjust times if needed, then release to production.
            </Text>
          </div>
          {!readOnly && (
            <Tooltip title={proposeTooltip}>
              <span style={{ display: 'inline-block', flexShrink: 0 }}>
                <Button
                  icon={<CalendarOutlined />}
                  loading={proposing}
                  disabled={!canProposeSchedule}
                  onClick={handleProposeSchedule}
                  style={{ fontWeight: 600 }}
                >
                  {scheduleOps ? 'Re-propose Schedule' : 'Propose Schedule'}
                </Button>
              </span>
            </Tooltip>
          )}
        </div>

        {scheduleOps ? (
          <>
            <ScheduleProposalPanel
              operations={scheduleOps}
              projectedCompletion={scheduleMeta?.projectedCompletion}
              scheduleFlag={scheduleMeta?.scheduleFlag}
              warningsBySeq={scheduleWarnings}
              onChangeOp={handleScheduleOpChange}
              onBlurValidate={() => scheduleOps && runValidateSchedule(scheduleOps)}
            />
            <ScheduleExpandShell title="Week view" className="jo-plan__week-wrap">
              <ScheduleWeekView
                jobId={job.id}
                jobNumber={job.jobNumber}
                jobTitle={job.title}
                operations={scheduleOps}
                machineUnits={machineUnits}
              />
            </ScheduleExpandShell>
          </>
        ) : (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 12 }}
            message="Propose a schedule to preview machine and worker timing before release."
          />
        )}

        {wizardStep === 3 && !readOnly ? (
          <div className="jo-plan__footer">
            <Button onClick={goBackStep}>Cancel</Button>
            <Tooltip
              title={!canRelease ? 'Propose a schedule before releasing to production.' : undefined}
            >
              <span>
                <SplitActionButton
                  loading={releasing || saving}
                  disabled={!canRelease}
                  onClick={handleRelease}
                  menu={{
                    items: [
                      {
                        key: 'exit',
                        label: 'Save and exit',
                        onClick: () => savePlanning(true),
                      },
                    ],
                  }}
                >
                  Release to production
                </SplitActionButton>
              </span>
            </Tooltip>
          </div>
        ) : null}
      </div>
      ) : null}
    </div>
  );
}
