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
  Input,
  Row,
  Col,
} from 'antd';
import SplitActionButton from '../../components/SplitActionButton';
import InfoTip from '../../components/InfoTip';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  PlusOutlined,
  StarFilled,
  WarningOutlined,
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
import MaterialOrdersSummary from './MaterialOrdersSummary';
import ScheduleExpandShell from '../schedule/ScheduleExpandShell';
import JobOrderFlowSteps, {
  resolveJobFlowStep,
  type JobFlowStepId,
} from './JobOrderFlowSteps';
import { jobOrdersListPath } from './jobOrderListPaths';
import type {
  JobOrder,
  MachineInfo,
  MachineUnitInfo,
  MaterialStatus,
  OperationType,
  ProposedOperation,
  ScheduleWarning,
  User,
  WorkerSuggestion,
} from '../../types';

const { Title, Text } = Typography;

const MATERIAL_STATUS_OPTIONS: { value: MaterialStatus; label: string }[] = [
  { value: 'TO_ORDER', label: 'To order' },
  { value: 'NOT_REQUIRED', label: 'Not required' },
];

/** Ordered / Received come from purchase lines and are never set here. */
function isDerivedMaterialStatus(s: MaterialStatus) {
  return s === 'ORDERED' || s === 'RECEIVED';
}

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
  notes?: string;
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

function isCheckingType(ot?: OperationType | null, operationName?: string): boolean {
  if (ot) {
    return ot.code === 'CHECKING' || ot.name.trim().toLowerCase() === 'checking';
  }
  return (operationName || '').trim().toLowerCase() === 'checking';
}

