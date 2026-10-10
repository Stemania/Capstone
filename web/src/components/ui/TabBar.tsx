import type { ReactNode } from 'react';
import { Segmented } from 'antd';
import type { Tone } from '../../theme/tokens';

export type TabItem<T extends string> = {
  value: T;
  label: ReactNode;
  count?: number | null;
  /** Colour the count when it needs attention (e.g. red "To plan 8"). */
  countTone?: Tone;
  icon?: ReactNode;
  disabled?: boolean;
  title?: string;
};

/** The one tab style: pill tabs, optional counts. Status filters on lists use it too. */
export default function TabBar<T extends string>({
  items,
  value,
  onChange,
  size,
  block,
  className,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'small' | 'middle' | 'large';
  block?: boolean;
  className?: string;
}) {
  return (
    <Segmented<T>
      className={`ui-tabbar${className ? ` ${className}` : ''}`}
      size={size}
      block={block}
      value={value}
      onChange={(v) => onChange(v as T)}
      options={items.map((it) => ({
        value: it.value,
        disabled: it.disabled,
        title: it.title,
        label: (
          <span className="ui-tabbar__item">
            {it.icon ? <span className="ui-tabbar__icon">{it.icon}</span> : null}
            <span>{it.label}</span>
            {it.count != null ? (
              <span className={`ui-tabbar__count${it.countTone ? ` ui-tabbar__count--${it.countTone}` : ''}`}>
                {it.count}
              </span>
            ) : null}
          </span>
        ),
      }))}
    />
  );
}
