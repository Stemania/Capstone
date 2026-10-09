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
  Radio,
} from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { clientsApi, jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import type { Client, JobOrderStatus } from '../../types';
import { jobOrdersDraftsListPath } from './jobOrderListPaths';

const { Title, Text } = Typography;
const { TextArea } = Input;

type MaterialsNeeded = 'TO_ORDER' | 'NOT_REQUIRED';

/** Fabrication needs material bought for it; Repair and Modification usually don't. */
const defaultMaterialsNeeded = (jobType?: string): MaterialsNeeded =>
  jobType === 'FABRICATION' ? 'TO_ORDER' : 'NOT_REQUIRED';

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
  const [jobStatus, setJobStatus] = useState<JobOrderStatus | null>(null);
  const [materialsTouched, setMaterialsTouched] = useState(false);
  const { isAdmin } = useAuth();
  const released = jobStatus != null && jobStatus !== 'DRAFT';
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
        setJobStatus(data.status);
        setMaterialsTouched(true);
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
          materialsNeeded: data.materialStatus === 'NOT_REQUIRED' ? 'NOT_REQUIRED' : 'TO_ORDER',
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
      materialsNeeded: MaterialsNeeded;
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
      jobType: values.jobType,
      quantity: values.quantity ?? null,
      unitOfMeasure: values.unitOfMeasure || null,
      amount: values.amount ?? null,
      materialStatus: values.materialsNeeded,
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
          materialsNeeded: defaultMaterialsNeeded('FABRICATION'),
        }}
        onValuesChange={(changed) => {
          if ('materialsNeeded' in changed) setMaterialsTouched(true);
          if ('jobType' in changed && !materialsTouched) {
            form.setFieldValue('materialsNeeded', defaultMaterialsNeeded(changed.jobType));
          }
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
              <Form.Item
                name="materialsNeeded"
                label="Materials needed"
                rules={[{ required: true }]}
                style={{ marginBottom: 8 }}
              >
                <Radio.Group>
                  <Space direction="vertical">
                    <Radio value="TO_ORDER">To order</Radio>
                    <Radio value="NOT_REQUIRED" disabled={released && !isAdmin}>
                      Not required (client-supplied or from stock)
                    </Radio>
                  </Space>
                </Radio.Group>
              </Form.Item>
              <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                Materials are entered when ordering (Order materials on the job), not here.
                {released && !isAdmin
                  ? ' After release only the Admin can set Not required.'
                  : ''}
              </Text>
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
