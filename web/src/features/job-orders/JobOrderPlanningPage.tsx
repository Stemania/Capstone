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
import { formatShopDateTime, formatShop } from '../../utils/shopTime';
import ScheduleProposalPanel from './ScheduleProposalPanel';
import ScheduleWeekView from './ScheduleWeekView';
import ScheduleExpandShell from '../schedule/ScheduleExpandShell';
import JobOrderFlowSteps, {
  resolveJobFlowStep,
  type JobFlowStepId,
} from './JobOrderFlowSteps';
import { jobOrdersListPath } from './jobOrderListPaths';
import JobInfoCard from './JobInfoCard';
import { PersonAvatar, PersonChip } from '../../components/PersonAvatar';
import { personLabel } from '../../utils/people';
import type {
  JobOrder,
  MachineInfo,
  MachineUnitInfo,
  OperationType,
  ProposedOperation,
  ScheduleProblem,
  ScheduleProposeResult,
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
  /** Up to MAX_HELPERS; no helpers on Checking or outsourced work. */
  helperIds?: string[];
  estimatedHours?: number | null;
  turnaroundDays?: number | null;
  scheduledStart?: string;
  scheduledEnd?: string;
  status?: string;
  notes?: string;
};

const MAX_HELPERS = 2;

/** Steps pre-filled when planning a Fabrication job, in shop order. */
const FABRICATION_SEQUENCE = ['LAYOUT', 'CUTTING', 'BENDING', 'FITTING', 'FINISHING'];

function isOutsourcedType(ot?: OperationType | null): boolean {
  return Boolean(ot?.isOutsourced);
}

function fabricationRows(types: OperationType[]): OpFormRow[] {
  return FABRICATION_SEQUENCE.map((code) => types.find((t) => t.code === code))
    .filter((t): t is OperationType => Boolean(t))
    .map((t) => ({
      key: newRowKey(),
      operationTypeId: t.id,
      operationName: t.name,
      machineTypeId: t.defaultMachineTypeId || undefined,
      assignedWorkerId: undefined,
    }));
}

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
    const name = personLabel(w.fullName, w.nickname);
    return {
      value: w.id,
      disabled: !free,
      search: name,
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
          <PersonChip
            userId={w.id}
            fullName={w.fullName}
            nickname={w.nickname}
            photoVersion={w.photoVersion}
            size={20}
          />
          {free ? null : (
            <span style={{ color: '#8c8c8c' }}>(unavailable{title ? ` · ${title}` : ''})</span>
          )}
        </span>
      ),
    };
  });
}

function pickBestWorker(
  suggestions: WorkerSuggestion[],
  qualifiedWorkers?: User[],
): { workerId?: string; machineUnitId?: string } {
  const fromSuggestion = suggestions.find(
    (s) => s.qualified !== false && s.available !== false,
  );
  if (fromSuggestion) {
    return {
      workerId: fromSuggestion.workerId,
      machineUnitId: fromSuggestion.machineUnitId || undefined,
    };
  }
  const fromList = qualifiedWorkers?.find((w) => w.available !== false);
  return { workerId: fromList?.id };
}

/** "Gio Agao · Lathe #2" for a machine lead, else the name. */
function suggestionLabel(s: WorkerSuggestion) {
  const name = personLabel(s.fullName, s.nickname);
  return s.machineUnitLabel ? `${name} · ${s.machineUnitLabel}` : name;
}

const RANKING_HELP =
  'Only people who are free for the whole window, on shift, and not on a holiday are listed. ' +
  'Machine operations, lead: being the assigned operator of a unit of that machine counts 40 per ' +
  'cent, machine skill level 30 per cent, past performance 20 per cent and current workload 10 ' +
  'per cent; each worker is shown with the unit that suits them best, and choosing them selects ' +
  'that unit. Units with no assigned operator are open to anyone with the skill. Operations ' +
  'without a machine: past performance 60 per cent and workload 40 per cent. Helpers, after the ' +
  'lead is chosen: past performance and workload, 50 per cent each.';

function newRowKey() {
  return `op-${Math.random().toString(36).slice(2, 10)}`;
}

