import type { ReactNode } from 'react';
import { InboxOutlined } from '@ant-design/icons';

/** Icon, one line, optional action, on a faint blueprint grid. */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`ui-empty blueprint-grid${compact ? ' ui-empty--compact' : ''}`}>
      <span className="ui-empty__icon" aria-hidden>
        {icon ?? <InboxOutlined />}
      </span>
      <div className="ui-empty__title">{title}</div>
      {description ? <div className="ui-empty__desc">{description}</div> : null}
      {action ? <div className="ui-empty__action">{action}</div> : null}
    </div>
  );
}
