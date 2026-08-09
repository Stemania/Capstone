import { useEffect, useState } from 'react';
import {
  Form, Input, InputNumber, Button, DatePicker, Select, Typography, Alert, Tag, Spin, Row, Col,
} from 'antd';
import { DeleteOutlined, PlusOutlined, StarFilled } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { clientsApi, jobOrdersApi, workersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import { MACHINE_OPTIONS } from '../../types';
import type { Client, MachineInfo, User, WorkerSuggestion } from '../../types';

const { Title, Text } = Typography;
const { TextArea } = Input;

type OpFormRow = {
  id?: string;
  operationName?: string;
  machineTypeId?: string;
  assignedWorkerId?: string;
  estimatedHours?: number;
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
  const [workers, setWorkers] = useState<User[]>([]);
  const [machines, setMachines] = useState<MachineInfo[]>(MACHINE_OPTIONS);
  const [rowSuggestions, setRowSuggestions] = useState<Record<number, WorkerSuggestion[]>>({});
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const watchedOps = Form.useWatch('operations', form) as OpFormRow[] | undefined;
  const operations = watchedOps || [];

  useEffect(() => {
    const load = async () => {
      try {
        const [clientsRes, workersRes, machinesRes] = await Promise.all([
          clientsApi.list(),
          workersApi.list(),
          jobOrdersApi.machines(),
        ]);
        setClients(clientsRes.data);
        setWorkers(workersRes.data);
        setMachines(machinesRes.data);

        if (isEdit && id) {
          const { data: job } = await jobOrdersApi.get(id);
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
            operations: job.operations?.map((op) => ({
              id: op.id,
              operationName: op.operationName || op.name,
              machineTypeId: op.machineTypeId || undefined,
              assignedWorkerId: op.assignedWorkerId || undefined,
              estimatedHours: op.estimatedHours ?? undefined,
              status: op.status,
            })) || [{ operationName: '', machineTypeId: undefined, assignedWorkerId: undefined }],
          });
        }
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, isEdit, form]);

  const fetchRowSuggestion = async (rowIndex: number, operationName?: string) => {
    const name = (operationName || '').trim();
    if (!name) {
      setRowSuggestions((prev) => ({ ...prev, [rowIndex]: [] }));
      return;
    }
    try {
      const opId = operations[rowIndex]?.id;
      const { data } = await workersApi.suggest([name], {
        excludeJobId: id,
        excludeOperationId: opId,
      });
      const availableIds = new Set(
        workers.filter((w) => w.available !== false).map((w) => w.id)
      );
      const filtered = data.suggestions.filter((s) => availableIds.has(s.workerId));
      setRowSuggestions((prev) => ({ ...prev, [rowIndex]: filtered }));
    } catch {
      setRowSuggestions((prev) => ({ ...prev, [rowIndex]: [] }));
    }
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
      operations: values.operations.map((op, i) => {
        const mt = machines.find(
          (m) => m.id === op.machineTypeId || m.code === op.machineTypeId
        );
        return {
          sequenceNo: i + 1,
          operationName: op.operationName,
          ...(mt?.id
            ? { machineTypeId: mt.id }
            : { machinesNeeded: mt ? [mt.code] : [] }),
          assignedWorkerId: op.assignedWorkerId || null,
          estimatedHours: op.estimatedHours ?? null,
          status: op.status || 'PENDING',
        };
      }),
    };

    try {
      if (isEdit && id) {
        await jobOrdersApi.update(id, payload);
      } else {
        await jobOrdersApi.create(payload);
      }
      navigate('/job-orders');
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
    <div className="jo-page">
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
        <Text type="secondary" style={{ fontSize: 13 }}>
          Fields marked <span style={{ color: '#dc2626' }}>*</span> are required
        </Text>
      </div>

      {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} showIcon />}

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
          operations: [{ operationName: '', machineTypeId: undefined, assignedWorkerId: undefined }],
          rawMaterials: [{ name: '', quantity: undefined, unit: '' }],
        }}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        <Row gutter={[16, 16]} style={{ flex: 1, minHeight: 0 }}>
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
                <Form.Item name="partCondition" label="Part Condition" style={{ marginBottom: 12 }}>
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

              <Form.List name="operations">
                {(fields, { add, remove }) => (
                  <>
                    <div style={{ flex: 1, minHeight: 120, overflowY: 'auto', paddingRight: 4, marginBottom: 10 }}>
                      {fields.map(({ key, name, ...rest }, index) => {
                        const suggestions = rowSuggestions[index] || [];
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
                                name={[name, 'operationName']}
                                rules={[{ required: true, message: 'Required' }]}
                                style={{ flex: 1, marginBottom: 0 }}
                              >
                                <Input
                                  placeholder="Operation name"
                                  onBlur={(e) => fetchRowSuggestion(index, e.target.value)}
                                />
                              </Form.Item>
                              <Button
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                disabled={fields.length <= 1}
                                onClick={() => {
                                  remove(name);
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
                                    placeholder="Assign worker"
                                    options={workerOptions(workers)}
                                  />
                                </Form.Item>
                              </Col>
                              <Col span={6}>
                                <Form.Item
                                  {...rest}
                                  name={[name, 'estimatedHours']}
                                  style={{ marginBottom: 8 }}
                                  label={<span style={{ fontSize: 12 }}>Hours</span>}
                                >
                                  <InputNumber
                                    style={{ width: '100%' }}
                                    min={0}
                                    step={0.5}
                                    placeholder="0"
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

                            {suggestions.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                  Suggest:
                                </Text>
                                {suggestions.slice(0, 3).map((s) => (
                                  <Tag
                                    key={s.workerId}
                                    icon={s.score > 0 ? <StarFilled /> : undefined}
                                    color={s.score > 0 ? 'gold' : 'default'}
                                    style={{
                                      cursor: 'pointer',
                                      marginInlineEnd: 0,
                                      padding: '2px 8px',
                                    }}
                                    onClick={() => {
                                      const ops = form.getFieldValue('operations') || [];
                                      const next = [...ops];
                                      next[index] = {
                                        ...next[index],
                                        assignedWorkerId: s.workerId,
                                      };
                                      form.setFieldValue('operations', next);
                                    }}
                                  >
                                    {s.fullName}
                                  </Tag>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <Button
                      type="dashed"
                      onClick={() =>
                        add({
                          operationName: '',
                          machineTypeId: undefined,
                          assignedWorkerId: undefined,
                        })
                      }
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
          <Button onClick={() => navigate('/job-orders')}>Cancel</Button>
          <Button type="primary" htmlType="submit" loading={submitting} style={{ fontWeight: 600, minWidth: 160 }}>
            {isEdit ? 'Save Changes' : 'Create Job Order'}
          </Button>
        </div>
      </Form>
    </div>
  );
}
