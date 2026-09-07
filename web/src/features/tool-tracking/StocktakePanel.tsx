import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  DatePicker,
  Input,
  InputNumber,
  Space,
  Table,
  Typography,
  message,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { inventoryApi } from '../../api/tools.api';
import { getErrorMessage } from '../../api/client';
import InfoTip from '../../components/InfoTip';
import type { StocktakeFormItem, StocktakeSummary } from '../../types';

type Props = {
  onSaved?: () => void;
  /** When true, omit the page-level Stocktake heading (e.g. inside a drawer). */
  hideTitle?: boolean;
};

export default function StocktakePanel({ onSaved, hideTitle }: Props) {
  const [formItems, setFormItems] = useState<StocktakeFormItem[]>([]);
  const [previousOn, setPreviousOn] = useState<string | null>(null);
  const [previousBy, setPreviousBy] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [countedOn, setCountedOn] = useState<Dayjs>(dayjs());
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<StocktakeSummary[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [form, hist] = await Promise.all([
        inventoryApi.stocktakeForm(),
        inventoryApi.listStocktakes({ page: 1, perPage: 8 }),
      ]);
      setFormItems(form.data.items);
      setPreviousOn(form.data.previousStocktakeOn);
      setPreviousBy(form.data.previousCountedByName);
      const next: Record<string, number | null> = {};
      for (const item of form.data.items) {
        next[item.toolId] = item.quantityOnHand ?? 0;
      }
      setCounts(next);
      setHistory(hist.data.items);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const incomplete = useMemo(
    () => formItems.some((i) => counts[i.toolId] == null || Number.isNaN(Number(counts[i.toolId]))),
    [formItems, counts]
  );

  const submit = async () => {
    if (!formItems.length) {
      message.warning('Add consumable items to the catalog before counting');
      return;
    }
    if (incomplete) {
      message.warning('Enter a counted quantity for every consumable');
      return;
    }
    setSubmitting(true);
    try {
      await inventoryApi.submitStocktake({
        countedOn: countedOn.format('YYYY-MM-DD'),
        notes: notes.trim() || undefined,
        lines: formItems.map((i) => ({
          toolId: i.toolId,
          countedQuantity: Number(counts[i.toolId]),
        })),
      });
      message.success('Stocktake saved — on-hand quantities updated');
      setNotes('');
      await load();
      onSaved?.();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const tip = (
    <InfoTip
      title="Periodic shelf count"
      label="About stocktake"
      content={
        previousOn
          ? `Last count: ${dayjs(previousOn).format('MMM D, YYYY')}${
              previousBy ? ` by ${previousBy}` : ''
            }. Enter what is on the shelf now. Log deliveries as a positive Adjust stock so they are not treated as consumption.`
          : 'No stocktake yet. Count the shelf to start tracking consumable consumption between counts.'
      }
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
          Stocktake
          {tip}
        </Typography.Title>
      )}

      <Space wrap style={{ marginBottom: 16 }} align="center">
        {hideTitle && tip}
        <span style={{ fontSize: 13, color: '#64748b' }}>Count date</span>
        <DatePicker
          value={countedOn}
          allowClear={false}
          onChange={(d) => d && setCountedOn(d)}
          disabledDate={(d) => d.isAfter(dayjs(), 'day')}
        />
        <Input
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ width: 240 }}
        />
        <Button
          type="primary"
          loading={submitting}
          disabled={loading || !formItems.length}
          onClick={() => void submit()}
        >
          Submit stocktake
        </Button>
      </Space>

      <Table
        className="std-list-table"
        size="small"
        rowKey="toolId"
        loading={loading}
        dataSource={formItems}
        pagination={false}
        locale={{
          emptyText:
            'No consumables in the catalog yet. Add items first, then count the shelf here.',
        }}
        columns={[
          {
            title: 'Item',
            render: (_: unknown, r: StocktakeFormItem) => (
              <div>
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  {[r.sizeSpec, r.code].filter(Boolean).join(' · ')}
                </div>
              </div>
            ),
          },
          {
            title: 'System qty',
            dataIndex: 'quantityOnHand',
            align: 'right',
            render: (v: number, r) => `${v ?? 0} ${r.unit}`,
          },
          {
            title: 'Last count',
            render: (_: unknown, r: StocktakeFormItem) =>
              r.lastCountedOn
                ? `${dayjs(r.lastCountedOn).format('MMM D')} · ${r.lastCountedQuantity ?? '—'} ${r.unit}`
                : 'Never counted',
          },
          {
            title: 'Counted now',
            align: 'right',
            render: (_: unknown, r: StocktakeFormItem) => (
              <InputNumber
                min={0}
                step={1}
                value={counts[r.toolId] ?? 0}
                onChange={(v) =>
                  setCounts((prev) => ({ ...prev, [r.toolId]: v == null ? null : Number(v) }))
                }
                addonAfter={r.unit}
                style={{ width: 140 }}
              />
            ),
          },
        ]}
      />

      {history.length > 0 ? (
        <>
          <Typography.Title level={5} style={{ marginTop: 28, color: '#0f1c2e' }}>
            Recent stocktakes
          </Typography.Title>
          <Table
            className="std-list-table"
            size="small"
            rowKey="id"
            dataSource={history}
            pagination={false}
            columns={[
              {
                title: 'Date',
                dataIndex: 'countedOn',
                render: (d: string) => dayjs(d).format('MMM D, YYYY'),
              },
              { title: 'Counted by', dataIndex: 'countedByName' },
              { title: 'Lines', dataIndex: 'lineCount', align: 'right' },
              {
                title: 'Notes',
                dataIndex: 'notes',
                render: (n: string | null) => n || '—',
              },
            ]}
          />
        </>
      ) : (
        !loading && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
            No stocktake history yet. After the first count, dates and who counted appear here.
          </Typography.Paragraph>
        )
      )}
    </div>
  );
}
