import { useState, type ReactNode } from 'react';
import { Badge, Drawer, Input, Select, type SelectProps } from 'antd';
import { CloseOutlined, FilterOutlined, SearchOutlined } from '@ant-design/icons';
import { PHONE_QUERY, useMediaQuery } from '../../hooks/useViewport';

/**
 * List toolbar: search (left, fixed width), equal-width labelled selects,
 * actions on the right. Wraps on tablets; on phones it is one row (search,
 * icon actions, a Filters button) and the filters open in a bottom sheet.
 */
export default function FilterBar({
  search,
  filters,
  actions,
  tabs,
  activeFilters = 0,
  onClearFilters,
}: {
  search?: { value: string; onChange: (v: string) => void; placeholder: string; ariaLabel?: string };
  filters?: ReactNode;
  actions?: ReactNode;
  /** Optional TabBar shown above the filters. */
  tabs?: ReactNode;
  /** How many filters are on; shown as a badge on the phone Filters button. */
  activeFilters?: number;
  onClearFilters?: () => void;
}) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [sheetOpen, setSheetOpen] = useState(false);

  const searchInput = search ? (
    <Input
      className={phone ? 'ui-filterbar__search jo-m__search' : 'ui-filterbar__search'}
      allowClear
      variant={phone ? 'borderless' : undefined}
      prefix={<SearchOutlined aria-hidden />}
      placeholder={search.placeholder}
      aria-label={search.ariaLabel || search.placeholder}
      value={search.value}
      onChange={(e) => search.onChange(e.target.value)}
    />
  ) : null;

  if (phone) {
    return (
      <div className="ui-filterbar-wrap ui-filterbar-wrap--phone">
        {tabs ? <div className="ui-filterbar__tabs">{tabs}</div> : null}
        <div className="ui-mbar">
          {searchInput ?? <span className="ui-mbar__spacer" />}
          {actions ? <div className="ui-filterbar__actions ui-mbar__actions">{actions}</div> : null}
          {filters ? (
            <Badge count={activeFilters} size="small" offset={[-4, 4]} className="sched-m__filter">
              <button
                type="button"
                className={`sched-m__icon${activeFilters ? ' is-on' : ''}`}
                onClick={() => setSheetOpen(true)}
                aria-label={activeFilters ? `Filters, ${activeFilters} on` : 'Filters'}
              >
                <FilterOutlined />
              </button>
            </Badge>
          ) : null}
        </div>
        {filters ? (
          <Drawer
            rootClassName="sched-f-drawer"
            placement="bottom"
            size="auto"
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            closable={false}
            title={null}
            styles={{ header: { display: 'none' } }}
          >
            <div className="sched-f">
              <div className="sched-f__handle" />
              <div className="sched-f__head">
                <div>
                  <div className="sched-f__title">Filters</div>
                  <div className="sched-f__sub">{activeFilters ? `${activeFilters} on` : 'None on'}</div>
                </div>
                {activeFilters && onClearFilters ? (
                  <button type="button" className="sched-f__text" onClick={onClearFilters}>
                    Clear
                  </button>
                ) : null}
                <button type="button" className="sched-m__icon" onClick={() => setSheetOpen(false)} aria-label="Close">
                  <CloseOutlined />
                </button>
              </div>
              <div className="sched-f__card ui-mbar__sheet">{filters}</div>
              <button type="button" className="sched-f__done" onClick={() => setSheetOpen(false)}>
                Done
              </button>
            </div>
          </Drawer>
        ) : null}
      </div>
    );
  }

  return (
    <div className="ui-filterbar-wrap">
      {tabs ? <div className="ui-filterbar__tabs">{tabs}</div> : null}
      <div className="ui-filterbar">
        <div className="ui-filterbar__left">
          {searchInput}
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
