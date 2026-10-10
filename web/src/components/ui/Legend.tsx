import type { ReactNode } from 'react';
import { tones, type Tone } from '../../theme/tokens';

export type LegendItem = {
  label: ReactNode;
  tone?: Tone;
  color?: string;
  pattern?: string;
  border?: string;
};

/** Colour key for charts, Gantt bars and the calendar. */
export default function Legend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <div className={`ui-legend${className ? ` ${className}` : ''}`}>
      {items.map((it, i) => (
        <span key={i} className="ui-legend__item">
          <span
            className="ui-legend__swatch"
            aria-hidden
            style={{
              background: it.pattern ?? it.color ?? (it.tone ? tones[it.tone].solid : undefined),
              border: it.border,
              boxSizing: 'border-box',
            }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}
