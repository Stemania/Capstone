import { useEffect, useState } from 'react';
import { Alert, Button, Form, InputNumber, Spin, Typography, message } from 'antd';
import { workersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import type { ScoringWeights } from '../../types';

const { Title, Text } = Typography;

const NAVY = '#0f1c2e';

const LABELS: Record<keyof ScoringWeights, { title: string; hint: string }> = {
  skill: {
    title: 'Skill level fit',
    hint: 'How well their skill matches the machine for this operation',
  },
  availability: {
    title: 'Availability',
    hint: 'Free in the needed window, no schedule clashes',
  },
  workload: {
    title: 'How busy they already are',
    hint: 'Target hours they already have this week',
  },
  efficiency: {
    title: 'Past performance',
    hint: 'How close finished work usually lands to target hours',
  },
};

const FACTORS = Object.keys(LABELS) as (keyof ScoringWeights)[];

export default function ScoringWeightsPage({
  embedded = false,
}: {
  embedded?: boolean;
}) {
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
      <div style={{ padding: 32, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  const sumOk = Math.abs(sum - 1) <= 0.0001;

  return (
    <div className="worker-ranking">
      {!embedded && (
        <Title level={4} style={{ marginTop: 0, color: NAVY }}>
          Worker ranking
        </Title>
      )}
      <p className="worker-ranking__intro">
        These four numbers decide the shortlist when suggesting a worker. They must add up to 1.0.
      </p>

      {!sumOk && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`Factors add up to ${sum.toFixed(4)} — they must equal 1.0 to save`}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onValuesChange={(_, all) => recalcSum(all)}
        initialValues={{ skill: 0.4, availability: 0.3, workload: 0.2, efficiency: 0.1 }}
      >
        <div className="worker-ranking__grid">
          {FACTORS.map((key) => (
            <div className="worker-ranking__card" key={key}>
              <div className="worker-ranking__label">{LABELS[key].title}</div>
              <Form.Item name={key} rules={[{ required: true, message: 'Required' }]} style={{ marginBottom: 8 }}>
                <InputNumber min={0} max={1} step={0.05} precision={4} />
              </Form.Item>
              <div className="worker-ranking__hint">{LABELS[key].hint}</div>
            </div>
          ))}
        </div>

        <div className="worker-ranking__footer">
          <Text>
            Total{' '}
            <Text strong style={{ color: sumOk ? '#16a34a' : '#dc2626' }}>
              {sum.toFixed(4)}
            </Text>
            <Text type="secondary"> / 1.0000</Text>
          </Text>
          <Button
            type="primary"
            loading={saving}
            onClick={onSave}
            disabled={!sumOk}
            style={{ background: NAVY, borderColor: NAVY, fontWeight: 700 }}
          >
            Save ranking
          </Button>
        </div>
      </Form>
    </div>
  );
}
