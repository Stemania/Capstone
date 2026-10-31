import { useState } from 'react';
import { Form, Input, Select, message } from 'antd';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import type { JobOrder } from '../../types';
import { FormModal } from '../../components/ui';
import { StopOutlined } from '@ant-design/icons';

export const CANCEL_REASON_OPTIONS = [
  { value: 'CLIENT_CANCELLED', label: 'Client cancelled' },
  { value: 'DUPLICATE_OR_ENCODING_ERROR', label: 'Duplicate or encoding error' },
  { value: 'OTHER', label: 'Other' },
] as const;

export type CancelReason = (typeof CANCEL_REASON_OPTIONS)[number]['value'];

export function cancelReasonLabel(code: string | null | undefined): string {
  return CANCEL_REASON_OPTIONS.find((o) => o.value === code)?.label || code || '—';
}

type Props = {
  job: JobOrder;
  open: boolean;
  onClose: () => void;
  onCancelled: (job: JobOrder) => void;
};

export default function CancelJobModal({ job, open, onClose, onCancelled }: Props) {
  const [reason, setReason] = useState<CancelReason | undefined>();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const noteRequired = reason === 'OTHER';
  const canSubmit = !!reason && (!noteRequired || !!note.trim());

  const submit = async () => {
    if (!reason) return;
    setSaving(true);
    try {
      const { data } = await jobOrdersApi.cancel(job.id, {
        reason,
        note: note.trim() || undefined,
      });
      message.success('Job order cancelled');
      onCancelled(data);
      onClose();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      open={open}
      icon={<StopOutlined />}
      title="Cancel job order"
      subtitle={[job.jobNumber, job.title].filter(Boolean).join(' · ')}
      onCancel={onClose}
      cancelText="Keep job"
      okText="Cancel job order"
      okButtonProps={{ danger: true, disabled: !canSubmit, loading: saving }}
      onOk={submit}
      destroyOnHidden
    >
      <p style={{ marginBottom: 12, color: '#64748b' }}>
        Unstarted work leaves the schedule. The client is not notified.
      </p>
      <Form layout="vertical">
        <Form.Item label="Reason" required>
          <Select
            placeholder="Why is this job being cancelled?"
            options={CANCEL_REASON_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={reason}
            onChange={(v) => setReason(v)}
          />
        </Form.Item>
        <Form.Item label={noteRequired ? 'Note (required)' : 'Note (optional)'} required={noteRequired}>
          <Input.TextArea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={noteRequired ? 'Describe the Other reason' : 'Optional detail'}
            maxLength={500}
          />
        </Form.Item>
      </Form>
    </FormModal>
  );
}
