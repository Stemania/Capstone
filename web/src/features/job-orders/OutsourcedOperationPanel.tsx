import { useState } from 'react';
import { Button, DatePicker, Form, Input, Modal, Space, Tag, message } from 'antd';
import type { Dayjs } from 'dayjs';
import { operationsApi } from '../../api/operations.api';
import { getErrorMessage } from '../../api/client';
import { formatShop, shopToday } from '../../utils/shopTime';
import type { Operation } from '../../types';

const MUTED = '#64748b';

type Mode = 'send' | 'return' | null;

/** Outsourced work: where it went, when it is due back, and the office's
 * Sent out / Returned records. No worker, machine or time log. */
export default function OutsourcedOperationPanel({
  op,
  canRecord,
  waitingOnEarlier,
  onChanged,
}: {
  op: Operation;
  canRecord: boolean;
  waitingOnEarlier: boolean;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ date: Dayjs; sentTo?: string }>();

  const today = shopToday().format('YYYY-MM-DD');
  const out = Boolean(op.sentOutDate) && op.status !== 'COMPLETED';
  const late = out && !!op.expectedReturnDate && op.expectedReturnDate < today;
  const returnedLate =
    op.status === 'COMPLETED' &&
    !!op.returnedDate &&
    !!op.expectedReturnDate &&
    op.returnedDate > op.expectedReturnDate;

  const open = (next: Mode) => {
    form.setFieldsValue({ date: shopToday(), sentTo: op.sentTo || undefined });
    setMode(next);
  };

  const save = async () => {
    const values = await form.validateFields();
    const day = values.date.format('YYYY-MM-DD');
    setSaving(true);
    try {
      if (mode === 'send') {
        await operationsApi.sendOut(op.id, day, (values.sentTo || '').trim());
        message.success('Recorded as sent out');
      } else {
        await operationsApi.markReturned(op.id, day);
        message.success('Recorded as returned');
      }
      setMode(null);
      onChanged();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const day = (v?: string | null) => formatShop(v, 'MMM D, YYYY');

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: '8px 16px',
          fontSize: 12,
          color: MUTED,
          marginBottom: 10,
        }}
      >
        <span>
          <strong style={{ color: '#475569' }}>Done:</strong> outside the shop
        </span>
        <span>
          <strong style={{ color: '#475569' }}>Turnaround:</strong>{' '}
          {op.turnaroundDays ? `${op.turnaroundDays} day${op.turnaroundDays === 1 ? '' : 's'}` : '—'}
        </span>
        <span>
          <strong style={{ color: '#475569' }}>Sent to:</strong> {op.sentTo || '—'}
        </span>
        <span>
          <strong style={{ color: '#475569' }}>Sent out:</strong> {day(op.sentOutDate)}
        </span>
        <span>
          <strong style={{ color: '#475569' }}>Expected back:</strong>{' '}
          {op.expectedReturnDate
            ? day(op.expectedReturnDate)
            : op.scheduledEnd
              ? `${formatShop(op.scheduledEnd, 'MMM D, YYYY')} (planned)`
              : '—'}{' '}
          {late ? <Tag color="red">Late</Tag> : null}
        </span>
        <span>
          <strong style={{ color: '#475569' }}>Returned:</strong> {day(op.returnedDate)}{' '}
          {returnedLate ? <Tag color="orange">Back late</Tag> : null}
        </span>
      </div>

      {canRecord && op.status !== 'COMPLETED' ? (
        <Space wrap style={{ marginBottom: 6 }}>
          {!op.sentOutDate ? (
            <Button
              size="small"
              type="primary"
              disabled={waitingOnEarlier}
              title={waitingOnEarlier ? 'Finish the earlier operations first' : undefined}
              onClick={() => open('send')}
            >
              Sent out
            </Button>
          ) : (
            <Button size="small" type="primary" onClick={() => open('return')}>
              Returned
            </Button>
          )}
          {!op.sentOutDate && waitingOnEarlier ? (
            <span style={{ fontSize: 12, color: MUTED }}>Waiting on earlier operations</span>
          ) : null}
        </Space>
      ) : null}

      <Modal
        open={mode !== null}
        title={mode === 'send' ? `Sent out: ${op.operationName}` : `Returned: ${op.operationName}`}
        okText="Save"
        confirmLoading={saving}
        onOk={save}
        onCancel={() => setMode(null)}
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="date"
            label={mode === 'send' ? 'Date sent out' : 'Date returned'}
            rules={[{ required: true, message: 'Pick a date' }]}
          >
            <DatePicker
              style={{ width: '100%' }}
              format="MMM D, YYYY"
              disabledDate={(d) => {
                const v = d.format('YYYY-MM-DD');
                if (v > today) return true;
                return mode === 'return' && !!op.sentOutDate && v < op.sentOutDate;
              }}
            />
          </Form.Item>
          {mode === 'send' ? (
            <Form.Item
              name="sentTo"
              label="Sent to"
              rules={[{ required: true, whitespace: true, message: 'Say where it was sent' }]}
            >
              <Input maxLength={255} placeholder="e.g. heat treatment shop name" />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </>
  );
}
