import { useEffect, useState } from 'react';
import {
  Form, Input, Button, DatePicker, Select, Typography, Alert, Tag, Spin, Row, Col,
} from 'antd';
import { DeleteOutlined, PlusOutlined, StarFilled } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { clientsApi, jobOrdersApi, workersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import type { Client, User, WorkerSuggestion } from '../../types';
import apiClient from '../../api/client';

const { Title, Text } = Typography;
const { TextArea } = Input;

export default function JobOrderFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [clients, setClients] = useState<Client[]>([]);
  const [workers, setWorkers] = useState<User[]>([]);
  const [suggestions, setSuggestions] = useState<WorkerSuggestion[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const [clientsRes, workersRes] = await Promise.all([
          clientsApi.list(),
          apiClient.get<User[]>('/workers'),
        ]);
        setClients(clientsRes.data);
        setWorkers(workersRes.data);

        if (isEdit && id) {
          const { data: job } = await jobOrdersApi.get(id);
          form.setFieldsValue({
            clientId: job.clientId,
            title: job.title,
            description: job.description,
            dueDate: dayjs(job.dueDate),
            assignedWorkerId: job.assignedWorkerId,
            operations: job.operations?.map((op) => ({ name: op.name })) || [{ name: '' }],
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
    assignedWorkerId?: string;
    operations: { name: string }[];
  }) => {
    setSubmitting(true);
    setError('');
    const payload = {
      clientId: values.clientId,
      title: values.title,
      description: values.description,
      dueDate: values.dueDate.format('YYYY-MM-DD'),
      assignedWorkerId: values.assignedWorkerId,
      operations: values.operations.map((op, i) => ({ seq: i + 1, name: op.name })),
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

  if (loading) return <Spin size="large" />;

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
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
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
        initialValues={{ operations: [{ name: '' }] }}
        style={{ marginBottom: 0 }}
      >
        <Row gutter={[20, 16]}>
          <Col xs={24} lg={13}>
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 12,
                padding: '16px 18px',
                height: '100%',
              }}
            >
              {sectionTitle('Job Information')}

              <Row gutter={12}>
                <Col span={14}>
                  <Form.Item
                    name="clientId"
                    label="Client"
                    rules={[{ required: true }]}
                    style={{ marginBottom: 14 }}
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
                    style={{ marginBottom: 14 }}
                  >
                    <DatePicker style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item name="title" label="Title" rules={[{ required: true }]} style={{ marginBottom: 14 }}>
                <Input placeholder="e.g. Hydraulic Cylinder Rod" />
              </Form.Item>

              <Form.Item name="description" label="Description" style={{ marginBottom: 0 }}>
                <TextArea
                  rows={4}
                  placeholder="Notes, tolerances, special instructions (optional)"
                  style={{ resize: 'none' }}
                />
              </Form.Item>
            </div>
          </Col>

          <Col xs={24} lg={11}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  padding: '16px 18px',
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {sectionTitle('Operations')}

                <div style={{ flex: 1, maxHeight: 132, overflowY: 'auto', paddingRight: 4, marginBottom: 10 }}>
                  <Form.List name="operations">
                    {(fields, { remove }) => (
                      <>
                        {fields.map(({ key, name, ...rest }, index) => (
                          <div
                            key={key}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}
                          >
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
                              rules={[{ required: true, message: 'Operation name required' }]}
                              style={{ flex: 1, marginBottom: 0 }}
                            >
                              <Input placeholder="Operation name (e.g. Milling)" onBlur={onOperationsChange} />
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
                        ))}
                      </>
                    )}
                  </Form.List>
                </div>

                <Form.List name="operations">
                  {(_fields, { add }) => (
                    <Button
                      type="dashed"
                      onClick={() => add()}
                      block
                      icon={<PlusOutlined />}
                    >
                      Add Operation
                    </Button>
                  )}
                </Form.List>
              </div>

              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  padding: '16px 18px',
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
            marginTop: 16,
            paddingTop: 16,
            borderTop: '1px solid #e2e8f0',
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
