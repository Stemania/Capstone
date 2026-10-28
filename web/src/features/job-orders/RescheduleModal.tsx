import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select, Spin, message } from 'antd';
import dayjs from 'dayjs';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import type { JobOrder, MachineUnitInfo, ProposedOperation, ScheduleProposeResult } from '../../types';
import { SHOP_TZ, scheduleFlagStyle, formatShop } from '../../utils/shopTime';
import ScheduleWeekView from './ScheduleWeekView';
import ResponsiveTable from '../../components/ui/ResponsiveTable';

function fmtWindow(start?: string | null, end?: string | null): string {
  if (!start || !end) return '—';
  const s = dayjs(start).tz(SHOP_TZ);
  const e = dayjs(end).tz(SHOP_TZ);
  const endFmt = s.isSame(e, 'day') ? e.format('HH:mm') : e.format('ddd MMM D, HH:mm');
  return `${s.format('ddd MMM D, HH:mm')} – ${endFmt}`;
}

export const RESCHEDULE_REASON_OPTIONS = [
  { value: 'WORKER_ABSENT', label: 'Worker absent' },
  { value: 'MACHINE_BREAKDOWN', label: 'Machine breakdown' },
  { value: 'MATERIAL_DELAY', label: 'Material delay' },
  { value: 'WORK_CALENDAR_CHANGE', label: 'Work calendar change' },
  { value: 'OTHER', label: 'Other' },
] as const;

export type RescheduleReason = (typeof RESCHEDULE_REASON_OPTIONS)[number]['value'];

export function rescheduleReasonLabel(code: string | null | undefined): string {
  const hit = RESCHEDULE_REASON_OPTIONS.find((o) => o.value === code);
  return hit?.label || code || '—';
}