function isCheckingType(ot?: OperationType | null, operationName?: string): boolean {
  if (ot) {
    return ot.code === 'CHECKING' || ot.name.trim().toLowerCase() === 'checking';
  }
  return (operationName || '').trim().toLowerCase() === 'checking';
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
  const [helperSuggestions, setHelperSuggestions] = useState<Record<string, WorkerSuggestion[]>>({});
  const [allWorkers, setAllWorkers] = useState<User[]>([]);
  const [machineUnits, setMachineUnits] = useState<MachineUnitInfo[]>([]);
  const [scheduleOps, setScheduleOps] = useState<ProposedOperation[] | null>(null);
  const [scheduleMeta, setScheduleMeta] = useState<{
    projectedCompletion?: string | null;
    scheduleFlag?: 'GREEN' | 'AMBER' | 'RED' | null;
    materialNotBefore?: string | null;
    materialConstraintReason?: string | null;
  } | null>(null);
  const materialsNeeded = job?.materialStatus !== 'NOT_REQUIRED';
  const linesReadiness =
    materialsNeeded && job?.materialReadiness?.source === 'PURCHASE_LINES'
      ? job.materialReadiness
      : null;
  const noLeadTimeSuppliers = linesReadiness?.missingLeadTimeSuppliers || [];
  const materialDateUnknown = noLeadTimeSuppliers.length > 0;
  const [scheduleProblems, setScheduleProblems] = useState<ScheduleProblem[]>([]);
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null);
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

      if (preserveExisting && row.assignedWorkerId) {
        const worker = workers.find((w) => w.id === row.assignedWorkerId);
        const suggestion = suggestions.find((s) => s.workerId === row.assignedWorkerId);
        const stillValid =
          worker &&
          worker.available !== false &&
          (suggestion ? suggestion.qualified !== false && suggestion.available !== false : true);
        if (stillValid) return prev;
      }

      const best = pickBestWorker(suggestions, workers);
      if (row.assignedWorkerId === best.workerId) return prev;
      const next = [...prev];
      next[rowIndex] = {
        ...row,
        assignedWorkerId: best.workerId,
        machineUnitId: best.machineUnitId || row.machineUnitId,
        helperIds: (row.helperIds || []).filter((h) => h !== best.workerId),
      };
      return next;
    });
  };

  const goToStep = (step: JobFlowStepId) => {
    if (step < 2) return;
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
      const ot = operationTypes.find((t) => t.id === op.operationTypeId);
      const name = op.operationName || ot?.name || `Operation ${index + 1}`;
      if (isOutsourcedType(ot)) {
        if (!op.turnaroundDays) items.push(`#${index + 1} ${name}: set the turnaround in days`);
        return;
      }
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
    clearInvalidAssignment = true,
    operationTypeId?: string | null
  ) => {
    const seq = (workerFetchSeq.current[rowIndex] || 0) + 1;
    workerFetchSeq.current[rowIndex] = seq;
    try {
      const { data } = await workersApi.list({
        machineTypeId: machineTypeId || undefined,
        operationTypeId: operationTypeId || undefined,
      });
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
    if (isOutsourcedType(ot)) {
      setRowSuggestions((prev) => ({ ...prev, [rowIndex]: [] }));
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

  // Helper suggestions follow each row's lead (keyed by row key).
  const helperQueryKey = operations
    .map((o) => `${o.key}:${o.assignedWorkerId || ''}:${o.operationTypeId || ''}:${(o.helperIds || []).join(',')}`)
    .join('|');
  useEffect(() => {
    let cancelled = false;
    operations.forEach((op) => {
      const ot = operationTypes.find((t) => t.id === op.operationTypeId);
      if (!op.assignedWorkerId || isOutsourcedType(ot) || isCheckingType(ot, op.operationName)) {
        setHelperSuggestions((prev) => (prev[op.key] ? { ...prev, [op.key]: [] } : prev));
        return;
      }
      void workersApi
        .suggest([], {
          excludeJobId: id,
          excludeOperationId: op.id,
          operationTypeId: op.operationTypeId,
          operationName: op.operationName,
          machineTypeId: op.machineTypeId,
          leadId: op.assignedWorkerId,
          excludeWorkerIds: op.helperIds || [],
        })
        .then(({ data }) => {
          if (!cancelled) setHelperSuggestions((prev) => ({ ...prev, [op.key]: data.suggestions || [] }));
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helperQueryKey, operationTypes]);

  useEffect(() => {
    workersApi
      .list()
      .then(({ data }) => setAllWorkers(data))
      .catch(() => setAllWorkers([]));
  }, []);

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
                  helperIds: op.helperIds || [],
                  estimatedHours: op.estimatedHours,
                  turnaroundDays: op.turnaroundDays ?? null,
                  scheduledStart: op.scheduledStart || undefined,
                  scheduledEnd: op.scheduledEnd || undefined,
                  status: op.status,
                  notes: op.notes || undefined,
                }))
            : j.jobType === 'FABRICATION' && fabricationRows(typesRes.data || []).length
              ? fabricationRows(typesRes.data || [])
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
                helperIds: op.helperIds || [],
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

        if (initial === 3 && isPlanningStatus(j.status)) {
          try {
            const { data } = await jobOrdersApi.proposeSchedule(id, { restoreSaved: true });
            if (cancelled) return;
            applyProposal(data);
            setScheduleNotice(
              data.replacedPastStart
                ? `The saved schedule started on ${formatShopDateTime(data.replacedPastStart)}, which has passed, so a fresh schedule was proposed.`
                : null
            );
          } catch (err) {
            if (!cancelled) setError(getErrorMessage(err));
          }
        }

        const types = typesRes.data || [];
        rows.forEach((row, index) => {
          if (isOutsourcedType(types.find((t) => t.id === row.operationTypeId))) return;
          void loadRowWorkers(index, row.machineTypeId, false, row.operationTypeId);
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
    if (isOutsourcedType(ot)) {
      setRowWorkers((prev) => ({ ...prev, [index]: [] }));
      setRowSuggestions((prev) => ({ ...prev, [index]: [] }));
      rowDataRef.current[index] = { workers: [], suggestions: [] };
      patchRow(index, {
        operationTypeId: typeId,
        operationName: ot?.name || '',
        machineTypeId: undefined,
        machineUnitId: undefined,
        assignedWorkerId: undefined,
        helperIds: [],
        estimatedHours: null,
        turnaroundDays: operations[index]?.turnaroundDays ?? ot?.defaultTurnaroundDays ?? null,
      });
      return;
    }
    const checking = isCheckingType(ot);
    const machineTypeId = checking ? undefined : ot?.defaultMachineTypeId || undefined;
    patchRow(index, {
      operationTypeId: typeId,
      operationName: ot?.name || '',
      machineTypeId,
      machineUnitId: undefined,
      assignedWorkerId: undefined,
      ...(checking ? { helperIds: [] } : {}),
      turnaroundDays: null,
    });
    void loadRowWorkers(index, machineTypeId, true, typeId);
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
    patchRow(index, { machineTypeId, machineUnitId: undefined, assignedWorkerId: undefined });
    void loadRowWorkers(index, machineTypeId, true, row?.operationTypeId);
    void loadSuggestions(index, {
      ...operations[index],
      machineTypeId,
      assignedWorkerId: undefined,
    });
  };

  const buildOperationsPayload = () =>
    operations.map((op, i) => {
      const ot = operationTypes.find((t) => t.id === op.operationTypeId);
      const outsourced = isOutsourcedType(ot);
      const checking = isCheckingType(ot, op.operationName);
      const mt =
        checking || outsourced
          ? undefined
          : machines.find((m) => m.id === op.machineTypeId || m.code === op.machineTypeId);
      return {
        id: op.id,
        sequenceNo: i + 1,
        operationTypeId: op.operationTypeId || null,
        operationName: op.operationName || ot?.name,
        ...(mt?.id ? { machineTypeId: mt.id } : { machinesNeeded: [] }),
        assignedWorkerId: outsourced ? null : op.assignedWorkerId || null,
        helperIds:
          outsourced || checking || !op.assignedWorkerId
            ? []
            : (op.helperIds || []).filter((h) => h && h !== op.assignedWorkerId),
        estimatedHours: outsourced ? null : op.estimatedHours ?? null,
        turnaroundDays: outsourced ? op.turnaroundDays ?? null : null,
        machineUnitId: checking || outsourced ? null : op.machineUnitId || null,
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
      });
      setJob(data);
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

  const applyProposal = (data: ScheduleProposeResult) => {
    setScheduleOps(data.operations);
    setScheduleMeta({
      projectedCompletion: data.projectedCompletion,
      scheduleFlag: data.scheduleFlag,
      materialNotBefore: data.materialNotBefore,
      materialConstraintReason: data.materialConstraintReason,
    });
    setScheduleProblems(data.problems || []);
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
      applyProposal(data);
      setScheduleNotice(null);
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
      operationTypeId: operations[op.sequenceNo - 1]?.operationTypeId || null,
      turnaroundDays: op.turnaroundDays ?? null,
      assignedWorkerId: op.assignedWorkerId,
      helperIds: operations[op.sequenceNo - 1]?.helperIds || [],
      machineTypeId: op.machineTypeId,
      machineUnitId: op.machineUnitId,
      machineUnitLabel: op.machineUnitLabel,
      estimatedHours: op.estimatedHours,
      scheduledStart: op.scheduledStart,
      scheduledEnd: op.scheduledEnd,
    }));

  const handleScheduleOpChange = (sequenceNo: number, patch: Partial<ProposedOperation>) => {
    if (!scheduleOps) return;
    const nextOps = scheduleOps.map((op) =>
      op.sequenceNo === sequenceNo ? { ...op, ...patch } : op
    );
    setScheduleOps(nextOps);
    if (!Object.prototype.hasOwnProperty.call(patch, 'scheduledStart') || !id || readOnly) return;

    void (async () => {
      setProposing(true);
      setError('');
      try {
        const { data } = await jobOrdersApi.proposeSchedule(id, {
          operations: scheduleOpsToPayload(nextOps),
          pinSequence: sequenceNo,
          lockBeforeSequence: sequenceNo,
          honorMachinePins: true,
        });
        applyProposal(data);
        const edited = data.operations.find((o) => o.sequenceNo === sequenceNo);
        if (edited?.scheduled && edited.message) message.info(edited.message);
      } catch (err) {
        setError(getErrorMessage(err));
        message.error(getErrorMessage(err));
      } finally {
        setProposing(false);
      }
    })();
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
      applyProposal(data);
      setScheduleNotice(null);
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
      applyProposal(data);
    } catch (err) {
      setError(getErrorMessage(err));
      message.error(getErrorMessage(err));
    } finally {
      setProposing(false);
    }
  };

  const handleConfirmSchedule = async () => {
    if (!id || !scheduleOps?.some((o) => o.scheduled)) return;
    setConfirming(true);
    setError('');
    try {
      const { data } = await jobOrdersApi.confirmSchedule(id, {
        operations: buildConfirmPayload(),
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

  const readOnly = !isPlanningStatus(job.status);
  const problemsBySeq: Record<number, ScheduleProblem[]> = {};
  for (const p of scheduleProblems) (problemsBySeq[p.sequenceNo] ||= []).push(p);
  const confirmBlockers = !scheduleOps?.length
    ? ['Propose a schedule before confirming it.']
    : scheduleProblems.map((p) => p.message);
  const canConfirm = confirmBlockers.length === 0;

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
        const ot = operationTypes.find((t) => t.id === record.operationTypeId);
        const outsourced = isOutsourcedType(ot);
        const checking = isCheckingType(ot, record.operationName);
        const noMachine = checking || outsourced;
        return (
          <Select
            allowClear={!noMachine}
            style={{ width: '100%' }}
            placeholder={outsourced ? 'Outsourced' : checking ? 'No machine' : 'Machine'}
            value={noMachine ? undefined : record.machineTypeId}
            disabled={readOnly || noMachine}
            options={machineOptionsForRow(machines, operations, index)}
            onChange={(v) => onMachineTypeChange(index, v)}
          />
        );
      },
    },
    {
      title: 'Crew',
      width: 240,
      render: (_: unknown, record: OpFormRow, index: number) => {
        const ot = operationTypes.find((t) => t.id === record.operationTypeId);
        if (isOutsourcedType(ot)) {
          return <Select style={{ width: '100%' }} placeholder="Outside shop" disabled />;
        }
        const qualifiedWorkers = rowWorkers[index] || [];
        const rowType = operationTypes.find((t) => t.id === record.operationTypeId);
        const rowMachineId = record.machineTypeId || rowType?.defaultMachineTypeId;
        const checking = isCheckingType(rowType, record.operationName);
        const helpers = record.helperIds || [];
        const helperChoices = (current?: string) =>
          workerOptions(
            allWorkers.filter(
              (w) =>
                w.id === current ||
                (w.id !== record.assignedWorkerId && !helpers.includes(w.id)),
            ),
          );
        const setHelpers = (next: string[]) => patchRow(index, { helperIds: next });
        const unitLabel = record.machineUnitId
          ? machineUnits.find((u) => u.id === record.machineUnitId)?.label
          : null;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Select
              allowClear
              showSearch
              optionFilterProp="search"
              style={{ width: '100%' }}
              placeholder={checking ? 'Admins only' : rowMachineId ? 'Lead (qualified)' : 'Lead worker'}
              value={record.assignedWorkerId}
              disabled={readOnly}
              options={workerOptions(qualifiedWorkers)}
              onChange={(v) =>
                patchRow(index, {
                  assignedWorkerId: v,
                  helperIds: v ? helpers.filter((h) => h !== v) : [],
                })
              }
            />
            {unitLabel && rowMachineId ? (
              <Text type="secondary" style={{ fontSize: 11 }}>
                Unit: {unitLabel}
              </Text>
            ) : null}
            {helpers.map((hid, hi) => (
              <div key={`${hid}-${hi}`} style={{ display: 'flex', gap: 4 }}>
                <Select
                  showSearch
                  optionFilterProp="search"
                  style={{ flex: 1, minWidth: 0 }}
                  placeholder="Helper"
                  value={hid || undefined}
                  disabled={readOnly}
                  options={helperChoices(hid)}
                  onChange={(v) => setHelpers(helpers.map((h, j) => (j === hi ? v : h)))}
                />
                {!readOnly && (
                  <Button
                    type="text"
                    size="small"
                    aria-label="Remove helper"
                    icon={<DeleteOutlined />}
                    onClick={() => setHelpers(helpers.filter((_, j) => j !== hi))}
                  />
                )}
              </div>
            ))}
            {!readOnly && !checking && record.assignedWorkerId && helpers.length < MAX_HELPERS ? (
              <Button
                type="dashed"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => setHelpers([...helpers, ''])}
              >
                Add helper
              </Button>
            ) : null}
          </div>
        );
      },
    },
    {
      title: 'Target',
      width: 130,
      render: (_: unknown, record: OpFormRow, index: number) =>
        isOutsourcedType(operationTypes.find((t) => t.id === record.operationTypeId)) ? (
          <InputNumber
            style={{ width: '100%' }}
            min={1}
            max={90}
            precision={0}
            placeholder="Days"
            suffix="days"
            value={record.turnaroundDays ?? undefined}
            disabled={readOnly}
            onChange={(v) => patchRow(index, { turnaroundDays: v })}
          />
        ) : (
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            step={0.5}
            placeholder="Hours"
            suffix="h"
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
          ? 'Released'
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
        <JobOrderFlowSteps current={wizardStep} onStepClick={goToStep} locked={readOnly} />
      </div>

      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}

      <JobInfoCard job={job} />

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
              if (isOutsourcedType(operationTypes.find((t) => t.id === row?.operationTypeId))) {
                return (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    Done by an outside shop: no worker or machine. The schedule blocks out the
                    turnaround days, and the next operation waits until it is returned.
                  </Text>
                );
              }
              const suggestions = rowSuggestions[index] || [];
              const qualifiedWorkers = rowWorkers[index] || [];
              const helperSugs = (helperSuggestions[row?.key || ''] || []).slice(0, 5);
              const rowHelpers = (row?.helperIds || []).filter(Boolean);
              const canAddHelper =
                !readOnly &&
                Boolean(row?.assignedWorkerId) &&
                !isCheckingType(operationTypes.find((t) => t.id === row?.operationTypeId), row?.operationName) &&
                rowHelpers.length < MAX_HELPERS;
              if (!suggestions.length && !helperSugs.length) return null;
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
                    <InfoTip title="How suggestions are ranked" content={RANKING_HELP} />
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
                            patchRow(index, {
                              assignedWorkerId: s.workerId,
                              ...(s.machineUnitId ? { machineUnitId: s.machineUnitId } : {}),
                              helperIds: rowHelpers.filter((h) => h !== s.workerId),
                            });
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
                            <PersonAvatar
                              userId={s.workerId}
                              fullName={s.fullName}
                              photoVersion={s.photoVersion}
                              size={24}
                            />
                            <Text strong style={{ fontSize: 12 }}>
                              {suggestionLabel(s)}
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
                  {helperSugs.length > 0 && canAddHelper ? (
                    <div style={{ marginTop: 10 }}>
                      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
                        Suggested helpers — click to add (up to {MAX_HELPERS})
                      </Text>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {helperSugs.map((s) => (
                          <div
                            key={s.workerId}
                            onClick={() =>
                              patchRow(index, {
                                helperIds: [...rowHelpers, s.workerId].slice(0, MAX_HELPERS),
                              })
                            }
                            style={{
                              cursor: 'pointer',
                              padding: '6px 10px',
                              borderRadius: 6,
                              border: '1px dashed #d9d9d9',
                              background: '#fafafa',
                              minWidth: 160,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <PlusOutlined style={{ fontSize: 11, color: '#8c8c8c' }} />
                              <PersonAvatar
                                userId={s.workerId}
                                fullName={s.fullName}
                                photoVersion={s.photoVersion}
                                size={22}
                              />
                              <Text style={{ fontSize: 12 }}>{personLabel(s.fullName, s.nickname)}</Text>
                              <Tag style={{ margin: 0, fontSize: 11 }}>{(s.score * 100).toFixed(0)}%</Tag>
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
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            },
            rowExpandable: (_record) => {
              const index = operations.findIndex((o) => o.key === _record.key);
              return (
                (rowSuggestions[index] || []).length > 0 ||
                (helperSuggestions[_record.key] || []).length > 0
              );
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
            {scheduleNotice && (
              <Alert type="info" showIcon style={{ marginBottom: 12 }} message={scheduleNotice} />
            )}
            {scheduleMeta?.materialNotBefore && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message={`Earliest start ${formatShop(scheduleMeta.materialNotBefore, 'MMM D, YYYY')} — ${
                  scheduleMeta.materialConstraintReason || 'waiting for material'
                }`}
              />
            )}
            <ScheduleProposalPanel
              operations={scheduleOps}
              machineUnits={machineUnits}
              projectedCompletion={scheduleMeta?.projectedCompletion}
              scheduleFlag={scheduleMeta?.scheduleFlag}
              problemsBySeq={problemsBySeq}
              onChangeOp={handleScheduleOpChange}
              onMachineUnitChange={readOnly ? undefined : handleMachineUnitChange}
              onRefreshProposal={readOnly ? undefined : handleRefreshProposedSchedule}
              refreshing={proposing}
              readOnly={readOnly}
            />
            <ScheduleExpandShell title="Schedule view" className="jo-plan__week-wrap" expandInBody>
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

        {wizardStep === 3 && !readOnly && scheduleOps && confirmBlockers.length > 0 ? (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 12 }}
            message="This schedule can't be confirmed yet"
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {confirmBlockers.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            }
          />
        ) : null}
        {wizardStep === 3 && !readOnly ? (
          <div className="jo-plan__footer">
            <Button onClick={goBackStep}>Back</Button>
            <Tooltip
              title={!canConfirm ? confirmBlockers.join(' ') : undefined}
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
