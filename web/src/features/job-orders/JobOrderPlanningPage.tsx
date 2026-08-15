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
import type { ColumnsType } from 'antd/es/table';
import {
  CalendarOutlined,
  DeleteOutlined,
  PlusOutlined,
  StarFilled,
  ArrowUpOutlined,
  ArrowDownOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { jobOrdersApi, workersApi } from '../../api/jobOrders.api';
import { operationTypesApi } from '../../api/users.api';
import { getErrorMessage } from '../../api/client';
import { MACHINE_OPTIONS } from '../../types';
import ScheduleProposalPanel from './ScheduleProposalPanel';
import ScheduleWeekView from './ScheduleWeekView';
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

function newRowKey() {
  return `op-${Math.random().toString(36).slice(2, 10)}`;
}

export default function JobOrderPlanningPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobOrder | null>(null);
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
  const [scheduleApplied, setScheduleApplied] = useState(false);
  const [scheduleWarnings, setScheduleWarnings] = useState<Record<number, ScheduleWarning[]>>({});
  const [proposing, setProposing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState('');
  const workerFetchSeq = useRef<Record<number, number>>({});

  const resolveMachineTypeId = (op?: OpFormRow | null): string | undefined => {
    if (!op) return undefined;
    if (op.machineTypeId) return op.machineTypeId;
    const ot = operationTypes.find((t) => t.id === op.operationTypeId);
    return ot?.defaultMachineTypeId || undefined;
  };

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
      if (clearInvalidAssignment) {
        setOperations((prev) => {
          const currentId = prev[rowIndex]?.assignedWorkerId;
          if (currentId && !data.some((w) => w.id === currentId)) {
            const next = [...prev];
            next[rowIndex] = { ...next[rowIndex], assignedWorkerId: undefined };
            return next;
          }
          return prev;
        });
      }
    } catch {
      if (workerFetchSeq.current[rowIndex] !== seq) return;
      setRowWorkers((prev) => ({ ...prev, [rowIndex]: [] }));
    }
  };

  const loadSuggestions = async (rowIndex: number, op: OpFormRow) => {
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
      setRowSuggestions((prev) => ({ ...prev, [rowIndex]: data.suggestions || [] }));
    } catch {
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
        if (j.status !== 'DRAFT' && j.status !== 'PLANNING') {
          message.info('This job is already released. Opening detail view.');
          navigate(`/job-orders/${id}`, { replace: true });
          return;
        }
        setJob(j);
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
          void loadSuggestions(index, row);
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
    setScheduleApplied(false);
  };

  const onOperationTypeChange = (index: number, typeId: string) => {
    const ot = operationTypes.find((t) => t.id === typeId);
    const machineTypeId = ot?.defaultMachineTypeId || undefined;
    patchRow(index, {
      operationTypeId: typeId,
      operationName: ot?.name || '',
      machineTypeId,
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

  const savePlanning = async () => {
    if (!id) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await jobOrdersApi.update(id, { operations: buildOperationsPayload() });
      setJob(data);
      message.success('Planning saved');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleProposeSchedule = async () => {
    if (!id || !job) return;
    setProposing(true);
    setError('');
    setScheduleApplied(false);
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

  const handleApplySchedule = () => {
    if (!scheduleOps) return;
    setOperations((prev) => {
      const next = [...prev];
      for (const proposed of scheduleOps) {
        const idx = proposed.sequenceNo - 1;
        if (idx < 0 || idx >= next.length || !proposed.scheduled) continue;
        next[idx] = {
          ...next[idx],
          scheduledStart: proposed.scheduledStart || undefined,
          scheduledEnd: proposed.scheduledEnd || undefined,
          machineUnitId: proposed.machineUnitId || undefined,
          status: next[idx].status === 'PENDING' ? 'SCHEDULED' : next[idx].status,
        };
      }
      return next;
    });
    setScheduleApplied(true);
  };

  const handleScheduleOpChange = (sequenceNo: number, patch: Partial<ProposedOperation>) => {
    setScheduleOps((prev) =>
      (prev || []).map((op) => (op.sequenceNo === sequenceNo ? { ...op, ...patch } : op))
    );
    setScheduleApplied(false);
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
    if (!id) return;
    setReleasing(true);
    setError('');
    try {
      await jobOrdersApi.update(id, { operations: buildOperationsPayload() });
      await jobOrdersApi.release(id);
      message.success('Released to production');
      navigate(`/job-orders/${id}`);
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
        const rowMachineId = resolveMachineTypeId(record);
        return (
          <Select
            allowClear
            style={{ width: '100%' }}
            placeholder={rowMachineId ? 'Qualified workers' : 'Assign worker'}
            value={record.assignedWorkerId}
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
          onChange={(v) => patchRow(index, { estimatedHours: v })}
        />
      ),
    },
    {
      title: '',
      width: 120,
      render: (_: unknown, __: OpFormRow, index: number) => (
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

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
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
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/job-orders/${job.id}`)}>
            Back
          </Button>
          <div>
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>
              {job.jobNumber || job.id.slice(0, 8).toUpperCase()}
            </Text>
            <Title level={4} style={{ margin: 0, color: '#0f1c2e' }}>
              Plan Job Order
            </Title>
          </div>
        </Space>
      </div>

      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
          padding: '12px 16px',
          marginBottom: 16,
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
        }}
      >
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

      <div
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, color: '#0f1c2e', marginBottom: 12 }}>
          Operations
        </div>
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
              return (
                <div style={{ padding: '4px 0' }}>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
                    Ranked suggestions (click to assign)
                  </Text>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {qualified.slice(0, 5).map((s) => {
                      const inDropdown = qualifiedWorkers.some((w) => w.id === s.workerId);
                      const isTop = s.workerId === topId;
                      return (
                        <div
                          key={s.workerId}
                          onClick={() => {
                            if (!inDropdown) return;
                            patchRow(index, { assignedWorkerId: s.workerId });
                          }}
                          style={{
                            cursor: inDropdown ? 'pointer' : 'not-allowed',
                            opacity: inDropdown ? 1 : 0.55,
                            padding: '6px 10px',
                            borderRadius: 6,
                            border: isTop ? '1.5px solid #c9a227' : '1px solid #e8e8e8',
                            background: isTop ? '#fffbeb' : '#fafafa',
                            minWidth: 160,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {isTop && <StarFilled style={{ color: '#c9a227', fontSize: 12 }} />}
                            <Text strong style={{ fontSize: 12 }}>
                              {s.fullName}
                            </Text>
                            <Tag color={isTop ? 'gold' : 'default'} style={{ margin: 0, fontSize: 11 }}>
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
      </div>

      <div
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, color: '#0f1c2e', marginBottom: 6 }}>
          Schedule
        </div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
          Assign workers to all operations first, then propose a schedule to see when this job can
          be finished.
        </Text>
        <Tooltip title={proposeTooltip}>
          <span style={{ display: 'inline-block' }}>
            <Button
              icon={<CalendarOutlined />}
              loading={proposing}
              disabled={!canProposeSchedule}
              onClick={handleProposeSchedule}
              style={{ fontWeight: 600 }}
            >
              Propose Schedule
            </Button>
          </span>
        </Tooltip>

        {scheduleOps ? (
          <>
            <ScheduleProposalPanel
              operations={scheduleOps}
              projectedCompletion={scheduleMeta?.projectedCompletion}
              scheduleFlag={scheduleMeta?.scheduleFlag}
              scheduleApplied={scheduleApplied}
              warningsBySeq={scheduleWarnings}
              onChangeOp={handleScheduleOpChange}
              onBlurValidate={() => scheduleOps && runValidateSchedule(scheduleOps)}
              onApply={handleApplySchedule}
            />
            <div style={{ marginTop: 14, overflowX: 'auto' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>
                WEEK VIEW
              </div>
              <ScheduleWeekView
                jobTitle={job.title}
                operations={scheduleOps}
                machineUnits={machineUnits}
              />
            </div>
          </>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
          paddingTop: 8,
          flexWrap: 'wrap',
        }}
      >
        <Button onClick={() => navigate(`/job-orders/${job.id}`)}>Cancel</Button>
        <Button loading={saving} onClick={savePlanning} style={{ fontWeight: 600 }}>
          Save Planning
        </Button>
        <Button
          type="primary"
          loading={releasing}
          onClick={handleRelease}
          style={{ fontWeight: 600, minWidth: 180 }}
        >
          Release to Production
        </Button>
      </div>
    </div>
  );
}