/** Admin Reschedule on a released job: propose/apply with a required reason. */
export default function RescheduleModal({
  jobId,
  onClose,
  onConfirmed,
}: {
  jobId: string;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [job, setJob] = useState<JobOrder | null>(null);
  const [proposal, setProposal] = useState<ScheduleProposeResult | null>(null);
  const [units, setUnits] = useState<MachineUnitInfo[]>([]);
  const [reason, setReason] = useState<RescheduleReason | undefined>();
  const [note, setNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [jobRes, proposeRes, unitsRes] = await Promise.all([
          jobOrdersApi.get(jobId),
          jobOrdersApi.proposeSchedule(jobId),
          jobOrdersApi.machineUnits(),
        ]);
        if (cancelled) return;
        setJob(jobRes.data);
        setProposal(proposeRes.data);
        setUnits(unitsRes.data);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const currentById = useMemo(() => {
    const map = new Map<string, { start?: string | null; end?: string | null; status?: string }>();
    for (const op of job?.operations || []) {
      map.set(op.id, { start: op.scheduledStart, end: op.scheduledEnd, status: op.status });
    }
    return map;
  }, [job]);

  const ops = proposal?.operations || [];
  const problems = proposal?.problems || [];
  const flag = proposal?.scheduleFlag ? scheduleFlagStyle[proposal.scheduleFlag] : null;
  const noteRequired = reason === 'OTHER';
  const canConfirm =
    !!reason && (!noteRequired || !!note.trim()) && !loading && !error && !!ops.length && problems.length === 0;

  const confirm = async () => {
    if (!proposal || !reason) return;
    setSaving(true);
    try {
      await jobOrdersApi.reschedule(
        jobId,
        ops
          .filter((op): op is ProposedOperation & { id: string; scheduledStart: string; scheduledEnd: string } =>
            Boolean(op.id && op.scheduledStart && op.scheduledEnd)
          )
          .map((op) => ({
            id: op.id,
            scheduledStart: op.scheduledStart,
            scheduledEnd: op.scheduledEnd,
            machineUnitId: op.machineUnitId ?? null,
            assignedWorkerId: op.assignedWorkerId ?? null,
          })),
        reason,
        note.trim() || undefined
      );
      message.success('Schedule updated');
      onConfirmed();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onCancel={onClose}
      width={1100}
      centered
      title={job ? `Reschedule · ${job.jobNumber || ''} ${job.title}` : 'Reschedule'}
      footer={[
        <Button key="cancel" onClick={onClose} style={{ minWidth: 96 }}>
          Cancel
        </Button>,
        <Button
          key="confirm"
          type="primary"
          loading={saving}
          disabled={!canConfirm}
          onClick={confirm}
          style={{ fontWeight: 700, minWidth: 140 }}
        >
          Confirm reschedule
        </Button>,
      ]}
    >
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : error ? (
        <Alert type="error" showIcon title={error} />
      ) : (
        <>
          <Form layout="vertical" style={{ marginBottom: 12 }}>
            <Form.Item label="Reason" required style={{ marginBottom: 8 }}>
              <Select
                placeholder="Why is this being rescheduled?"
                options={RESCHEDULE_REASON_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={reason}
                onChange={(v) => setReason(v)}
                style={{ maxWidth: 360 }}
              />
            </Form.Item>
            <Form.Item
              label={noteRequired ? 'Note (required)' : 'Note (optional)'}
              required={noteRequired}
              style={{ marginBottom: 0 }}
            >
              <Input.TextArea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={noteRequired ? 'Describe the Other reason' : 'Optional detail'}
                maxLength={500}
              />
            </Form.Item>
          </Form>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10, fontSize: 13 }}>
            <span>
              <span style={{ color: '#64748b' }}>Projected completion </span>
              <strong>
                {proposal?.projectedCompletion
                  ? dayjs(proposal.projectedCompletion).tz(SHOP_TZ).format('ddd MMM D, HH:mm')
                  : '—'}
              </strong>
            </span>
            {job?.dueDate ? (
              <span>
                <span style={{ color: '#64748b' }}>Due </span>
                <strong>{formatShop(job.dueDate, 'MMM D, YYYY')}</strong>
              </span>
            ) : null}
            {flag ? (
              <span
                style={{
                  color: flag.color,
                  background: flag.bg,
                  border: '1px solid transparent',
                  borderRadius: 999,
                  padding: '0 10px',
                  fontWeight: 600,
                }}
              >
                {flag.label}
              </span>
            ) : null}
          </div>
          {problems.length > 0 ? (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 10 }}
              title="This schedule can't be confirmed yet"
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {problems.map((p, i) => (
                    <li key={i}>{p.message}</li>
                  ))}
                </ul>
              }
            />
          ) : null}
          <ResponsiveTable
            size="small"
            pagination={false}
            rowKey={(op) => op.id || String(op.sequenceNo)}
            dataSource={ops}
            style={{ marginBottom: 12 }}
            columns={[
              {
                title: 'Operation',
                key: 'op',
                render: (_: unknown, op: ProposedOperation) => `#${op.sequenceNo} ${op.operationName || ''}`,
              },
              {
                title: 'Current',
                key: 'current',
                render: (_: unknown, op: ProposedOperation) => {
                  const cur = op.id ? currentById.get(op.id) : undefined;
                  return fmtWindow(cur?.start, cur?.end);
                },
              },
              {
                title: 'Proposed',
                key: 'proposed',
                render: (_: unknown, op: ProposedOperation) =>
                  op.scheduled ? fmtWindow(op.scheduledStart, op.scheduledEnd) : '—',
              },
              {
                title: 'Note',
                key: 'note',
                render: (_: unknown, op: ProposedOperation) => {
                  const cur = op.id ? currentById.get(op.id) : undefined;
                  if (cur?.status === 'COMPLETED') return 'Completed — not moved';
                  const own = problems.filter((p) => p.sequenceNo === op.sequenceNo);
                  if (own.length > 0) {
                    return (
                      <span style={{ color: '#b91c1c' }}>{own.map((p) => p.message).join(' · ')}</span>
                    );
                  }
                  return op.message || '';
                },
              },
            ]}
          />
          {job ? (
            <ScheduleWeekView
              jobId={jobId}
              jobNumber={job.jobNumber}
              jobTitle={job.title}
              operations={ops}
              machineUnits={units}
              scheduleColor={job.scheduleColor}
            />
          ) : null}
        </>
      )}
    </Modal>
  );
}
