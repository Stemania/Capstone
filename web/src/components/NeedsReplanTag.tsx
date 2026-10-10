import { Tooltip } from 'antd';
import StatusPill from './StatusPill';
import type { JobOrder } from '../types';

/** Shown while a change to a released job could not be scheduled automatically. */
export default function NeedsReplanTag({
  job,
  compact = true,
}: {
  job: Pick<JobOrder, 'needsReplan' | 'needsReplanReason'>;
  compact?: boolean;
}) {
  if (!job.needsReplan) return null;
  return (
    <Tooltip title={job.needsReplanReason || undefined}>
      <span style={{ display: 'inline-block' }}>
        <StatusPill color="red" compact={compact}>
          Needs re-plan
        </StatusPill>
      </span>
    </Tooltip>
  );
}
