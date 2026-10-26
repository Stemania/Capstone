import type { ReactNode } from 'react';
import type { Tone } from '../theme/tokens';
import { statusDef, type StatusDef } from '../theme/statuses';

/** Older colour names some screens still pass. */
export type PillColor = 'blue' | 'green' | 'amber' | 'red' | 'gray' | 'teal' | 'indigo' | 'slate' | 'grey';

const LEGACY_TONE: Record<PillColor, Tone> = {
  blue: 'blue',
  green: 'green',
  amber: 'amber',
  red: 'red',
  gray: 'slate',
  grey: 'grey',
  slate: 'slate',
  teal: 'teal',
  indigo: 'indigo',
};

type Props = {
  children?: ReactNode;
  compact?: boolean;
  /** Small dot before the label. */
  dot?: boolean;
  /** Coloured text only, no container: for labels in table rows other than Status. */
  plain?: boolean;
  title?: string;
} & (
  | { tone: Tone; color?: never; status?: never; map?: never }
  | { color: PillColor; tone?: never; status?: never; map?: never }
  | { status: string | null | undefined; map: Record<string, StatusDef>; tone?: never; color?: never }
);

export default function StatusPill(props: Props) {
  const { compact = false, dot = false, plain = false, title } = props;
  let tone: Tone;
  let label: ReactNode = props.children;
  if ('map' in props && props.map) {
    const def = statusDef(props.map, props.status);
    tone = def.tone;
    label = props.children ?? def.label;
  } else if ('tone' in props && props.tone) {
    tone = props.tone;
  } else {
    tone = LEGACY_TONE[(props as { color: PillColor }).color] ?? 'slate';
  }
  if (plain) {
    return (
      <span className={`ui-tone-text ui-tone-text--${tone}`} title={title}>
        {label}
      </span>
    );
  }
  return (
    <span className={`ui-pill ui-pill--${tone}${compact ? ' ui-pill--compact' : ''}`} title={title}>
      {dot ? <span className="ui-pill__dot" aria-hidden /> : null}
      {label}
    </span>
  );
}
