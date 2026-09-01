import { CheckOutlined } from '@ant-design/icons';

export const JOB_FLOW_STEPS = [
  { id: 1, label: 'Job information' },
  { id: 2, label: 'Operations' },
  { id: 3, label: 'Schedule' },
  { id: 4, label: 'Released' },
] as const;

export type JobFlowStepId = (typeof JOB_FLOW_STEPS)[number]['id'];

type Props = {
  current: JobFlowStepId;
  /** Highest step unlocked from job status / progress. */
  reached?: JobFlowStepId;
  /** Highest step the viewer may open (Office Staff = 1). */
  maxInteractive?: JobFlowStepId;
  onStepClick?: (step: JobFlowStepId) => void;
};

export function resolveJobFlowStep(job: {
  status: string;
  operations?: {
    operationTypeId?: string | null;
    operationName?: string | null;
    scheduledStart?: string | null;
    scheduledEnd?: string | null;
  }[] | null;
}): JobFlowStepId {
  const status = job.status;
  if (status === 'DRAFT') {
    const ops = (job.operations || []).filter(
      (op) => Boolean(op.operationTypeId) || Boolean(op.operationName?.trim())
    );
    if (!ops.length) return 1;
    const allScheduled = ops.every((op) => op.scheduledStart && op.scheduledEnd);
    return allScheduled ? 3 : 2;
  }
  return 4;
}

export default function JobOrderFlowSteps({
  current,
  reached,
  maxInteractive = 4,
  onStepClick,
}: Props) {
  const unlocked = reached ?? current;

  return (
    <nav className="jo-flow-steps" aria-label="Job order progress">
      <ol className="jo-flow-steps__list">
        {JOB_FLOW_STEPS.map((step, index) => {
          const done =
            step.id < current || (step.id !== current && step.id <= unlocked && step.id > current);
          const active = step.id === current;
          const locked = step.id > maxInteractive;
          const upcoming = !done && !active;
          const clickable =
            !locked && done && typeof onStepClick === 'function' && step.id !== current;

          return (
            <li
              key={step.id}
              className={[
                'jo-flow-steps__item',
                done ? 'is-done' : '',
                active ? 'is-active' : '',
                locked ? 'is-locked' : '',
                upcoming ? 'is-upcoming' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {index > 0 && <span className="jo-flow-steps__connector" aria-hidden />}
              <button
                type="button"
                className="jo-flow-steps__node"
                disabled={!clickable}
                aria-current={active ? 'step' : undefined}
                aria-disabled={locked || !clickable}
                onClick={() => {
                  if (clickable) onStepClick?.(step.id);
                }}
              >
                <span className="jo-flow-steps__circle">
                  {done ? <CheckOutlined /> : step.id}
                </span>
                <span className="jo-flow-steps__label">{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
