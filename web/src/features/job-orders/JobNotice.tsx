import type { ReactNode } from 'react';
import { ExclamationCircleFilled, InfoCircleFilled, StopFilled } from '@ant-design/icons';
import './jobNotice.css';

type Tone = 'info' | 'warn' | 'muted';

/** One compact line on the job page: what happened, then a short detail. */
export default function JobNotice({
  tone,
  title,
  detail,
  action,
}: {
  tone: Tone;
  title: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  const icon =
    tone === 'warn' ? <ExclamationCircleFilled /> : tone === 'muted' ? <StopFilled /> : <InfoCircleFilled />;
  return (
    <div className={`job-notice job-notice--${tone}`} role="status">
      <span className="job-notice__icon" aria-hidden>
        {icon}
      </span>
      <span className="job-notice__text">
        <strong>{title}</strong>
        {detail ? <span className="job-notice__detail"> · {detail}</span> : null}
      </span>
      {action ? <span className="job-notice__action">{action}</span> : null}
    </div>
  );
}
