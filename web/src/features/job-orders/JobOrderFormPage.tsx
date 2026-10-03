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
  Modal,
} from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { clientsApi, jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import type { Client } from '../../types';
import { jobOrdersDraftsListPath } from './jobOrderListPaths';

const { Title, Text } = Typography;
const { TextArea } = Input;

export default function JobOrderFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromPlanning = searchParams.get('from') === 'plan';
  const [form] = Form.useForm();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [jobNumber, setJobNumber] = useState<string | null>(null);
  const NAVY = '#0f1c2e';
  const backTo = !id
    ? jobOrdersDraftsListPath()
    : fromPlanning
      ? `/job-orders/${id}/plan`
      : `/job-orders/${id}`;
  const pageHeading = isEdit ? 'Edit Job Information' : 'New Job Order';

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
        setJobNumber(data.jobNumber || data.id.slice(0, 8).toUpperCase());
        form.setFieldsValue({
          clientId: data.clientId,
          title: data.title,
          description: data.description,
          dueDate: data.dueDate ? dayjs(data.dueDate) : undefined,
          clientPoNumber: data.clientPoNumber,
          poDate: data.poDate ? dayjs(data.poDate) : undefined,
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

  const saveJob = async () => {
    let values: {
      clientId: string;
      title: string;
      description?: string;
      dueDate: dayjs.Dayjs;
      clientPoNumber?: string;
      poDate?: dayjs.Dayjs;
      jobType: string;
      quantity?: number;
      unitOfMeasure?: string;
      amount?: number;
      rawMaterials?: { id?: string; name: string; quantity?: number; unit?: string }[];
    };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const hasPlannedMaterials = (values.rawMaterials || []).some((m) => m.name?.trim());
    if (values.jobType === 'FABRICATION' && !hasPlannedMaterials) {
      const proceed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: 'No raw materials planned',
          content:
            'Fabrication usually needs material. Without planned materials this job is marked ' +
            'Not required and nothing will be ordered for it. Is that correct?',
          okText: 'Save anyway',
          cancelText: 'Add materials',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!proceed) return;
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
      jobType: values.jobType,
      quantity: values.quantity ?? null,
      unitOfMeasure: values.unitOfMeasure || null,
      amount: values.amount ?? null,
      rawMaterials: (values.rawMaterials || [])
        .filter((m) => m.name?.trim())
        .map((m) => ({
          id: m.id || undefined,
          name: m.name.trim(),
          quantity: m.quantity,
          unit: m.unit || undefined,
        })),
    };

    try {
      if (isEdit && id) {
        await jobOrdersApi.update(id, payload);
        navigate(backTo);
      } else {
        const { data } = await jobOrdersApi.create(payload);
        navigate(`/job-orders/${data.id}`);
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
    <div className="jo-form-page">
      <div className="jo-form-page__header">
        <Space wrap size={8}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(backTo)}>
            Exit
          </Button>
          <div>
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>
              {isEdit ? jobNumber || id?.slice(0, 8).toUpperCase() : 'New'}
            </Text>
            <Title level={4} style={{ margin: 0, color: NAVY, lineHeight: 1.25 }}>
              {pageHeading}
            </Title>
          </div>
        </Space>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Fields marked <span style={{ color: '#7A1528' }}>*</span> are required
        </Text>
      </div>

      {error && <Alert type="error" message={error} style={{ marginBottom: 10 }} showIcon />}

      <Form
        form={form}
        layout="vertical"
        size="large"
        className="jo-form"
        initialValues={{
          jobType: 'FABRICATION',
          rawMaterials: [{ name: '', quantity: undefined, unit: '' }],
        }}
      >
        <Row gutter={[16, 0]} align="stretch">
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
          <Col xs={24} md={16}>
            <Form.Item name="amount" label="Amount (PHP)">
              <InputNumber style={{ width: '100%' }} min={0} step={0.01} placeholder="0.00" />
            </Form.Item>
          </Col>

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
                          <Form.Item {...rest} name={[name, 'id']} hidden noStyle>
                            <Input />
                          </Form.Item>
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
          <Button onClick={() => navigate(backTo)}>Back</Button>
          <Button
            type="primary"
            loading={submitting}
            onClick={saveJob}
            style={{ fontWeight: 600, minWidth: 160 }}
          >
            Save
          </Button>
        </div>
      </Form>
    </div>
  );
}
