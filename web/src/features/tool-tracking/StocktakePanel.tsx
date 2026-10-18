import { formatShop } from '../../utils/shopTime';
import { useCallback, useEffect, useState } from 'react';
import { Button, Form, Input, InputNumber, Select, Space, Typography, message } from 'antd';
import { toolsApi } from '../../api/tools.api';
import { getErrorMessage } from '../../api/client';
import InfoTip from '../../components/InfoTip';
import type { Tool, ToolEvent } from '../../types';
import ResponsiveTable from '../../components/ui/ResponsiveTable';

type Props = {
  onSaved?: () => void;
  /** When true, omit the page-level heading (e.g. inside a drawer). */
  hideTitle?: boolean;
  /** Show movement log without the correction form. */
  readOnly?: boolean;
};

const MOVEMENT_LABEL: Record<string, string> = {
  RECEIVE: 'Receive',
  SCAN: 'Scan (−1)',
  UNDO: 'Undo scan',
  CORRECTION: 'Correction',
  ADJUST: 'Adjust',
};

function formatDelta(delta: number | null | undefined, unit?: string | null) {
  if (delta == null) return '—';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta}${unit ? ` ${unit}` : ''}`;
}

export default function StocktakePanel({ onSaved, hideTitle, readOnly }: Props) {
  const [tools, setTools] = useState<Tool[]>([]);
  const [toolId, setToolId] = useState<string | undefined>();
  const [movements, setMovements] = useState<ToolEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ actualCount: number; reason: string }>();

  const selected = tools.find((t) => t.id === toolId) || null;

  const loadTools = useCallback(async () => {
    try {
      const { data } = await toolsApi.list({ category: 'CONSUMABLE' });
      setTools(data);
      setToolId((prev) => prev || data[0]?.id);
    } catch (err) {
      message.error(getErrorMessage(err));
    }
  }, []);

  const loadMovements = useCallback(async (id?: string) => {
    setLoading(true);
    try {
      const { data } = await toolsApi.listMovements({
        toolId: id,
        page: 1,
        perPage: 40,
      });
      setMovements(data.items);
    } catch (err) {
      message.error(getErrorMessage(err));
      setMovements([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTools();
  }, [loadTools]);

  useEffect(() => {
    void loadMovements(toolId);
  }, [toolId, loadMovements]);

  useEffect(() => {
    if (selected) {
      form.setFieldsValue({ actualCount: selected.quantityOnHand, reason: undefined });
    }
  }, [selected, form]);

  const submit = async (values: { actualCount: number; reason: string }) => {
    if (!selected) return;
    setSaving(true);
    try {
      await toolsApi.correct(selected.id, {
        actualCount: values.actualCount,
        reason: values.reason.trim(),
      });
      message.success('Stock corrected');
      form.setFieldsValue({ reason: undefined });
      await loadTools();
      await loadMovements(selected.id);
      onSaved?.();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const tip = (
    <InfoTip
      title="Stock correction"
      label="About correction"
      content="Workers deduct consumables by scanning. Use correction only when the shelf count does not match the system (missed scans, damage, etc.). Always enter a reason. Log deliveries with Receive delivery."
    />
  );

  return (
    <div>
      {!hideTitle && (
        <Typography.Title
          level={5}
          style={{
            color: '#0f1c2e',
            marginTop: 28,
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          Stock correction
          {tip}
        </Typography.Title>
      )}

      <Space wrap style={{ marginBottom: 16 }} align="center">
        {hideTitle && tip}
        <span style={{ fontSize: 13, color: '#64748b' }}>Item</span>
        <Select
          showSearch
          optionFilterProp="label"
          style={{ minWidth: 260 }}
          placeholder="Select consumable"
          value={toolId}
          onChange={(v) => setToolId(v)}
          options={tools.map((t) => ({
            value: t.id,
            label: `${t.name}${t.sizeSpec ? ` · ${t.sizeSpec}` : ''} (${t.code})`,
          }))}
        />
        {selected ? (
          <span style={{ fontSize: 13, color: '#64748b' }}>
            On hand: <b style={{ color: '#0f172a' }}>{selected.quantityOnHand} {selected.unit}</b>
          </span>
        ) : null}
      </Space>

      {!readOnly && selected ? (
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => void submit(v)}
          style={{ maxWidth: 420, marginBottom: 24 }}
        >
          <Form.Item
            name="actualCount"
            label="Actual count on shelf"
            rules={[{ required: true, message: 'Enter the counted quantity' }]}
            style={{ marginBottom: 12 }}
          >
            <InputNumber min={0} step={1} style={{ width: '100%' }} addonAfter={selected.unit} />
          </Form.Item>
          <Form.Item
            name="reason"
            label="Reason"
            rules={[{ required: true, whitespace: true, message: 'Reason is required' }]}
            style={{ marginBottom: 12 }}
          >
            <Input.TextArea rows={2} placeholder="e.g. Missed scans, damaged stock, recount" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving} disabled={!tools.length}>
            Save correction
          </Button>
        </Form>
      ) : null}

      <Typography.Title level={5} style={{ marginTop: readOnly ? 0 : 8, color: '#0f1c2e' }}>
        Movement log
      </Typography.Title>
      <ResponsiveTable
        className="std-list-table"
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={movements}
        pagination={false}
        locale={{
          emptyText: toolId
            ? 'No movements for this item yet. Scans, receives, and corrections appear here.'
            : 'Select a consumable to see its movement log.',
        }}
        columns={[
          {
            title: 'When',
            dataIndex: 'createdAt',
            width: 140,
            render: (d: string) => (d ? formatShop(d, 'MMM D, h:mm A') : '—'),
          },
          {
            title: 'Type',
            dataIndex: 'type',
            width: 110,
            render: (t: string) => MOVEMENT_LABEL[t] || t,
          },
          {
            title: 'Change',
            key: 'delta',
            align: 'right',
            width: 100,
            render: (_: unknown, r: ToolEvent) => formatDelta(r.stockDelta, r.toolUnit),
          },
          {
            title: 'On hand after',
            dataIndex: 'quantityOnHandAfter',
            align: 'right',
            width: 110,
            render: (v: number | null | undefined, r: ToolEvent) =>
              v == null ? '—' : `${v}${r.toolUnit ? ` ${r.toolUnit}` : ''}`,
          },
          {
            title: 'By',
            dataIndex: 'workerName',
            render: (n: string | undefined) => n || '—',
          },
          {
            title: 'Note',
            dataIndex: 'reason',
            render: (n: string | null | undefined, r: ToolEvent) =>
              n || r.supplier || '—',
          },
        ]}
      />
    </div>
  );
}
