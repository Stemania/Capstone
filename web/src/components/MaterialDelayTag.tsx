import { Tooltip } from 'antd';
import StatusPill from './StatusPill';
import type { DelayKind, JobOrder } from '../types';

export const DELAY_LABEL: Record<DelayKind, string> = {
  MATERIAL: 'Delayed by materials',
  RESCHEDULED: 'Rescheduled',
};

/** Shown while a job moved later automatically has not started yet. */
export default function MaterialDelayTag({
  job,
  compact = true,
}: {
  job: Pick<JobOrder, 'status' | 'materialDelay'>;
  compact?: boolean;
}) {
  if (!job.materialDelay || job.status !== 'SCHEDULED') return null;
  const kind = job.materialDelay.kind;
  return (
    <Tooltip title={job.materialDelay.reason || undefined}>
      <span style={{ display: 'inline-block' }}>
        <StatusPill color={kind === 'MATERIAL' ? 'red' : 'amber'} compact={compact}>
          {DELAY_LABEL[kind]}
        </StatusPill>
      </span>
    </Tooltip>
  );
}
