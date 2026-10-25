import { useEffect, useState } from 'react';
import {
  Form,
  Input,
  InputNumber,
  Button,
  DatePicker,
  Select,
  Alert,
  Row,
  Col,
  Radio,
} from 'antd';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { clientsApi, jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { isFutureShopDay, isPastShopDay } from '../../utils/shopTime';
import type { Client, JobOrderStatus } from '../../types';
import { jobOrdersDraftsListPath } from './jobOrderListPaths';
import { MATERIALS_NEEDED_OPTIONS } from './jobOrderListTabs';
import { IdChip, Page, SectionCard, PageSkeleton } from '../../components/ui';
import './joForm.css';

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
  const presetClientId = !id ? searchParams.get('client') : null;
  const [form] = Form.useForm();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [jobNumber, setJobNumber] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobOrderStatus | null>(null);
  const [materialsTouched, setMaterialsTouched] = useState(false);
  const [loadedValues, setLoadedValues] = useState<Record<string, unknown> | null>(null);
  const { isAdmin, canOfficeWrite } = useAuth();
  const released = jobStatus != null && jobStatus !== 'DRAFT';
  /** Edit job info: Office Staff only, and only before release. */
  const canEditInfo = canOfficeWrite && (!isEdit || !released);
  const backTo = !id
    ? presetClientId
      ? `/clients/${presetClientId}`
      : jobOrdersDraftsListPath()
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
        setLoadedValues({
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
  }, [id, isEdit]);

  useEffect(() => {
    if (!presetClientId || form.getFieldValue('clientId')) return;
    if (clients.some((c) => c.id === presetClientId)) form.setFieldValue('clientId', presetClientId);
  }, [clients, form, presetClientId]);

  // The <Form> only mounts once loading ends, so fill it after that render.
  useEffect(() => {
    if (loading || !loadedValues) return;
    form.setFieldsValue(loadedValues);
    setLoadedValues(null);
  }, [form, loading, loadedValues]);

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
      <PageSkeleton variant="detail" />
    );
  }

  if (isEdit && id && (released || !canOfficeWrite)) {
    return <Navigate to={`/job-orders/${id}`} replace />;
  }

  if (!isEdit && !canOfficeWrite) {
    return <Navigate to={jobOrdersDraftsListPath()} replace />;
  }

  return (
    <Page className="jo-form-page">
      <SectionCard
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            {pageHeading}
            {isEdit && jobNumber ? <IdChip>{jobNumber}</IdChip> : null}
          </span>
        }
        extra={
          <span className="ui-muted-note">
            {canEditInfo ? (
              <>
                Fields marked <span className="tone-text--red">*</span> are required
              </>
            ) : (
              'Locked after release'
            )}
          </span>
        }
      >
        {error && <Alert type="error" title={error} style={{ marginBottom: 12 }} showIcon />}

        <Form
          form={form}
          layout="vertical"
          className="jo-form"
          requiredMark
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
          <div className="ui-form-section">Client information</div>
          <Row gutter={[16, 0]}>
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
                <DatePicker style={{ width: '100%' }} format="MMM D, YYYY" disabledDate={isFutureShopDay} />
              </Form.Item>
            </Col>
          </Row>

          <div className="ui-form-section">Job details</div>
          <Row gutter={[16, 0]}>
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
                <DatePicker style={{ width: '100%' }} format="MMM D, YYYY" disabledDate={isPastShopDay} />
              </Form.Item>
            </Col>
          </Row>

          <div className="ui-form-section">Quantity and amount</div>
          <Row gutter={[16, 0]} className="jo-form__qty-row">
            <Col xs={12} md={8}>
              <Form.Item name="quantity" label="Quantity">
                <InputNumber style={{ width: '100%' }} min={0} step={0.01} placeholder="1.00" />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
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
            <Col xs={24} md={8}>
              <Form.Item name="amount" label="Amount (PHP)">
                <InputNumber style={{ width: '100%' }} min={0} step={0.01} placeholder="0.00" />
              </Form.Item>
            </Col>
          </Row>

          <div className="ui-form-section">Description and materials</div>
          <Form.Item name="description" label="Description" className="jo-form__desc-item">
            <TextArea rows={4} placeholder="Notes from PO / special instructions (optional)" />
          </Form.Item>
          <Form.Item
            name="materialsNeeded"
            label="Materials needed"
            rules={[{ required: true }]}
            className="jo-form__materials-item"
            style={{ marginBottom: 4 }}
          >
            <Radio.Group className="jo-form__materials-radios">
              {MATERIALS_NEEDED_OPTIONS.map((opt) => (
                <Radio
                  key={opt.value}
                  value={opt.value}
                  disabled={opt.value === 'NOT_REQUIRED' && released && !isAdmin}
                >
                  {opt.label}
                </Radio>
              ))}
            </Radio.Group>
          </Form.Item>
          <div className="ui-muted-note jo-form__materials-note">
            Materials are entered when ordering (Order materials on the job), not here.
            {released && !isAdmin ? ' After release only the Admin can set Not required.' : ''}
          </div>

          <div className="jo-form__footer m-action-bar">
            <span className="m-action-bar__spacer" aria-hidden />
            <Button onClick={() => navigate(backTo)}>Cancel</Button>
            <Button type="primary" loading={submitting} onClick={saveJob} style={{ minWidth: 140 }}>
              Save
            </Button>
          </div>
        </Form>
      </SectionCard>
    </Page>
  );
}
