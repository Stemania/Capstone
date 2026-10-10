import type { ReactNode } from 'react';
import { Skeleton } from 'antd';
import type { Tone } from '../../theme/tokens';

/** KPI tile: icon in a tinted square, label, big number, small hint. */
export default function StatCard({
  icon,
  tone = 'blue',
  label,
  value,
  hint,
  valueTone,
  loading = false,
  onClick,
  active = false,
}: {
  icon?: ReactNode;
  tone?: Tone;
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  /** Colour the number itself (e.g. red for overdue counts above zero). */
  valueTone?: Tone;
  loading?: boolean;
  onClick?: () => void;
  active?: boolean;
}) {
  const body = (
    <>
      {icon ? (
        <span className={`ui-stat__icon ui-stat__icon--${tone}`} aria-hidden>
          {icon}
        </span>
      ) : null}
      <span className="ui-stat__text">
        <span className="ui-stat__label">{label}</span>
        {loading ? (
          <Skeleton.Button active size="small" style={{ width: 48, height: 24, marginTop: 2 }} />
        ) : (
          <span className={`ui-stat__value${valueTone ? ` tone-text--${valueTone}` : ''}`}>{value}</span>
        )}
        {hint ? <span className="ui-stat__hint">{hint}</span> : null}
      </span>
    </>
  );
  const cls = `ui-stat${onClick ? ' ui-stat--button' : ''}${active ? ' is-active' : ''}`;
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} aria-pressed={active}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Row of StatCards that wraps evenly. */
export function StatGrid({ children, min = 200 }: { children: ReactNode; min?: number }) {
  return (
    <div className="ui-stat-grid" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))` }}>
      {children}
    </div>
  );
}
