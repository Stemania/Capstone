import { useEffect, useRef, useState } from 'react';
import {
  Form, Input, InputNumber, Button, DatePicker, Select, Typography, Alert, Tag, Spin, Row, Col,
} from 'antd';
import { CalendarOutlined } from '@ant-design/icons';
import { DeleteOutlined, PlusOutlined, StarFilled } from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { clientsApi, jobOrdersApi, workersApi } from '../../api/jobOrders.api';
import { operationTypesApi } from '../../api/users.api';
import { getErrorMessage } from '../../api/client';
import { MACHINE_OPTIONS } from '../../types';
import ScheduleProposalPanel from './ScheduleProposalPanel';
import ScheduleWeekView from './ScheduleWeekView';
import type {
  Client,
  MachineInfo,
  MachineUnitInfo,
  OperationType,
  ProposedOperation,
  ScheduleWarning,
  User,
  WorkerSuggestion,
} from '../../types';

const { Title, Text } = Typography;
const { TextArea } = Input;

type OpFormRow = {
  id?: string;
  operationTypeId?: string;
  operationName?: string;
  machineTypeId?: string;
  machineUnitId?: string;
  assignedWorkerId?: string;
  estimatedHours?: number;
  scheduledStart?: string;
  scheduledEnd?: string;
  status?: string;
};

