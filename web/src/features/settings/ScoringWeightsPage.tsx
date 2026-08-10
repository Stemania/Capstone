import { useEffect, useState } from 'react';
import { Alert, Button, Form, InputNumber, Spin, Typography, message } from 'antd';
import { workersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import type { ScoringWeights } from '../../types';

const { Title, Text, Paragraph } = Typography;

const NAVY = '#0f1c2e';

const LABELS: Record<keyof ScoringWeights, { title: string; hint: string }> = {
  skill: { title: 'Skill', hint: 'Machine proficiency match' },
  availability: { title: 'Availability', hint: 'Schedule fit and conflicts' },
  workload: { title: 'Workload', hint: 'Current-week estimated hours' },
  efficiency: { title: 'Efficiency', hint: 'Estimated vs actual on past ops' },
};

export default function ScoringWeightsPage() {
  const [form] = Form.useForm<ScoringWeights>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sum, setSum] = useState(1);

  const recalcSum = (values?: Partial<ScoringWeights>) => {
    const v = { ...form.getFieldsValue(), ...values };
    const total =
      Number(v.skill || 0) +
      Number(v.availability || 0) +
      Number(v.workload || 0) +
      Number(v.efficiency || 0);
    setSum(Math.round(total * 10000) / 10000);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await workersApi.getScoringWeights();
        form.setFieldsValue(data.weights);
        recalcSum(data.weights);
      } catch (err) {
        message.error(getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [form]);

  const onSave = async () => {
    try {
      const values = await form.validateFields();
      const total =
        Number(values.skill) +
        Number(values.availability) +
        Number(values.workload) +
        Number(values.efficiency);
      if (Math.abs(total - 1) > 0.0001) {
        message.error(`Weights must sum to 1.0 (currently ${total.toFixed(4)})`);
        return;
      }
      setSaving(true);
      const { data } = await workersApi.updateScoringWeights(values);
      form.setFieldsValue(data.weights);
      recalcSum(data.weights);
      message.success('Scoring weights saved');
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  const sumOk = Math.abs(sum - 1) <= 0.0001;

  return (
    <div style={{ maxWidth: 560 }}>
      <Title level={4} style={{ marginTop: 0, color: NAVY }}>
        Recommendation Weights
      </Title>
      <Paragraph type="secondary" style={{ marginBottom: 20 }}>
        These weights control how workers are ranked when suggesting an assignee.
        They must always sum to 1.0. Changes apply to the next suggestion request.
      </Paragraph>

      {!sumOk && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Weights currently sum to ${sum.toFixed(4)} — must equal 1.0 to save`}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        onValuesChange={(_, all) => recalcSum(all)}
        initialValues={{ skill: 0.4, availability: 0.3, workload: 0.2, efficiency: 0.1 }}
      >
        {(Object.keys(LABELS) as (keyof ScoringWeights)[]).map((key) => (
          <Form.Item
            key={key}
            name={key}
            label={LABELS[key].title}
            extra={LABELS[key].hint}
            rules={[{ required: true, message: 'Required' }]}
          >
            <InputNumber
              min={0}
              max={1}
              step={0.05}
              precision={4}
              style={{ width: '100%' }}
            />
          </Form.Item>
        ))}

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
          <Text>
            Sum:{' '}
            <Text strong style={{ color: sumOk ? '#389e0d' : '#cf1322' }}>
              {sum.toFixed(4)}
            </Text>
          </Text>
          <Button
            type="primary"
            loading={saving}
            onClick={onSave}
            disabled={!sumOk}
            style={{ background: NAVY, borderColor: NAVY }}
          >
            Save weights
          </Button>
        </div>
      </Form>
    </div>
  );
}
