import type { ReactNode } from 'react';
import { Input, Select, type SelectProps } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

/**
 * List toolbar: search (left, fixed width), equal-width labelled selects,
 * actions on the right. Wraps on narrow screens.
 */
export default function FilterBar({
  search,
  filters,
  actions,
  tabs,
}: {
  search?: { value: string; onChange: (v: string) => void; placeholder: string; ariaLabel?: string };
  filters?: ReactNode;
  actions?: ReactNode;
  /** Optional TabBar shown above the filters. */
  tabs?: ReactNode;
}) {
  return (
    <div className="ui-filterbar-wrap">
      {tabs ? <div className="ui-filterbar__tabs">{tabs}</div> : null}
      <div className="ui-filterbar">
        <div className="ui-filterbar__left">
          {search ? (
            <Input
              className="ui-filterbar__search"
              allowClear
              prefix={<SearchOutlined aria-hidden />}
              placeholder={search.placeholder}
              aria-label={search.ariaLabel || search.placeholder}
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
            />
          ) : null}
          {filters}
        </div>
        {actions ? <div className="ui-filterbar__actions">{actions}</div> : null}
      </div>
    </div>
  );
}

/** Select with its label shown inside, sized to match its neighbours. */
export function FilterSelect<V = string>({
  label,
  className,
  ...rest
}: SelectProps<V> & { label: string }) {
  return (
    <Select<V>
      {...rest}
      aria-label={label}
      prefix={<span className="ui-filterbar__label">{label}</span>}
      placeholder={rest.placeholder ?? 'All'}
      className={`ui-filterbar__select${className ? ` ${className}` : ''}`}
    />
  );
}