function machineOptionsForRow(
  catalog: MachineInfo[],
  operations: OpFormRow[],
  rowIndex: number
) {
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

export default function JobOrderFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [clients, setClients] = useState<Client[]>([]);
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
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [refWarnings, setRefWarnings] = useState<string[]>([]);
  /** Ignore stale GET /workers responses when machine type changes quickly */
  const workerFetchSeq = useRef<Record<number, number>>({});

  const watchedOps = Form.useWatch('operations', form) as OpFormRow[] | undefined;
  const operations = watchedOps || [];

  const resolveMachineTypeId = (op?: OpFormRow | null): string | undefined => {
    if (!op) return undefined;
    if (op.machineTypeId) return op.machineTypeId;
    const ot = operationTypes.find((t) => t.id === op.operationTypeId);
    return ot?.defaultMachineTypeId || undefined;
  };

  const loadRowWorkers = async (
    rowIndex: number,
    machineTypeId?: string | null,
    clearInvalidAssignment = true
  ) => {
    const seq = (workerFetchSeq.current[rowIndex] || 0) + 1;
    workerFetchSeq.current[rowIndex] = seq;
    try {
      const { data } = await workersApi.list(
        machineTypeId ? { machineTypeId } : undefined
      );
      if (workerFetchSeq.current[rowIndex] !== seq) return;
      setRowWorkers((prev) => ({ ...prev, [rowIndex]: data }));
      if (clearInvalidAssignment) {
        const ops = form.getFieldValue('operations') || [];
        const currentId = ops[rowIndex]?.assignedWorkerId;
        if (currentId && !data.some((w) => w.id === currentId)) {
          const next = [...ops];
          next[rowIndex] = { ...next[rowIndex], assignedWorkerId: undefined };
          form.setFieldValue('operations', next);
        }
      }
    } catch {
      if (workerFetchSeq.current[rowIndex] !== seq) return;
      setRowWorkers((prev) => ({ ...prev, [rowIndex]: [] }));
    }
  };

  // Keep dropdown in sync with each row's machine — server-filtered by WorkerSkill
  const machineKey = operations.map((op) => resolveMachineTypeId(op) || '').join('|');
  useEffect(() => {
    if (loading) return;
    const ops = (form.getFieldValue('operations') as OpFormRow[]) || [];
    ops.forEach((op, i) => {
      loadRowWorkers(i, resolveMachineTypeId(op), true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineKey, loading, operationTypes]);

  useEffect(() => {
    const load = async () => {
      setError('');
      setRefWarnings([]);

      const settled = await Promise.allSettled([
        clientsApi.list(),
        jobOrdersApi.machines(),
        operationTypesApi.list(),
        jobOrdersApi.machineUnits(),
      ]);
      const labels = ['clients', 'machines', 'operation types', 'machine units'] as const;
      const warnings: string[] = [];
      settled.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          const data = result.value.data;
          if (i === 0) setClients(data as Client[]);
          else if (i === 1) setMachines(data as MachineInfo[]);
          else if (i === 2) setOperationTypes(data as OperationType[]);
          else setMachineUnits(data as MachineUnitInfo[]);
        } else {
          warnings.push(`Could not load ${labels[i]}`);
        }
      });
      setRefWarnings(warnings);

      if (isEdit && id) {
        try {
          const { data: job } = await jobOrdersApi.get(id);
          const ops =
            job.operations?.map((op) => ({
              id: op.id,
              operationTypeId: op.operationTypeId || undefined,
              operationName: op.operationName || op.name,
              machineTypeId: op.machineTypeId || undefined,
              assignedWorkerId: op.assignedWorkerId || undefined,
              estimatedHours: op.estimatedHours ?? undefined,
              machineUnitId: op.machineUnitId || undefined,
              scheduledStart: op.scheduledStart || undefined,
              scheduledEnd: op.scheduledEnd || undefined,
              status: op.status,
            })) || [{ operationTypeId: undefined, operationName: '', machineTypeId: undefined }];
          form.setFieldsValue({
            clientId: job.clientId,
            title: job.title,
            description: job.description,
            dueDate: dayjs(job.dueDate),
            clientPoNumber: job.clientPoNumber || undefined,
            poDate: job.poDate ? dayjs(job.poDate) : undefined,
            priority: job.priority || 'MODERATE',
            jobType: job.jobType || 'FABRICATION',
            materialSource: job.materialSource || 'SHOP_PROCURED',
            partCondition: job.partCondition || undefined,
            quantity: job.quantity ?? undefined,
            unitOfMeasure: job.unitOfMeasure || undefined,
            amount: job.amount ?? undefined,
            rawMaterials: job.rawMaterials?.length
              ? job.rawMaterials
              : [{ name: '', quantity: undefined, unit: '' }],
            operations: ops,
          });
        } catch (err) {
          setError(getErrorMessage(err));
        }
      }

      setLoading(false);
    };
    load();
  }, [id, isEdit, form]);

  const onOperationTypeChange = (rowIndex: number, typeId: string | undefined) => {
    const ot = operationTypes.find((t) => t.id === typeId);
    const ops = form.getFieldValue('operations') || [];
    const next = [...ops];
    const machineTypeId = ot?.defaultMachineTypeId || undefined;
    next[rowIndex] = {
      ...next[rowIndex],
      operationTypeId: typeId,
      operationName: ot?.name || next[rowIndex]?.operationName,
      machineTypeId,
      assignedWorkerId: undefined,
    };
    form.setFieldValue('operations', next);
    // Worker list refresh is driven by machineKey useEffect
    if (ot) {
      fetchRowSuggestion(rowIndex, {
        operationTypeId: ot.id,
        machineTypeId,
        operationName: ot.name,
      });
    } else {
      setRowSuggestions((prev) => ({ ...prev, [rowIndex]: [] }));
    }
  };

  const onMachineTypeChange = (rowIndex: number, machineTypeId: string | undefined) => {
    const ops = form.getFieldValue('operations') || [];
    const next = [...ops];
    // Ignore spurious clears while an operation type still implies a default machine
    // (Ant Design Select can fire undefined when options/value churn).
    if (!machineTypeId) {
      const ot = operationTypes.find((t) => t.id === next[rowIndex]?.operationTypeId);
      if (ot?.defaultMachineTypeId) {
        next[rowIndex] = {
          ...next[rowIndex],
          machineTypeId: ot.defaultMachineTypeId,
          assignedWorkerId: undefined,
        };
        form.setFieldValue('operations', next);
        fetchRowSuggestion(rowIndex, {
          machineTypeId: ot.defaultMachineTypeId,
          operationTypeId: ot.id,
          operationName: ot.name,
        });
        return;
      }
    }
    next[rowIndex] = {
      ...next[rowIndex],
      machineTypeId,
      assignedWorkerId: undefined,
    };
    form.setFieldValue('operations', next);
    fetchRowSuggestion(rowIndex, {
      machineTypeId,
      operationTypeId: next[rowIndex]?.operationTypeId,
      operationName: next[rowIndex]?.operationName,
    });
  };

  const fetchRowSuggestion = async (
    rowIndex: number,
    opts?: { operationName?: string; machineTypeId?: string; operationTypeId?: string }
  ) => {
    const row = (form.getFieldValue('operations') || [])[rowIndex] || {};
    const operationTypeId = opts?.operationTypeId || row.operationTypeId;
    const machineTypeId = opts?.machineTypeId || row.machineTypeId;
    const operationName = opts?.operationName || row.operationName;
    if (!operationTypeId && !machineTypeId && !operationName) {
      setRowSuggestions((prev) => ({ ...prev, [rowIndex]: [] }));
      return;
    }
    try {
      const opId = row.id;
      const { data } = await workersApi.suggest([], {
        excludeJobId: id,
        excludeOperationId: opId,
        machineTypeId,
        operationTypeId,
        operationName,
      });
      setRowSuggestions((prev) => ({ ...prev, [rowIndex]: data.suggestions || [] }));
    } catch {
      setRowSuggestions((prev) => ({ ...prev, [rowIndex]: [] }));
    }
  };

  const buildOperationsPayload = (ops: OpFormRow[]) =>
    ops.map((op, i) => {
      const mt = machines.find(
        (m) => m.id === op.machineTypeId || m.code === op.machineTypeId
      );
      const ot = operationTypes.find((t) => t.id === op.operationTypeId);
      return {
        id: op.id,
        sequenceNo: i + 1,
        operationTypeId: op.operationTypeId || null,
        operationName: op.operationName || ot?.name,
        ...(mt?.id
          ? { machineTypeId: mt.id }
          : { machinesNeeded: mt ? [mt.code] : [] }),
        assignedWorkerId: op.assignedWorkerId || null,
        estimatedHours: op.estimatedHours ?? null,
        machineUnitId: op.machineUnitId || null,
        scheduledStart: op.scheduledStart || null,
        scheduledEnd: op.scheduledEnd || null,
        status: op.status || 'PENDING',
      };
    });

  const runValidateSchedule = async (ops: ProposedOperation[]) => {
    const dueDate = form.getFieldValue('dueDate');
    if (!dueDate) return;
    try {
      const { data } = await jobOrdersApi.validateSchedule({
        dueDate: dueDate.format('YYYY-MM-DD'),
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

  const handleProposeSchedule = async () => {
    setProposing(true);
    setError('');
    setScheduleApplied(false);
    try {
      const values = form.getFieldsValue();
      const opsPayload = buildOperationsPayload(values.operations || []);
      const dueDate = values.dueDate?.format('YYYY-MM-DD');
      if (!dueDate) {
        setError('Set a date required before proposing a schedule.');
        return;
      }
      const { data } = isEdit && id
        ? await jobOrdersApi.proposeSchedule(id, { operations: opsPayload })
        : await jobOrdersApi.proposeDraftSchedule({
            dueDate,
            excludeJobId: id,
            operations: opsPayload,
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
    const ops = [...(form.getFieldValue('operations') || [])];
    for (const proposed of scheduleOps) {
      const idx = proposed.sequenceNo - 1;
      if (idx < 0 || idx >= ops.length || !proposed.scheduled) continue;
      ops[idx] = {
        ...ops[idx],
        scheduledStart: proposed.scheduledStart || undefined,
        scheduledEnd: proposed.scheduledEnd || undefined,
        machineUnitId: proposed.machineUnitId || undefined,
        status: ops[idx].status === 'PENDING' ? 'SCHEDULED' : ops[idx].status,
      };
    }
    form.setFieldValue('operations', ops);
    setScheduleApplied(true);
  };

  const handleScheduleOpChange = (sequenceNo: number, patch: Partial<ProposedOperation>) => {
    setScheduleOps((prev) =>
      (prev || []).map((op) => (op.sequenceNo === sequenceNo ? { ...op, ...patch } : op))
    );
    setScheduleApplied(false);
  };

  const onFinish = async (values: {
    clientId: string;
    title: string;
    description?: string;
    dueDate: dayjs.Dayjs;
    clientPoNumber?: string;
    poDate?: dayjs.Dayjs;
    priority: string;
    jobType: string;
    materialSource: string;
    quantity?: number;
    unitOfMeasure?: string;
    amount?: number;
    rawMaterials?: { name: string; quantity?: number; unit?: string }[];
    operations: OpFormRow[];
  }) => {
    setSubmitting(true);
    setError('');
    const payload = {
      clientId: values.clientId,
      title: values.title,
      description: values.description,
      dueDate: values.dueDate.format('YYYY-MM-DD'),
      clientPoNumber: values.clientPoNumber || null,
      poDate: values.poDate ? values.poDate.format('YYYY-MM-DD') : null,
      priority: values.priority,
      jobType: values.jobType,
      materialSource: values.materialSource,
      quantity: values.quantity ?? null,
      unitOfMeasure: values.unitOfMeasure || null,
      amount: values.amount ?? null,
      rawMaterials: (values.rawMaterials || [])
        .filter((m) => m.name?.trim())
        .map((m) => ({
          name: m.name.trim(),
          quantity: m.quantity,
          unit: m.unit || undefined,
        })),
      operations: buildOperationsPayload(values.operations),
    };

    try {
      if (isEdit && id) {
        await jobOrdersApi.update(id, payload);
      } else {
        await jobOrdersApi.create(payload);
      }
      navigate(isEdit && id ? `/job-orders/${id}` : '/job-orders');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="page-spinner">
        <Spin size="large" />
      </div>
    );
  }

  const sectionTitle = (text: string) => (
    <div
      style={{
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        color: '#64748b',
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: '1px solid #e2e8f0',
      }}
    >
      {text}
    </div>
  );

  return (
    <div className={`jo-page${scheduleOps ? ' jo-page--with-schedule' : ''}`}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          {isEdit ? 'Edit Job Order' : 'New Job Order'}
        </Title>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {isEdit && id && (
            <>
              <Link to={`/job-orders/${id}`} style={{ fontSize: 13, fontWeight: 600 }}>
                ← View job order
              </Link>
              <Button onClick={() => navigate(`/job-orders/${id}/print`)}>Print</Button>
            </>
          )}
          <Text type="secondary" style={{ fontSize: 13 }}>
            Fields marked <span style={{ color: '#dc2626' }}>*</span> are required
          </Text>
        </div>
      </div>

      {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} showIcon />}
      {refWarnings.length > 0 && (
        <Alert
          type="warning"
          message={refWarnings.join(' · ')}
          style={{ marginBottom: 12 }}
          showIcon
        />
      )}

      <Form
        form={form}
        layout="vertical"
        size="large"
        className="jo-form"
        onFinish={onFinish}
        initialValues={{
          priority: 'MODERATE',
          jobType: 'FABRICATION',
          materialSource: 'SHOP_PROCURED',
          operations: [{ operationTypeId: undefined, operationName: '', machineTypeId: undefined, assignedWorkerId: undefined }],
          rawMaterials: [{ name: '', quantity: undefined, unit: '' }],
        }}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        <Row
          gutter={[16, 16]}
          style={
            scheduleOps
              ? { flex: '0 0 auto' }
              : { flex: 1, minHeight: 0 }
          }
        >
          <Col xs={24} lg={11} className="jo-col">
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 12,
                padding: 18,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                overflowY: 'auto',
              }}
            >
              {sectionTitle('Job Information')}

              <Row gutter={12}>
                <Col span={14}>
                  <Form.Item
                    name="clientId"
                    label="Client"
                    rules={[{ required: true }]}
                    style={{ marginBottom: 12 }}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      options={clients.map((c) => ({ value: c.id, label: c.name }))}
                      placeholder="Select client"
                    />
                  </Form.Item>
                </Col>
                <Col span={10}>
                  <Form.Item
                    name="dueDate"
                    label="Date Required"
                    rules={[{ required: true }]}
                    style={{ marginBottom: 12 }}
                  >
                    <DatePicker style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="clientPoNumber" label="Client PO #" style={{ marginBottom: 12 }}>
                    <Input placeholder="PO number" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="poDate" label="PO Date" style={{ marginBottom: 12 }}>
                    <DatePicker style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item name="title" label="Title" rules={[{ required: true }]} style={{ marginBottom: 12 }}>
                <Input placeholder="e.g. Modification of Cyclodrive Base" />
              </Form.Item>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item
                    name="jobType"
                    label="Job Type"
                    rules={[{ required: true }]}
                    style={{ marginBottom: 12 }}
                  >
                    <Select
                      options={[
                        { value: 'FABRICATION', label: 'Fabrication' },
                        { value: 'MODIFICATION', label: 'Modification' },
                        { value: 'REPAIR', label: 'Repair' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="materialSource"
                    label="Material Source"
                    rules={[{ required: true }]}
                    style={{ marginBottom: 12 }}
                  >
                    <Select
                      options={[
                        { value: 'SHOP_PROCURED', label: 'Shop procured' },
                        { value: 'CLIENT_SUPPLIED', label: 'Client supplied' },
                      ]}
                    />
                  </Form.Item>
                </Col>
              </Row>

              {isEdit && (
                <Form.Item name="partCondition" label="Stage of the part" style={{ marginBottom: 12 }}>
                  <Select
                    disabled
                    options={[
                      { value: 'RAW_MATERIAL', label: 'Raw material' },
                      { value: 'CLIENT_SUPPLIED_ITEM', label: 'Client supplied item' },
                      { value: 'BLANK', label: 'Blank' },
                      { value: 'WORK_IN_PROCESS', label: 'Work in process' },
                      { value: 'MACHINED', label: 'Machined' },
                      { value: 'HEAT_TREATED', label: 'Heat treated' },
                      { value: 'FINISHED', label: 'Finished' },
                    ]}
                  />
                </Form.Item>
              )}

              <Row gutter={12}>
                <Col span={8}>
                  <Form.Item name="quantity" label="Quantity" style={{ marginBottom: 12 }}>
                    <InputNumber style={{ width: '100%' }} min={0} step={0.01} placeholder="1.00" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="unitOfMeasure" label="Unit" style={{ marginBottom: 12 }}>
                    <Select
                      allowClear
                      placeholder="UM"
                      options={[
                        { value: 'pcs', label: 'pcs' },
                        { value: 'lot', label: 'lot' },
                        { value: 'set', label: 'set' },
                        { value: 'kg', label: 'kg' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="priority"
                    label="Priority"
                    rules={[{ required: true }]}
                    style={{ marginBottom: 12 }}
                  >
                    <Select
                      options={[
                        { value: 'HIGH', label: 'High' },
                        { value: 'MODERATE', label: 'Moderate' },
                        { value: 'LOW', label: 'Low' },
                      ]}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item name="amount" label="Amount (PHP)" style={{ marginBottom: 12 }}>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                />
              </Form.Item>

              <Form.Item name="description" label="Description" style={{ marginBottom: 12 }}>
                <TextArea
                  rows={2}
                  placeholder="Notes from PO / special instructions (optional)"
                  style={{ resize: 'none' }}
                />
              </Form.Item>

              {sectionTitle('Raw Materials')}
              <Form.List name="rawMaterials">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map(({ key, name, ...rest }) => (
                      <div
                        key={key}
                        style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}
                      >
                        <Form.Item
                          {...rest}
                          name={[name, 'name']}
                          style={{ flex: 2, marginBottom: 0 }}
                        >
                          <Input placeholder="Material name" />
                        </Form.Item>
                        <Form.Item {...rest} name={[name, 'quantity']} style={{ width: 90, marginBottom: 0 }}>
                          <InputNumber style={{ width: '100%' }} min={0} placeholder="Qty" />
                        </Form.Item>
                        <Form.Item {...rest} name={[name, 'unit']} style={{ width: 100, marginBottom: 0 }}>
                          <Select
                            allowClear
                            placeholder="Unit"
                            options={[
                              { value: 'pcs', label: 'pcs' },
                              { value: 'lot', label: 'lot' },
                              { value: 'set', label: 'set' },
                              { value: 'kg', label: 'kg' },
                            ]}
                          />
                        </Form.Item>
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          disabled={fields.length <= 1}
                          onClick={() => remove(name)}
                        />
                      </div>
                    ))}
                    <Button
                      type="default"
                      onClick={() => add()}
                      block
                      icon={<PlusOutlined />}
                      style={{
                        height: 44,
                        paddingTop: 10,
                        paddingBottom: 10,
                        fontWeight: 600,
                        color: '#475569',
                        borderColor: '#cbd5e1',
                        borderStyle: 'dashed',
                      }}
                    >
                      Add Material
                    </Button>
                  </>
                )}
              </Form.List>
            </div>
          </Col>

          <Col xs={24} lg={13} className="jo-col">
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 12,
                padding: 18,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
              }}
            >
              {sectionTitle('Operations')}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                <Button
                  icon={<CalendarOutlined />}
                  loading={proposing}
                  onClick={handleProposeSchedule}
                  style={{ fontWeight: 600 }}
                >
                  Propose Schedule
                </Button>
              </div>

              <Form.List name="operations">
                {(fields, { add, remove }) => (
                  <>
                    <div style={{ flex: 1, minHeight: 120, overflowY: 'auto', paddingRight: 4, marginBottom: 10 }}>
                      {fields.map(({ key, name, ...rest }, index) => {
                        const suggestions = rowSuggestions[index] || [];
                        const qualifiedWorkers = rowWorkers[index] || [];
                        const rowMachineId = resolveMachineTypeId(operations[index]);
                        return (
                          <div
                            key={key}
                            style={{
                              border: '1px solid #e2e8f0',
                              borderRadius: 10,
                              padding: 12,
                              marginBottom: 10,
                              background: '#fff',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                              <span
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: 8,
                                  background: '#e2e8f0',
                                  color: '#475569',
                                  fontSize: 12,
                                  fontWeight: 700,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                }}
                              >
                                {index + 1}
                              </span>
                              <Form.Item
                                {...rest}
                                name={[name, 'operationTypeId']}
                                rules={[{ required: true, message: 'Required' }]}
                                style={{ flex: 1, marginBottom: 0 }}
                              >
                                <Select
                                  showSearch
                                  optionFilterProp="label"
                                  placeholder="Operation type"
                                  options={operationTypes.map((t) => ({
                                    value: t.id,
                                    label: t.name,
                                  }))}
                                  onChange={(v) => onOperationTypeChange(index, v)}
                                />
                              </Form.Item>
                              <Form.Item name={[name, 'operationName']} hidden>
                                <Input />
                              </Form.Item>
                              <Button
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                disabled={fields.length <= 1}
                                onClick={() => {
                                  remove(name);
                                  setRowWorkers((prev) => {
                                    const next = { ...prev };
                                    delete next[index];
                                    return next;
                                  });
                                  setRowSuggestions((prev) => {
                                    const next = { ...prev };
                                    delete next[index];
                                    return next;
                                  });
                                }}
                              />
                            </div>

                            <Row gutter={8}>
                              <Col span={10}>
                                <Form.Item
                                  {...rest}
                                  name={[name, 'machineTypeId']}
                                  style={{ marginBottom: 8 }}
                                  label={<span style={{ fontSize: 12 }}>Machine</span>}
                                >
                                  <Select
                                    allowClear
                                    placeholder="Machine type"
                                    options={machineOptionsForRow(machines, operations, index)}
                                    notFoundContent="No machines available"
                                    onChange={(v) => onMachineTypeChange(index, v)}
                                  />
                                </Form.Item>
                              </Col>
                              <Col span={8}>
                                <Form.Item
                                  {...rest}
                                  name={[name, 'assignedWorkerId']}
                                  style={{ marginBottom: 8 }}
                                  label={<span style={{ fontSize: 12 }}>Worker</span>}
                                >
                                  <Select
                                    allowClear
                                    placeholder={
                                      rowMachineId ? 'Qualified workers' : 'Assign worker'
                                    }
                                    options={workerOptions(qualifiedWorkers)}
                                    notFoundContent={
                                      rowMachineId
                                        ? 'No workers skilled for this machine'
                                        : 'No workers'
                                    }
                                  />
                                </Form.Item>
                              </Col>
                              <Col span={6}>
                                <Form.Item
                                  {...rest}
                                  name={[name, 'estimatedHours']}
                                  style={{ marginBottom: 8 }}
                                  label={<span style={{ fontSize: 12 }}>Target hours</span>}
                                >
                                  <InputNumber
                                    style={{ width: '100%' }}
                                    min={0}
                                    step={0.5}
                                    placeholder="Target"
                                  />
                                </Form.Item>
                              </Col>
                            </Row>

                            <Form.Item name={[name, 'status']} hidden>
                              <Input />
                            </Form.Item>
                            <Form.Item name={[name, 'id']} hidden>
                              <Input />
                            </Form.Item>

                            {suggestions.length > 0 && (() => {
                              const qualified = suggestions.filter((s) => s.qualified !== false);
                              const unqualified = suggestions.filter((s) => s.qualified === false);
                              const topId = qualified[0]?.workerId;
                              return (
                              <div style={{ marginTop: 4 }}>
                                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
                                  Ranked suggestions (click to assign — not auto-selected)
                                </Text>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  {qualified.slice(0, 5).map((s) => {
                                    const inDropdown = qualifiedWorkers.some((w) => w.id === s.workerId);
                                    const isTop = s.workerId === topId;
                                    return (
                                      <div
                                        key={s.workerId}
                                        onClick={() => {
                                          if (!inDropdown) return;
                                          const ops = form.getFieldValue('operations') || [];
                                          const next = [...ops];
                                          next[index] = {
                                            ...next[index],
                                            assignedWorkerId: s.workerId,
                                          };
                                          form.setFieldValue('operations', next);
                                        }}
                                        style={{
                                          cursor: inDropdown ? 'pointer' : 'not-allowed',
                                          opacity: inDropdown ? 1 : 0.55,
                                          padding: '6px 10px',
                                          borderRadius: 6,
                                          border: isTop ? '1.5px solid #c9a227' : '1px solid #e8e8e8',
                                          background: isTop ? '#fffbeb' : '#fafafa',
                                        }}
                                      >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                          {isTop && <StarFilled style={{ color: '#c9a227', fontSize: 12 }} />}
                                          <Text strong style={{ fontSize: 12 }}>{s.fullName}</Text>
                                          <Tag color={isTop ? 'gold' : 'default'} style={{ margin: 0, fontSize: 11 }}>
                                            {(s.score * 100).toFixed(0)}%
                                          </Tag>
                                        </div>
                                        {s.reason && (
                                          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
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
                                    <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      {unqualified.slice(0, 8).map((s) => (
                                        <Text key={s.workerId} type="secondary" style={{ fontSize: 11 }}>
                                          {s.fullName} — {s.reason || 'not qualified'}
                                        </Text>
                                      ))}
                                    </div>
                                  </details>
                                )}
                              </div>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>
                    <Button
                      type="dashed"
                      onClick={() => {
                        add({
                          operationTypeId: undefined,
                          operationName: '',
                          machineTypeId: undefined,
                          assignedWorkerId: undefined,
                        });
                      }}
                      block
                      icon={<PlusOutlined />}
                    >
                      Add Operation
                    </Button>
                  </>
                )}
              </Form.List>
            </div>
          </Col>
        </Row>

        {scheduleOps && (
          <div style={{ marginTop: 16, flexShrink: 0 }}>
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
                jobTitle={form.getFieldValue('title') || 'Job order'}
                operations={scheduleOps}
                machineUnits={machineUnits}
              />
            </div>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            marginTop: 14,
            paddingTop: 14,
            borderTop: '1px solid #e2e8f0',
            flexShrink: 0,
          }}
        >
          <Button onClick={() => navigate(isEdit && id ? `/job-orders/${id}` : '/job-orders')}>
            Cancel
          </Button>
          <Button type="primary" htmlType="submit" loading={submitting} style={{ fontWeight: 600, minWidth: 160 }}>
            {isEdit ? 'Save Changes' : 'Create Job Order'}
          </Button>
        </div>
      </Form>
    </div>
  );
}
