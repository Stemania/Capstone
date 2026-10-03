import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Modal, Spin, Table, message } from 'antd';
import { CheckOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import type { CalendarAffectedJob } from '../../api/calendar.api';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import type { JobOrder, MachineUnitInfo, ProposedOperation, ScheduleProposeResult } from '../../types';
import { SHOP_TZ, scheduleFlagStyle } from '../../utils/shopTime';
import ScheduleWeekView from '../job-orders/ScheduleWeekView';

function fmtWindow(start?: string | null, end?: string | null): string {
  if (!start || !end) return '—';
  const s = dayjs(start).tz(SHOP_TZ);
  const e = dayjs(end).tz(SHOP_TZ);
  const endFmt = s.isSame(e, 'day') ? e.format('HH:mm') : e.format('ddd MMM D, HH:mm');
  return `${s.format('ddd MMM D, HH:mm')} – ${endFmt}`;
}

type Props = {
  /** Heading context, e.g. "Overtime added on Sep 16, 2026". */
  changeLabel: string;
  jobs: CalendarAffectedJob[];
  onClose: () => void;
};

export default function RescheduleAffectedJobs({ changeLabel, jobs, onClose }: Props) {
  const [reproposeJob, setReproposeJob] = useState<CalendarAffectedJob | null>(null);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());

  return (
    <>
      <Modal
        open
        onCancel={onClose}
        title="Jobs that may be affected"
        width={720}
        centered
        footer={
          <Button onClick={onClose} style={{ minWidth: 96 }}>
            Done
          </Button>
        }
      >
        <p style={{ marginTop: 0, color: '#475569', fontSize: 13 }}>
          {changeLabel}. These scheduled jobs have operations on that date that have not started.
          Nothing has been moved. Re-propose a job to see its new schedule before confirming.
          Operations already in progress or completed never move.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {jobs.map((job) => {
            const done = confirmed.has(job.jobOrderId);
            return (
              <div
                key={job.jobOrderId}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: '10px 12px',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: '#0f1c2e' }}>
                    <Link to={`/job-orders/${job.jobOrderId}`} onClick={onClose}>
                      {job.jobNumber}
                    </Link>{' '}
                    <span style={{ fontWeight: 600 }}>{job.title}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>
                    {job.clientName || '—'}
                    {job.dueDate ? ` · Due ${dayjs(job.dueDate).format('MMM D, YYYY')}` : ''}
                  </div>
                  {job.operations.map((op) => (
                    <div key={op.id} style={{ fontSize: 12, color: '#334155' }}>
                      #{op.sequenceNo} {op.operationName} · {fmtWindow(op.scheduledStart, op.scheduledEnd)}
                    </div>
                  ))}
                </div>
                {done ? (
                  <span style={{ color: '#15803d', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>
                    <CheckOutlined /> Re-scheduled
                  </span>
                ) : (
                  <Button icon={<ReloadOutlined />} onClick={() => setReproposeJob(job)}>
                    Re-propose schedule
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Modal>
      {reproposeJob ? (
        <ReproposeModal
          jobId={reproposeJob.jobOrderId}
          onClose={() => setReproposeJob(null)}
          onConfirmed={() => {
            setConfirmed((prev) => new Set(prev).add(reproposeJob.jobOrderId));
            setReproposeJob(null);
          }}
        />
      ) : null}
    </>
  );
}

export function ReproposeModal({
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
  const unplaced = ops.filter((op) => !op.scheduled);
  const flag = proposal?.scheduleFlag ? scheduleFlagStyle[proposal.scheduleFlag] : null;

  const confirm = async () => {
    if (!proposal) return;
    setSaving(true);
    try {
      await jobOrdersApi.applySchedule(
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
          }))
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
      title={job ? `Re-propose schedule · ${job.jobNumber || ''} ${job.title}` : 'Re-propose schedule'}
      footer={[
        <Button key="cancel" onClick={onClose} style={{ minWidth: 96 }}>
          Cancel
        </Button>,
        <Button
          key="confirm"
          type="primary"
          loading={saving}
          disabled={loading || !!error || !ops.length || unplaced.length > 0}
          onClick={confirm}
          style={{ fontWeight: 700, minWidth: 140 }}
        >
          Confirm schedule
        </Button>,
      ]}
    >
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : error ? (
        <Alert type="error" showIcon message={error} />
      ) : (
        <>
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
                <strong>{dayjs(job.dueDate).format('MMM D, YYYY')}</strong>
              </span>
            ) : null}
            {flag ? (
              <span
                style={{
                  color: flag.color,
                  background: flag.bg,
                  border: `1px solid ${flag.border}`,
                  borderRadius: 999,
                  padding: '0 10px',
                  fontWeight: 600,
                }}
              >
                {flag.label}
              </span>
            ) : null}
          </div>
          {unplaced.length > 0 ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 10 }}
              message="Some operations could not be placed, so this schedule can't be confirmed."
              description={unplaced.map((op) => `#${op.sequenceNo} ${op.operationName}: ${op.message}`).join(' · ')}
            />
          ) : null}
          <Table
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
