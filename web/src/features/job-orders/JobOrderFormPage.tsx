import { useEffect, useState } from 'react';
import {
  Form,
  Input,
  InputNumber,
  Button,
  DatePicker,
  Select,
  Typography,
  Alert,
  Spin,
  Row,
  Col,
  Space,
  Dropdown,
} from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, DownOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { clientsApi, jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import type { Client } from '../../types';

const { Title, Text } = Typography;
const { TextArea } = Input;

type SaveDestination = 'plan' | 'list' | 'detail';

export default function JobOrderFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [form] = Form.useForm();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobNumber, setJobNumber] = useState<string | null>(null);
  const NAVY = '#0f1c2e';
  const backTo = isEdit && id ? `/job-orders/${id}` : '/job-orders';
  // New jobs are DRAFT; planning entry only applies while still DRAFT.
  const canEnterPlanning = !isEdit || jobStatus === 'DRAFT' || jobStatus === null;
  const showAdminSplit = isAdmin && canEnterPlanning;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await clientsApi.list();
        if (!cancelled) setClients(data);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isEdit || !id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await jobOrdersApi.get(id);
        if (cancelled) return;
        setJobStatus(data.status);
        setJobNumber(data.jobNumber || data.id.slice(0, 8).toUpperCase());
        form.setFieldsValue({
          clientId: data.clientId,
          title: data.title,
          description: data.description,
          dueDate: data.dueDate ? dayjs(data.dueDate) : undefined,
          clientPoNumber: data.clientPoNumber,
          poDate: data.poDate ? dayjs(data.poDate) : undefined,
          priority: data.priority || 'MODERATE',
          jobType: data.jobType || 'FABRICATION',
          quantity: data.quantity,
          unitOfMeasure: data.unitOfMeasure,
          amount: data.amount,
          rawMaterials:
            (data.rawMaterials?.length ?? 0) > 0
              ? data.rawMaterials
              : [{ name: '', quantity: undefined, unit: '' }],
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
  }, [form, id, isEdit]);

  const saveJob = async (destination: SaveDestination) => {
    let values: {
      clientId: string;
      title: string;
      description?: string;
      dueDate: dayjs.Dayjs;
      clientPoNumber?: string;
      poDate?: dayjs.Dayjs;
      priority: string;
      jobType: string;
      quantity?: number;
      unitOfMeasure?: string;
      amount?: number;
      rawMaterials?: { name: string; quantity?: number; unit?: string }[];
    };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

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
    };

    try {
      let jobId = id;
      if (isEdit && id) {
        await jobOrdersApi.update(id, payload);
      } else {
        const { data } = await jobOrdersApi.create(payload);
        jobId = data.id;
      }

      if (destination === 'plan' && jobId) {
        navigate(`/job-orders/${jobId}/plan`);
      } else if (destination === 'list') {
        navigate('/job-orders');
      } else if (jobId) {
        navigate(`/job-orders/${jobId}`);
      } else {
        navigate('/job-orders');
      }
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

  return (
    <div className="jo-form-page" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="jo-form-page__header">
        <Space wrap size={8}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(backTo)}>
            Back
          </Button>
          <div>
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>
              {isEdit ? jobNumber || id?.slice(0, 8).toUpperCase() : 'New'}
            </Text>
            <Title level={4} style={{ margin: 0, color: NAVY, lineHeight: 1.25 }}>
              {isEdit ? 'Edit Job Information' : 'New Job Order'}
            </Title>
          </div>
        </Space>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Fields marked <span style={{ color: '#dc2626' }}>*</span> are required
        </Text>
      </div>

      {error && <Alert type="error" message={error} style={{ marginBottom: 10 }} showIcon />}
      {jobStatus === 'PLANNING' && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 10 }}
          message="This job is in planning. You can still update PO details; Admin owns operations."
        />
      )}

      <Form
        form={form}
        layout="vertical"
        size="large"
        className="jo-form"
        initialValues={{
          priority: 'MODERATE',
          jobType: 'FABRICATION',
          rawMaterials: [{ name: '', quantity: undefined, unit: '' }],
        }}
      >
        <Row gutter={[16, 0]} align="stretch">
          {/* Row 1: Client · Client PO # · PO Date */}
          <Col xs={24} md={8}>
            <Form.Item name="clientId" label="Client" rules={[{ required: true }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={clients.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Select client"
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="clientPoNumber" label="Client PO #">
              <Input placeholder="PO number" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="poDate" label="PO Date">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>

          {/* Row 2: Title · Job Type · Priority */}
          <Col xs={24} md={12}>
            <Form.Item name="title" label="Title" rules={[{ required: true }]}>
              <Input placeholder="e.g. Modification of Cyclodrive Base" />
            </Form.Item>
          </Col>
          <Col xs={24} md={6}>
            <Form.Item name="jobType" label="Job Type" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'FABRICATION', label: 'Fabrication' },
                  { value: 'MODIFICATION', label: 'Modification' },
                  { value: 'REPAIR', label: 'Repair' },
                ]}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={6}>
            <Form.Item name="priority" label="Priority" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'HIGH', label: 'High' },
                  { value: 'MODERATE', label: 'Moderate' },
                  { value: 'LOW', label: 'Low' },
                ]}
              />
            </Form.Item>
          </Col>

          {/* Row 3: Date Required · Quantity · Unit · Amount */}
          <Col xs={24} md={6}>
            <Form.Item name="dueDate" label="Date Required" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item name="quantity" label="Quantity">
              <InputNumber style={{ width: '100%' }} min={0} step={0.01} placeholder="1.00" />
            </Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item name="unitOfMeasure" label="Unit">
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
          <Col xs={24} md={10}>
            <Form.Item name="amount" label="Amount (PHP)">
              <InputNumber style={{ width: '100%' }} min={0} step={0.01} placeholder="0.00" />
            </Form.Item>
          </Col>

          {/* Row 4: Description · Raw Materials (equal height; grow together) */}
          <Col xs={24} md={12} className="jo-form__pair-col">
            <Form.Item name="description" label="Description" className="jo-form__desc-item">
              <TextArea
                rows={5}
                placeholder="Notes from PO / special instructions (optional)"
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12} className="jo-form__pair-col">
            <div className="jo-form__materials">
              <div className="jo-form__materials-label">Raw Materials</div>
              <Form.List name="rawMaterials">
                {(fields, { add, remove }) => (
                  <div className="jo-form__materials-body">
                    <div className="jo-form__materials-scroll">
                      {fields.map(({ key, name, ...rest }) => (
                        <div key={key} className="jo-form__materials-row">
                          <Form.Item
                            {...rest}
                            name={[name, 'name']}
                            style={{ flex: 2, marginBottom: 0 }}
                          >
                            <Input placeholder="Material name" />
                          </Form.Item>
                          <Form.Item
                            {...rest}
                            name={[name, 'quantity']}
                            style={{ width: 88, marginBottom: 0 }}
                          >
                            <InputNumber style={{ width: '100%' }} min={0} placeholder="Qty" />
                          </Form.Item>
                          <Form.Item
                            {...rest}
                            name={[name, 'unit']}
                            style={{ width: 96, marginBottom: 0 }}
                          >
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
                    </div>
                    <Button
                      type="default"
                      onClick={() => add()}
                      block
                      icon={<PlusOutlined />}
                      className="jo-form__materials-add"
                    >
                      Add Material
                    </Button>
                  </div>
                )}
              </Form.List>
            </div>
          </Col>
        </Row>

        <div className="jo-form__footer">
          <Button onClick={() => navigate(backTo)}>Cancel</Button>
          {showAdminSplit ? (
            <Dropdown.Button
              type="primary"
              loading={submitting}
              icon={<DownOutlined />}
              onClick={() => saveJob('plan')}
              style={{ fontWeight: 600 }}
              menu={{
                items: [
                  {
                    key: 'draft',
                    label: 'Save as draft',
                    onClick: () => saveJob('list'),
                  },
                ],
              }}
            >
              Save and plan
            </Dropdown.Button>
          ) : (
            <Button
              type="primary"
              loading={submitting}
              onClick={() => saveJob(canEnterPlanning ? 'list' : 'detail')}
              style={{ fontWeight: 600, minWidth: 160 }}
            >
              {canEnterPlanning ? 'Save as draft' : 'Save Job Information'}
            </Button>
          )}
        </div>
      </Form>
    </div>
  );
}
