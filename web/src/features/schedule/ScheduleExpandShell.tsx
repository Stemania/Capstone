import { useEffect, useState, type ReactNode } from 'react';
import { Button, Tooltip } from 'antd';
import { CompressOutlined, ExpandOutlined } from '@ant-design/icons';

export type ScheduleExpandApi = {
  expandButton: ReactNode;
  expanded: boolean;
};

type Props = {
  title?: string;
  collapsedMaxHeight?: string;
  children: ReactNode | ((api: ScheduleExpandApi) => ReactNode);
  className?: string;
  /** Put the expand control in the body (via children render prop) instead of the title row. */
  expandInBody?: boolean;
};

export default function ScheduleExpandShell({
  title,
  collapsedMaxHeight = 'min(520px, 55vh)',
  children,
  className,
  expandInBody = false,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [expanded]);

  const expandButton = (
    <Tooltip title={expanded ? 'Exit full screen' : 'Expand schedule'}>
      <Button
        type="text"
        size="small"
        className="sched-expand__btn"
        icon={expanded ? <CompressOutlined /> : <ExpandOutlined />}
        aria-label={expanded ? 'Exit full screen' : 'Expand schedule'}
        onClick={() => setExpanded((v) => !v)}
      />
    </Tooltip>
  );

  const body = typeof children === 'function' ? children({ expandButton, expanded }) : children;

  return (
    <div
      className={`sched-expand${expanded ? ' sched-expand--open' : ''}${className ? ` ${className}` : ''}`}
      style={{ ['--sched-view-max-h' as string]: collapsedMaxHeight }}
    >
      <div className="sched-expand__toolbar">
        {title ? <div className="sched-expand__title">{title}</div> : <span className="sched-expand__title-spacer" />}
        {!expandInBody ? expandButton : null}
      </div>
      <div className="sched-expand__body">{body}</div>
    </div>
  );
}
