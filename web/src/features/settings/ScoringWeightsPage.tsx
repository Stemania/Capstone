import { useEffect, useState } from 'react';
import { Alert, Button, Form, InputNumber, Spin, Typography, message } from 'antd';
import { workersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import type { ScoringWeights } from '../../types';

const { Title, Text, Paragraph } = Typography;

const NAVY = '#0f1c2e';

const LABELS: Record<keyof ScoringWeights, { title: string; hint: string }> = {
  skill: {
    title: 'Skill level fit',
    hint: 'How well the worker’s skill level matches the machine for this operation',
  },
  availability: {
    title: 'Availability',
    hint: 'Whether the worker is free in the needed time window without schedule clashes',
  },
  workload: {
    title: 'How busy they already are',
    hint: 'How many target hours the worker already has this week',
  },
  efficiency: {
    title: 'Past performance',
    hint: 'How close their finished operations usually land to target hours',
  },
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
        message.error(`The four factors must add up to 1.0 (currently ${total.toFixed(4)})`);
        return;
      }
      setSaving(true);
      const { data } = await workersApi.updateScoringWeights(values);
      form.setFieldsValue(data.weights);
      recalcSum(data.weights);
      message.success('Worker ranking saved');
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
        Worker ranking
      </Title>
      <Paragraph type="secondary" style={{ marginBottom: 20 }}>
        When the shop suggests who should take an operation, these four factors decide the order of the
        shortlist. Raise a factor to put more weight on it; lower it to care less. The four numbers
        must always add up to 1.0. Changes apply the next time you ask for a suggestion.
      </Paragraph>

      {!sumOk && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Factors currently add up to ${sum.toFixed(4)} — they must equal 1.0 before you can save`}
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
            Total:{' '}
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
            Save ranking
          </Button>
        </div>
      </Form>
    </div>
  );
}
