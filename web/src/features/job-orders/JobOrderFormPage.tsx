import { useEffect, useState } from 'react';
import {
  Form, Input, Button, DatePicker, Select, Space, Card, Typography, Alert, Tag, Spin,
} from 'antd';
import { MinusCircleOutlined, PlusOutlined, StarOutlined } from '@ant-design/icons';
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

  return (
    <div>
      <Title level={4}>{isEdit ? 'Edit Job Order' : 'New Job Order'}</Title>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}

      <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ operations: [{ name: '' }] }}>
        <Form.Item name="clientId" label="Client" rules={[{ required: true }]}>
          <Select
            showSearch
            optionFilterProp="label"
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Select client"
          />
        </Form.Item>

        <Form.Item name="title" label="Title" rules={[{ required: true }]}>
          <Input />
        </Form.Item>

        <Form.Item name="description" label="Description">
          <TextArea rows={3} />
        </Form.Item>

        <Form.Item name="dueDate" label="Due Date" rules={[{ required: true }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>

        <Title level={5}>Operations</Title>
        <Form.List name="operations">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...rest }) => (
                <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                  <Form.Item
                    {...rest}
                    name={[name, 'name']}
                    rules={[{ required: true, message: 'Operation name required' }]}
                    style={{ flex: 1, minWidth: 200 }}
                  >
                    <Input placeholder="Operation name" onBlur={onOperationsChange} />
                  </Form.Item>
                  {fields.length > 1 && (
                    <MinusCircleOutlined onClick={() => { remove(name); onOperationsChange(); }} />
                  )}
                </Space>
              ))}
              <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                Add Operation
              </Button>
            </>
          )}
        </Form.List>

        {suggestions.length > 0 && (
          <Card size="small" title="Suggested Workers" style={{ marginTop: 16, marginBottom: 16 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              The system proposes, the human decides.
            </Text>
            {suggestions.slice(0, 3).map((s) => (
              <div key={s.workerId} style={{ marginBottom: 8 }}>
                <Tag icon={<StarOutlined />} color={s.score > 0 ? 'gold' : 'default'}>
                  {s.fullName} (score: {s.score})
                </Tag>
                {s.matchedSkills.map((sk) => (
                  <Tag key={sk}>{sk}</Tag>
                ))}
              </div>
            ))}
          </Card>
        )}

        <Form.Item name="assignedWorkerId" label="Assign Worker" rules={[{ required: true }]}>
          <Select
            placeholder="Select worker"
            options={workers.map((w) => ({ value: w.id, label: w.fullName }))}
          />
        </Form.Item>

        <Space>
          <Button type="primary" htmlType="submit" loading={submitting}>
            {isEdit ? 'Save Changes' : 'Create Job Order'}
          </Button>
          <Button onClick={() => navigate('/job-orders')}>Cancel</Button>
        </Space>
      </Form>
    </div>
  );
}
