import { useEffect, useState } from 'react';
import { DatePicker, Modal, message } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import { formatShop, shopToday } from '../../utils/shopTime';
import type { JobOrder } from '../../types';

type Props = {
  /** The job to mark delivered; null closes the box. */
  job: Pick<JobOrder, 'id' | 'jobNumber' | 'clientName' | 'dueDate' | 'forDeliveryAt'> | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
};

/** For Delivery → Delivered: the Admin confirms the date the client received it. */
export default function MarkDeliveredModal({ job, onClose, onDone }: Props) {
  const [on, setOn] = useState<Dayjs | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (job) setOn(shopToday());
  }, [job]);

  const readyDay = job?.forDeliveryAt ? dayjs(formatShop(job.forDeliveryAt, 'YYYY-MM-DD')) : null;
  const late = Boolean(on && job?.dueDate && on.isAfter(dayjs(job.dueDate), 'day'));

  const confirm = async () => {
    if (!job || !on) return;
    setSaving(true);
    try {
      await jobOrdersApi.markDelivered(job.id, on.format('YYYY-MM-DD'));
      message.success(`${job.jobNumber || 'Job'} delivered on ${on.format('MMM D, YYYY')}`);
      onClose();
      await onDone();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(job)}
      title="Mark as Delivered"
      okText="Mark as Delivered"
      confirmLoading={saving}
      okButtonProps={{ disabled: !on }}
      onOk={confirm}
      onCancel={onClose}
      destroyOnHidden
    >
      <p style={{ marginTop: 0, color: '#64748b' }}>
        Confirm that {job?.clientName || 'the client'} received {job?.jobNumber || 'this job'}. On-time is
        measured on this date
        {job?.dueDate ? ` against the date required, ${formatShop(job.dueDate, 'MMM D, YYYY')}` : ''}.
      </p>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Delivered on</div>
      <DatePicker
        style={{ width: '100%' }}
        format="MMM D, YYYY"
        allowClear={false}
        value={on}
        onChange={(d) => setOn(d)}
        disabledDate={(d) => d.isAfter(shopToday(), 'day') || Boolean(readyDay && d.isBefore(readyDay, 'day'))}
      />
      {late ? (
        <div style={{ marginTop: 8, fontSize: 12, color: '#b91c1c' }}>
          After the date required: this job counts as late.
        </div>
      ) : null}
    </Modal>
  );
}
