import { CheckOutlined } from '@ant-design/icons';

/** Planning stages. Job information is entered by Office Staff beforehand and is not a stage here. */
export const JOB_FLOW_STEPS = [
  { id: 2, label: 'Operations' },
  { id: 3, label: 'Schedule' },
  { id: 4, label: 'Released' },
] as const;

/** 1 = no operations yet (planning opens on Operations). */
export type JobFlowStepId = 1 | 2 | 3 | 4;

type Props = {
  current: JobFlowStepId;
  /** Return to an earlier stage; only offered for completed stages before current. */
  onStepClick?: (step: JobFlowStepId) => void;
  /** No going back once released. */
  locked?: boolean;
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

/** Compact three-stage indicator for the planning header. */
export default function JobOrderFlowSteps({ current, onStepClick, locked = false }: Props) {
  return (
    <nav className="jo-mini-steps" aria-label="Planning progress">
      <ol className="jo-mini-steps__list">
        {JOB_FLOW_STEPS.map((step, index) => {
          const done = step.id < current || (step.id === 4 && current === 4);
          const active = step.id === current && !done;
          const clickable = !locked && done && step.id < current && typeof onStepClick === 'function';
          return (
            <li
              key={step.id}
              className={[
                'jo-mini-steps__item',
                done ? 'is-done' : '',
                active ? 'is-active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {index > 0 && <span className="jo-mini-steps__line" aria-hidden />}
              <button
                type="button"
                className="jo-mini-steps__node"
                disabled={!clickable}
                aria-current={active ? 'step' : undefined}
                onClick={() => clickable && onStepClick?.(step.id)}
              >
                <span className="jo-mini-steps__dot">{done ? <CheckOutlined /> : null}</span>
                <span className="jo-mini-steps__label">{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