function findAdminWorker(workers: User[]): User | undefined {
  return workers.find((w) => w.role === 'ADMIN' && w.active !== false);
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
    materialNotBefore?: string | null;
    materialConstraintReason?: string | null;
  } | null>(null);
  const [materialStatus, setMaterialStatus] = useState<MaterialStatus>('TO_ORDER');
  const materialsNeeded = materialStatus !== 'NOT_REQUIRED';
  const hasMaterialsToBuy = (job?.rawMaterials || []).some((m) => !m.fromStock);
  const linesReadiness =
    materialsNeeded && job?.materialReadiness?.source === 'PURCHASE_LINES'
      ? job.materialReadiness
      : null;
  const unorderedMaterials = materialsNeeded
    ? job?.materialReadiness?.unorderedMaterials || []
    : [];
  const materialsNotOrdered =
    materialsNeeded &&
    (unorderedMaterials.length > 0 ||
      !(job?.materialReadiness?.supplierOrders || []).some(
        (o) => o.status !== 'DRAFT' && o.status !== 'CANCELLED'
      ));
  const noLeadTimeSuppliers = linesReadiness?.missingLeadTimeSuppliers || [];
  const materialDateUnknown = noLeadTimeSuppliers.length > 0;
  const [scheduleWarnings, setScheduleWarnings] = useState<Record<number, ScheduleWarning[]>>({});
  const [proposing, setProposing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
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

      const ot = operationTypes.find((t) => t.id === row.operationTypeId);
      if (isCheckingType(ot, row.operationName)) {
        const admin = findAdminWorker(workers);
        if (!admin || (row.assignedWorkerId === admin.id && !row.machineTypeId)) return prev;
        const next = [...prev];
        next[rowIndex] = {
          ...row,
          machineTypeId: undefined,
          assignedWorkerId: admin.id,
        };
        return next;
      }

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
      navigate(`/job-orders/${id}/edit?from=plan`);
      return;
    }
    setWizardStep(step);
    setSearchParams({ step: String(step) }, { replace: true });
  };

  const goBackStep = () => {
    if (!job) {
      navigate(jobOrdersListPath('DRAFT'));
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
    navigate(jobOrdersListPath(job.status));
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

  const canAdvanceToSchedule =
    operationsMissingItems.length === 0 && !materialDateUnknown;
  const advanceTooltip = !canAdvanceToSchedule
    ? [
        ...operationsMissingItems,
        ...(materialDateUnknown
          ? [`Material arrival unknown: ${noLeadTimeSuppliers.join(', ')} has no lead time`]
          : []),
      ].join('; ')
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
    const seq = (suggestionFetchSeq.current[rowIndex] || 0) + 1;
    suggestionFetchSeq.current[rowIndex] = seq;
    const ot = operationTypes.find((t) => t.id === op.operationTypeId);
    if (isCheckingType(ot, op.operationName)) {
      setRowSuggestions((prev) => ({ ...prev, [rowIndex]: [] }));
      try {
        const { data } = await workersApi.list({ forChecking: true });
        if (suggestionFetchSeq.current[rowIndex] !== seq) return;
        const admin = findAdminWorker(data);
        // Checking: Admin only in the assign list.
        const checkingWorkers = admin ? [admin] : [];
        setRowWorkers((prev) => ({ ...prev, [rowIndex]: checkingWorkers }));
        rowDataRef.current[rowIndex] = { workers: checkingWorkers, suggestions: [] };
        if (admin) {
          setOperations((prev) => {
            const row = prev[rowIndex];
            if (!row) return prev;
            if (row.assignedWorkerId === admin.id && !row.machineTypeId) return prev;
            const next = [...prev];
            next[rowIndex] = {
              ...row,
              machineTypeId: undefined,
              assignedWorkerId: admin.id,
            };
            return next;
          });
        }
      } catch {
        /* keep existing assignment */
      }
      return;
    }
    if (!op.operationTypeId && !op.machineTypeId && !op.operationName) {
      setRowSuggestions((prev) => ({ ...prev, [rowIndex]: [] }));
      return;
    }
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
          message.info('This job is already scheduled. Opening confirmation.');
        }

        let initial: JobFlowStepId = requested || land;
        if (!isPlanningStatus(j.status)) {
          initial = requested && requested <= land ? requested : 4;
        } else if (initial === 4) {
          initial = land >= 2 ? land : 2;
        } else if (initial < 2) {
          initial = 2;
        }

        setJob(j);
        setMaterialStatus(j.materialStatus || 'TO_ORDER');
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
                  notes: op.notes || undefined,
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

        // Restore schedule stage from persisted draft windows.
        if (initial === 3) {
          const restored: ProposedOperation[] = rows
            .map((op, i) => {
              const start = op.scheduledStart || null;
              const end = op.scheduledEnd || null;
              const scheduled = Boolean(start && end);
              return {
                id: op.id,
                sequenceNo: i + 1,
                operationName: op.operationName,
                assignedWorkerId: op.assignedWorkerId || null,
                machineTypeId: op.machineTypeId || null,
                machineUnitId: op.machineUnitId || null,
                machineUnitLabel: op.machineUnitId
                  ? unitsRes.data?.find((u) => u.id === op.machineUnitId)?.label || null
                  : null,
                estimatedHours: op.estimatedHours ?? undefined,
                scheduledStart: start,
                scheduledEnd: end,
                segments: scheduled && start && end ? [{ start, end }] : [],
                scheduled,
              };
            })
            .filter((op) => op.scheduled);
          if (restored.length > 0) {
            setScheduleOps(restored);
            const ends = restored
              .map((op) => op.scheduledEnd)
              .filter((v): v is string => Boolean(v));
            const projected =
              ends.length > 0
                ? ends.reduce((a, b) => (dayjs(a).isAfter(dayjs(b)) ? a : b))
                : null;
            setScheduleMeta({
              projectedCompletion: projected,
              scheduleFlag: j.scheduleFlag ?? null,
            });
          } else {
            setScheduleOps(null);
            setScheduleMeta(null);
          }
        } else {
          setScheduleOps(null);
          setScheduleMeta(null);
        }

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

  const onOperationTypeChange = async (index: number, typeId: string) => {
    const ot = operationTypes.find((t) => t.id === typeId);
    if (isCheckingType(ot)) {
      try {
        const { data } = await workersApi.list({ forChecking: true });
        const admin = findAdminWorker(data);
        const checkingWorkers = admin ? [admin] : [];
        setRowWorkers((prev) => ({ ...prev, [index]: checkingWorkers }));
        setRowSuggestions((prev) => ({ ...prev, [index]: [] }));
        rowDataRef.current[index] = { workers: checkingWorkers, suggestions: [] };
        patchRow(index, {
          operationTypeId: typeId,
          operationName: ot?.name || 'Checking',
          machineTypeId: undefined,
          assignedWorkerId: admin?.id,
        });
      } catch (err) {
        message.error(getErrorMessage(err));
        patchRow(index, {
          operationTypeId: typeId,
          operationName: ot?.name || 'Checking',
          machineTypeId: undefined,
          assignedWorkerId: undefined,
        });
      }
      return;
    }

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
    const row = operations[index];
    if (
      isCheckingType(
        operationTypes.find((t) => t.id === row?.operationTypeId),
        row?.operationName
      )
    ) {
      return;
    }
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
      const ot = operationTypes.find((t) => t.id === op.operationTypeId);
      const checking = isCheckingType(ot, op.operationName);
      const mt = checking
        ? undefined
        : machines.find((m) => m.id === op.machineTypeId || m.code === op.machineTypeId);
      return {
        id: op.id,
        sequenceNo: i + 1,
        operationTypeId: op.operationTypeId || null,
        operationName: op.operationName || ot?.name,
        ...(mt?.id ? { machineTypeId: mt.id } : { machinesNeeded: [] }),
        assignedWorkerId: op.assignedWorkerId || null,
        estimatedHours: op.estimatedHours ?? null,
        machineUnitId: checking ? null : op.machineUnitId || null,
        scheduledStart: op.scheduledStart || null,
        scheduledEnd: op.scheduledEnd || null,
        status: op.status || 'PENDING',
        notes: op.notes?.trim() || null,
      };
    });

  const buildConfirmPayload = () =>
    buildOperationsPayload().map((op, i) => {
      const proposed = scheduleOps?.find((p) => p.sequenceNo === i + 1);
      if (!proposed?.scheduled) return op;
      return {
        ...op,
        scheduledStart: proposed.scheduledStart || null,
        scheduledEnd: proposed.scheduledEnd || null,
        machineUnitId: proposed.machineUnitId || op.machineUnitId,
        assignedWorkerId: proposed.assignedWorkerId || op.assignedWorkerId,
        status: 'SCHEDULED',
      };
    });

  const buildDraftSchedulePayload = () =>
    buildConfirmPayload().map((op) => ({
      ...op,
      // Stay PENDING until the schedule is confirmed; windows alone mark schedule stage.
      status: op.status === 'SCHEDULED' ? 'PENDING' : op.status || 'PENDING',
    }));

  const materialPayload = () =>
    isDerivedMaterialStatus(materialStatus) ? {} : { materialStatus };

  const savePlanning = async (exit = false) => {
    if (!id) return;
    setSaving(true);
    setError('');
    try {
      const operationsPayload =
        wizardStep === 3 && scheduleOps?.some((o) => o.scheduled)
          ? buildDraftSchedulePayload()
          : buildOperationsPayload();
      const { data } = await jobOrdersApi.update(id, {
        operations: operationsPayload,
        ...materialPayload(),
      });
      setJob(data);
      setMaterialStatus(data.materialStatus || materialStatus);
      // Keep form rows in sync with persisted schedule so reopen lands on step 3.
      if (wizardStep === 3 && scheduleOps?.some((o) => o.scheduled)) {
        setOperations((prev) =>
          prev.map((row, i) => {
            const proposed = scheduleOps.find((p) => p.sequenceNo === i + 1);
            if (!proposed?.scheduled) return row;
            return {
              ...row,
              scheduledStart: proposed.scheduledStart || undefined,
              scheduledEnd: proposed.scheduledEnd || undefined,
              machineUnitId: proposed.machineUnitId || row.machineUnitId,
              assignedWorkerId: proposed.assignedWorkerId || row.assignedWorkerId,
            };
          })
        );
      }
      message.success(exit ? 'Saved' : 'Planning saved');
      if (exit) navigate(jobOrdersListPath(job?.status || 'DRAFT'));
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
        ...materialPayload(),
      });
      setJob(saved);
      setMaterialStatus(saved.materialStatus || materialStatus);
      const { data } = await jobOrdersApi.proposeSchedule(id, {
        operations: buildOperationsPayload(),
      });
      setScheduleOps(data.operations);
      setScheduleMeta({
        projectedCompletion: data.projectedCompletion,
        scheduleFlag: data.scheduleFlag,
        materialNotBefore: data.materialNotBefore,
        materialConstraintReason: data.materialConstraintReason,
      });
      setScheduleWarnings({});
      goToStep(3);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setProposing(false);
    }
  };

  const scheduleOpsToPayload = (ops: ProposedOperation[]) =>
    ops.map((op) => ({
      id: op.id,
      sequenceNo: op.sequenceNo,
      operationName: op.operationName,
      assignedWorkerId: op.assignedWorkerId,
      machineTypeId: op.machineTypeId,
      machineUnitId: op.machineUnitId,
      machineUnitLabel: op.machineUnitLabel,
      estimatedHours: op.estimatedHours,
      scheduledStart: op.scheduledStart,
      scheduledEnd: op.scheduledEnd,
    }));

  const handleScheduleOpChange = (sequenceNo: number, patch: Partial<ProposedOperation>) => {
    if (!scheduleOps) return;

    const startChanged = Object.prototype.hasOwnProperty.call(patch, 'scheduledStart');
    const endChanged = Object.prototype.hasOwnProperty.call(patch, 'scheduledEnd');

    const nextOps = scheduleOps.map((op) => {
      if (op.sequenceNo !== sequenceNo) return op;
      const next: ProposedOperation = { ...op, ...patch };

      // Start edit → end follows target (estimated) hours
      if (startChanged && next.scheduledStart) {
        const hours =
          typeof op.estimatedHours === 'number' && op.estimatedHours > 0
            ? op.estimatedHours
            : 1;
        next.scheduledEnd = dayjs(next.scheduledStart).add(hours, 'hour').toISOString();
      }

      if (next.scheduledStart && next.scheduledEnd) {
        next.segments = [{ start: next.scheduledStart, end: next.scheduledEnd }];
        next.scheduled = true;
      } else if (startChanged || endChanged) {
        next.segments = [];
      }
      return next;
    });

    setScheduleOps(nextOps);

    // Re-fit following operations after this one (keep this op's new window)
    if ((startChanged || endChanged) && id && !readOnly) {
      void (async () => {
        setProposing(true);
        setError('');
        try {
          const { data } = await jobOrdersApi.proposeSchedule(id, {
            operations: scheduleOpsToPayload(nextOps),
            lockBeforeSequence: sequenceNo + 1,
            honorMachinePins: true,
          });
          setScheduleOps(data.operations);
          setScheduleMeta({
            projectedCompletion: data.projectedCompletion,
            scheduleFlag: data.scheduleFlag,
            materialNotBefore: data.materialNotBefore,
            materialConstraintReason: data.materialConstraintReason,
          });
          setScheduleWarnings({});
        } catch (err) {
          setError(getErrorMessage(err));
          message.error(getErrorMessage(err));
        } finally {
          setProposing(false);
        }
      })();
    }
  };

  const handleRefreshProposedSchedule = async () => {
    if (!id || !scheduleOps) return;
    setProposing(true);
    setError('');
    try {
      // Drop pinned windows so earliest-fit rebuilds times; keep machine/worker picks.
      const { data } = await jobOrdersApi.proposeSchedule(id, {
        operations: scheduleOpsToPayload(scheduleOps).map((op) => ({
          ...op,
          scheduledStart: null,
          scheduledEnd: null,
        })),
        honorMachinePins: true,
      });
      setScheduleOps(data.operations);
      setScheduleMeta({
        projectedCompletion: data.projectedCompletion,
        scheduleFlag: data.scheduleFlag,
        materialNotBefore: data.materialNotBefore,
        materialConstraintReason: data.materialConstraintReason,
      });
      setScheduleWarnings({});
      message.success('Schedule reset to proposal');
    } catch (err) {
      setError(getErrorMessage(err));
      message.error(getErrorMessage(err));
    } finally {
      setProposing(false);
    }
  };

  const handleMachineUnitChange = async (
    sequenceNo: number,
    machineUnitId: string | null,
    machineUnitLabel: string | null
  ) => {
    if (!id || !job || !scheduleOps) return;
    const nextOps = scheduleOps.map((op) =>
      op.sequenceNo === sequenceNo
        ? { ...op, machineUnitId, machineUnitLabel }
        : op
    );
    setScheduleOps(nextOps);
    setProposing(true);
    setError('');
    try {
      const { data } = await jobOrdersApi.proposeSchedule(id, {
        operations: scheduleOpsToPayload(nextOps),
        lockBeforeSequence: sequenceNo,
        honorMachinePins: true,
      });
      setScheduleOps(data.operations);
      setScheduleMeta({
        projectedCompletion: data.projectedCompletion,
        scheduleFlag: data.scheduleFlag,
        materialNotBefore: data.materialNotBefore,
        materialConstraintReason: data.materialConstraintReason,
      });
      setScheduleWarnings({});
    } catch (err) {
      setError(getErrorMessage(err));
      message.error(getErrorMessage(err));
    } finally {
      setProposing(false);
    }
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

  const handleConfirmSchedule = async () => {
    if (!id || !scheduleOps?.some((o) => o.scheduled)) return;
    setConfirming(true);
    setError('');
    try {
      const { data } = await jobOrdersApi.confirmSchedule(id, {
        operations: buildConfirmPayload(),
        ...materialPayload(),
      });
      setJob(data);
      message.success('Schedule confirmed. The job is now scheduled.');
      goToStep(4);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setConfirming(false);
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
  const canConfirm = Boolean(scheduleOps?.some((o) => o.scheduled));

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
      render: (_: unknown, record: OpFormRow, index: number) => {
        const checking = isCheckingType(
          operationTypes.find((t) => t.id === record.operationTypeId),
          record.operationName
        );
        return (
          <Select
            allowClear={!checking}
            style={{ width: '100%' }}
            placeholder={checking ? 'No machine' : 'Machine'}
            value={checking ? undefined : record.machineTypeId}
            disabled={readOnly || checking}
            options={machineOptionsForRow(machines, operations, index)}
            onChange={(v) => onMachineTypeChange(index, v)}
          />
        );
      },
    },
    {
      title: 'Worker',
      width: 200,
      render: (_: unknown, record: OpFormRow, index: number) => {
        const checking = isCheckingType(
          operationTypes.find((t) => t.id === record.operationTypeId),
          record.operationName
        );
        const qualifiedWorkers = rowWorkers[index] || [];
        const rowMachineId =
          record.machineTypeId ||
          operationTypes.find((t) => t.id === record.operationTypeId)?.defaultMachineTypeId;
        return (
          <Select
            allowClear={!checking}
            style={{ width: '100%' }}
            placeholder={
              checking ? 'Admin (locked)' : rowMachineId ? 'Qualified workers' : 'Assign worker'
            }
            value={record.assignedWorkerId}
            disabled={readOnly || checking}
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
      title: 'Instructions',
      width: 260,
      render: (_: unknown, record: OpFormRow, index: number) => (
        <Input.TextArea
          autoSize={{ minRows: 1, maxRows: 4 }}
          maxLength={1000}
          placeholder="Tolerances, setup, special handling"
          value={record.notes ?? ''}
          disabled={readOnly}
          onChange={(e) => patchRow(index, { notes: e.target.value })}
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
          ? 'Scheduled'
          : 'Plan Job Order';

  return (
    <div className="jo-form-page">
      <div className="jo-form-page__header">
        <Space wrap size={8}>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate(jobOrdersListPath(job.status))}
          >
            Exit
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
          <h2 className="jo-plan__released-title">Job scheduled</h2>
          <p className="jo-plan__released-copy">
            {job.jobNumber || 'This job'} is on the schedule. Workers can see their assigned
            operations, and the client was notified that the job was received.
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
        <div className="jo-plan__section-title">Material readiness</div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13 }}>
          The first operation cannot start before material arrives. The arrival date comes from
          the job&apos;s supplier orders.
        </Text>
        <Row gutter={[16, 12]} style={{ marginBottom: 24 }}>
          <Col xs={24} md={8}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
              Materials needed?
            </div>
            <Select<MaterialStatus>
              style={{ width: '100%' }}
              value={materialsNeeded ? 'TO_ORDER' : 'NOT_REQUIRED'}
              disabled={readOnly}
              options={MATERIAL_STATUS_OPTIONS.map((o) =>
                o.value === 'TO_ORDER' ? { ...o, disabled: !hasMaterialsToBuy } : o
              )}
              onChange={(v) => {
                // Ordered / Received are kept: they follow the purchase lines.
                if (v === 'NOT_REQUIRED' || !isDerivedMaterialStatus(materialStatus)) {
                  setMaterialStatus(v);
                }
              }}
            />
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
              {materialsNeeded
                ? 'Set by the planned materials. Scheduling waits until they arrive.'
                : hasMaterialsToBuy
                  ? 'Marked Not required: the shop already has the material. Scheduling does not wait.'
                  : 'No planned materials to buy. Add them in the job details if this job needs material.'}
            </div>
          </Col>
          {materialsNeeded ? (
            <Col xs={24} md={16}>
              {materialsNotOrdered ? (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 10 }}
                  message="Materials not ordered yet. The first operation is placed after the longest supplier lead time."
                  description={
                    <>
                      {unorderedMaterials.length ? `${unorderedMaterials.join(', ')}. ` : ''}
                      <Link to={`/job-orders/${job.id}#supplier-orders`}>
                        View the job&apos;s supplier orders
                      </Link>
                    </>
                  }
                />
              ) : null}
              <MaterialOrdersSummary
                planned={job.plannedMaterials}
                readiness={job.materialReadiness}
              />
            </Col>
          ) : null}
        </Row>

        <div className="jo-plan__section-title">Operations</div>
        <Table
          size="middle"
          pagination={false}
          rowKey="key"
          dataSource={operations}
          columns={columns}
          expandable={{
            expandedRowRender: (_record, index) => {
              const row = operations[index];
              if (
                isCheckingType(
                  operationTypes.find((t) => t.id === row?.operationTypeId),
                  row?.operationName
                )
              ) {
                return (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    Checking is assigned to Admin and does not use a machine.
                  </Text>
                );
              }
              const suggestions = rowSuggestions[index] || [];
              const qualifiedWorkers = rowWorkers[index] || [];
              if (!suggestions.length) return null;
              const topId = suggestions[0]?.workerId;
              const assignedId = operations[index]?.assignedWorkerId;
              return (
                <div style={{ padding: '4px 0' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginBottom: 6,
                    }}
                  >
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      Best match auto-selected — click another to override
                    </Text>
                    <InfoTip
                      title="How suggestions are ranked"
                      content={
                        'Suggested workers are ranked on three things. Skill level counts most, at ' +
                        '50 per cent, because skill is how the shop already decides who takes a ' +
                        'job. How busy they already are counts 30 per cent, so work is spread ' +
                        'rather than always going to the same people. Past performance, meaning how ' +
                        'close their finished work lands to the target hours, counts 20 per cent, ' +
                        'and becomes more useful as more jobs are recorded. Workers who cannot run ' +
                        'that machine, or who are not free during the scheduled time, are not ' +
                        'listed at all.'
                      }
                    />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {suggestions.slice(0, 5).map((s) => {
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
                              : '1px solid #e8e8e8',
                            background: isAssigned ? '#fffbeb' : '#fafafa',
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
                          {s.attendanceWarning && (
                            <Tag
                              color="warning"
                              icon={<WarningOutlined />}
                              style={{ margin: '4px 0 0', fontSize: 11 }}
                            >
                              {s.attendanceWarning}
                            </Tag>
                          )}
                          {s.reason && (
                            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                              {s.reason}
                            </Text>
                          )}
                        </div>
                      );
                    })}
                  </div>
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
            <Button onClick={goBackStep}>Back</Button>
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
        <div className="jo-plan__section-title">Schedule</div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
          Review times and pick the specific machine unit for each operation. Changes show in the
          week view immediately. Confirming the schedule releases the job to the shop floor.
        </Text>

        {scheduleOps ? (
          <>
            {scheduleMeta?.materialNotBefore && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message={`Earliest start ${dayjs(scheduleMeta.materialNotBefore).format('MMM D, YYYY')} — ${
                  scheduleMeta.materialConstraintReason || 'waiting for material'
                }`}
              />
            )}
            <ScheduleProposalPanel
              operations={scheduleOps}
              machineUnits={machineUnits}
              projectedCompletion={scheduleMeta?.projectedCompletion}
              scheduleFlag={scheduleMeta?.scheduleFlag}
              warningsBySeq={scheduleWarnings}
              onChangeOp={handleScheduleOpChange}
              onMachineUnitChange={readOnly ? undefined : handleMachineUnitChange}
              onRefreshProposal={readOnly ? undefined : handleRefreshProposedSchedule}
              refreshing={proposing}
              onBlurValidate={() => scheduleOps && runValidateSchedule(scheduleOps)}
              readOnly={readOnly}
            />
            <ScheduleExpandShell title="Week view" className="jo-plan__week-wrap" expandInBody>
              {({ expandButton }) => (
                <ScheduleWeekView
                  jobId={job.id}
                  jobNumber={job.jobNumber}
                  jobTitle={job.title}
                  operations={scheduleOps}
                  machineUnits={machineUnits}
                  expandButton={expandButton}
                  scheduleColor={job.scheduleColor}
                  colorPickerDisabled={readOnly}
                  onScheduleColorChange={async (hex) => {
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
              )}
            </ScheduleExpandShell>
          </>
        ) : (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 12 }}
            message="Go back to Operations and use “View proposed schedule” to generate a first draft."
          />
        )}

        {wizardStep === 3 && !readOnly ? (
          <div className="jo-plan__footer">
            <Button onClick={goBackStep}>Back</Button>
            <Tooltip
              title={!canConfirm ? 'Propose a schedule before confirming it.' : undefined}
            >
              <span>
                <SplitActionButton
                  loading={confirming || saving}
                  disabled={!canConfirm}
                  onClick={handleConfirmSchedule}
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
                  Confirm schedule
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
