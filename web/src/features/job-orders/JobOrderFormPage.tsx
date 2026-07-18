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
import apiClient from '../../api/client';

const { Title, Text } = Typography;
const { TextArea } = Input;

type OpFormRow = {
  name?: string;
  machinesNeeded?: string[];
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
    // Only draft/pending ops reserve capacity in the form; in-progress are already in API inUse
    if (op.status === 'IN_PROGRESS' || op.status === 'COMPLETED') return;
    (op.machinesNeeded || []).forEach((code) => {
      reservedByOthers[code] = (reservedByOthers[code] || 0) + 1;
    });
  });

  const selected = new Set(operations[rowIndex]?.machinesNeeded || []);

  return catalog
    .map((m) => {
      const baseAvailable = m.available ?? m.units;
      const remaining = Math.max(0, baseAvailable - (reservedByOthers[m.code] || 0));
      return {
        value: m.code,
        label: `${m.name} (${remaining} available)`,
        remaining,
        keep: remaining > 0 || selected.has(m.code),
      };
    })
    .filter((o) => o.keep)
    .map(({ value, label }) => ({ value, label }));
}

export default function JobOrderFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [clients, setClients] = useState<Client[]>([]);
  const [workers, setWorkers] = useState<User[]>([]);
  const [machines, setMachines] = useState<MachineInfo[]>(MACHINE_OPTIONS);
  const [suggestions, setSuggestions] = useState<WorkerSuggestion[]>([]);
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
          apiClient.get<User[]>('/workers'),
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
            priority: job.priority || 'MODERATE',
            quantity: job.quantity ?? undefined,
            unitOfMeasure: job.unitOfMeasure || undefined,
            amount: job.amount ?? undefined,
            rawMaterials: job.rawMaterials?.length
              ? job.rawMaterials
              : [{ name: '', quantity: undefined, unit: '' }],
            assignedWorkerId: job.assignedWorkerId,
            operations: job.operations?.map((op) => ({
              name: op.name,
              machinesNeeded: op.machinesNeeded || [],
              status: op.status,
            })) || [{ name: '', machinesNeeded: [] }],
          });
          if (job.operations?.length) {
            fetchSuggestions(job.operations.map((op) => op.name));
          }
        }
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, isEdit, form]);

  const fetchSuggestions = async (operationNames: string[]) => {
    const names = operationNames.filter(Boolean);
    if (!names.length) {
      setSuggestions([]);
      return;
    }
    try {
      const { data } = await workersApi.suggest(names);
      setSuggestions(data.suggestions);
      if (!form.getFieldValue('assignedWorkerId') && data.suggestions.length) {
        form.setFieldValue('assignedWorkerId', data.suggestions[0].workerId);
      }
    } catch {
      setSuggestions([]);
    }
  };

  const onOperationsChange = () => {
    const ops = form.getFieldValue('operations') || [];
    fetchSuggestions(ops.map((o: { name: string }) => o.name));
  };

  const onFinish = async (values: {
    clientId: string;
    title: string;
    description?: string;
    dueDate: dayjs.Dayjs;
    priority: string;
    quantity?: number;
    unitOfMeasure?: string;
    amount?: number;
    rawMaterials?: { name: string; quantity?: number; unit?: string }[];
    assignedWorkerId?: string;
    operations: { name: string; machinesNeeded?: string[] }[];
  }) => {
    setSubmitting(true);
    setError('');
    const payload = {
      clientId: values.clientId,
      title: values.title,
      description: values.description,
      dueDate: values.dueDate.format('YYYY-MM-DD'),
      priority: values.priority,
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
      assignedWorkerId: values.assignedWorkerId,
      operations: values.operations.map((op, i) => ({
        seq: i + 1,
        name: op.name,
        machinesNeeded: op.machinesNeeded || [],
      })),
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
        onFinish={onFinish}
        initialValues={{
          priority: 'MODERATE',
          operations: [{ name: '', machinesNeeded: [] }],
          rawMaterials: [{ name: '', quantity: undefined, unit: '' }],
        }}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        <Row gutter={[16, 16]} style={{ flex: 1, minHeight: 0 }}>
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
                    label="Due Date"
                    rules={[{ required: true }]}
                    style={{ marginBottom: 12 }}
                  >
                    <DatePicker style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item name="title" label="Title" rules={[{ required: true }]} style={{ marginBottom: 12 }}>
                <Input placeholder="e.g. Modification of Cyclodrive Base" />
              </Form.Item>

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
                        <Form.Item {...rest} name={[name, 'unit']} style={{ width: 80, marginBottom: 0 }}>
                          <Input placeholder="Unit" />
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

          <Col xs={24} lg={11} className="jo-col">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  padding: 18,
                  flex: 1,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {sectionTitle('Operations & Machines')}

                <Form.List name="operations">
                  {(fields, { add, remove }) => (
                    <>
                      <div style={{ flex: 1, minHeight: 120, overflowY: 'auto', paddingRight: 4, marginBottom: 10 }}>
                        {fields.map(({ key, name, ...rest }, index) => (
                          <div
                            key={key}
                            style={{
                              border: '1px solid #e2e8f0',
                              borderRadius: 10,
                              padding: 10,
                              marginBottom: 8,
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
                                name={[name, 'name']}
                                rules={[{ required: true, message: 'Required' }]}
                                style={{ flex: 1, marginBottom: 0 }}
                              >
                                <Input placeholder="Operation name" onBlur={onOperationsChange} />
                              </Form.Item>
                              <Button
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                disabled={fields.length <= 1}
                                onClick={() => {
                                  remove(name);
                                  onOperationsChange();
                                }}
                              />
                            </div>
                            <Form.Item
                              {...rest}
                              name={[name, 'machinesNeeded']}
                              style={{ marginBottom: 0 }}
                            >
                              <Select
                                mode="multiple"
                                allowClear
                                showSearch={false}
                                placeholder="Machine needed"
                                options={machineOptionsForRow(machines, operations, index)}
                                maxTagCount="responsive"
                                notFoundContent="No machines available"
                                style={{ width: '100%' }}
                              />
                            </Form.Item>
                            <Form.Item name={[name, 'status']} hidden>
                              <Input />
                            </Form.Item>
                          </div>
                        ))}
                      </div>
                      <Button type="dashed" onClick={() => add({ name: '', machinesNeeded: [] })} block icon={<PlusOutlined />}>
                        Add Operation
                      </Button>
                    </>
                  )}
                </Form.List>
              </div>

              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  padding: 18,
                }}
              >
                {sectionTitle('Assignment')}

                <Form.Item
                  name="assignedWorkerId"
                  label="Assign Worker"
                  rules={[{ required: true }]}
                  style={{ marginBottom: suggestions.length ? 12 : 0 }}
                >
                  <Select
                    placeholder="Select worker"
                    options={workers.map((w) => ({ value: w.id, label: w.fullName }))}
                  />
                </Form.Item>

                {suggestions.length > 0 && (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                      Suggested based on operation skills — tap to assign:
                    </Text>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {suggestions.slice(0, 3).map((s) => (
                        <Tag
                          key={s.workerId}
                          icon={s.score > 0 ? <StarFilled /> : undefined}
                          color={s.score > 0 ? 'gold' : 'default'}
                          style={{ cursor: 'pointer', marginInlineEnd: 0, padding: '3px 10px' }}
                          onClick={() => form.setFieldValue('assignedWorkerId', s.workerId)}
                        >
                          {s.fullName}
                          {s.matchedSkills.length > 0 && ` · ${s.matchedSkills.join(', ')}`}
                        </Tag>
                      ))}
                    </div>
                  </div>
                )}
              </div>
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
