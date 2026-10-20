import { isValidElement, useMemo, useState, type HTMLAttributes, type Key, type MouseEventHandler, type ReactNode } from 'react';
import { Button, Checkbox, Pagination, Select, Skeleton, Table, type TableProps } from 'antd';
import type { ColumnType } from 'antd/es/table';
import { DownOutlined, RightOutlined, SwapOutlined, UpOutlined } from '@ant-design/icons';
import { NARROW_QUERY, PHONE_QUERY, TOUCH_QUERY, useMediaQuery } from '../../hooks/useViewport';
import EmptyState from './EmptyState';

/** Which column plays which part on the card. Columns are named by `key` or `dataIndex`. */
export type CardLayout = {
  /** Card heading (default: first column). */
  title?: string;
  /** Shown under the heading, joined with " · ". */
  subtitle?: string[];
  /** Top-right, e.g. the status pill. */
  badge?: string;
  /** Top-right menu or buttons (default: a column keyed "actions"). */
  actions?: string;
  /** Not shown on the card. */
  hide?: string[];
  /** Fields that take the full card width. */
  full?: string[];
};

type Props<T> = TableProps<T> & {
  card?: CardLayout;
  /** `phone` (default): cards below 768px. `narrow`: cards below 992px (tablet portrait too). */
  cardsBelow?: 'phone' | 'narrow';
};

type Col<T> = ColumnType<T> & { children?: Col<T>[] };

function colId<T>(col: Col<T>, i: number): string {
  if (col.key != null) return String(col.key);
  const di = col.dataIndex;
  if (Array.isArray(di)) return di.join('.');
  if (di != null) return String(di);
  return `col-${i}`;
}

function cellValue<T>(col: Col<T>, record: T, index: number): ReactNode {
  const di = col.dataIndex;
  let raw: unknown;
  if (Array.isArray(di)) {
    raw = di.reduce<unknown>((acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k as string]), record);
  } else if (di != null) {
    raw = (record as Record<string, unknown>)[di as string];
  }
  const out = col.render ? col.render(raw, record, index) : (raw as ReactNode);
  if (out && typeof out === 'object' && 'children' in (out as object) && 'props' in (out as object)) {
    return (out as { children: ReactNode }).children;
  }
  return out as ReactNode;
}

const PLACEHOLDERS = new Set(['', '—', '-', '–']);

function isEmpty(node: ReactNode): boolean {
  if (node == null || node === false) return true;
  if (typeof node === 'string') return PLACEHOLDERS.has(node.trim());
  if (isValidElement<{ children?: ReactNode }>(node) && typeof node.props.children === 'string') {
    return PLACEHOLDERS.has(node.props.children.trim());
  }
  return false;
}

function titleOf<T>(col: Col<T>): ReactNode {
  const t = col.title as unknown;
  return typeof t === 'function' ? (t as (p: object) => ReactNode)({}) : (t as ReactNode);
}

function compareOf<T>(col: Col<T>): ((a: T, b: T) => number) | null {
  const s = col.sorter as unknown;
  if (typeof s === 'function') return s as (a: T, b: T) => number;
  if (s && typeof s === 'object' && typeof (s as { compare?: unknown }).compare === 'function') {
    return (s as { compare: (a: T, b: T) => number }).compare;
  }
  return null;
}

/**
 * Ant Table on wide screens; on phones (or below 992px with `cardsBelow="narrow"`)
 * each row becomes a card with the same cells, actions, sorting, selection,
 * expansion and paging. Desktop output is the plain Table.
 */
export default function ResponsiveTable<T extends object>({ card, cardsBelow = 'phone', ...props }: Props<T>) {
  const phone = useMediaQuery(PHONE_QUERY);
  const narrow = useMediaQuery(NARROW_QUERY);
  const touch = useMediaQuery(TOUCH_QUERY);
  const asCards = cardsBelow === 'narrow' ? narrow : phone;
  if (!asCards) {
    if (touch && props.expandable?.expandedRowRender && !props.expandable.expandIcon) {
      const expandable: TableProps<T>['expandable'] = {
        ...props.expandable,
        expandIcon: ({ expanded, onExpand, record, expandable: can }) =>
          can ? (
            <Button
              type="text"
              className="ui-expand-btn"
              icon={expanded ? <DownOutlined /> : <RightOutlined />}
              aria-label={expanded ? 'Collapse row' : 'Expand row'}
              aria-expanded={expanded}
              onClick={(e) => onExpand(record, e)}
            />
          ) : null,
      };
      return <Table<T> {...props} expandable={expandable} />;
    }
    return <Table<T> {...props} />;
  }
  return <CardList<T> {...props} card={card} grid={!phone} />;
}

function CardList<T extends object>({
  columns = [],
  dataSource = [],
  rowKey = 'key',
  pagination,
  loading,
  rowSelection,
  expandable,
  onRow,
  locale,
  card = {},
  grid,
  className,
}: TableProps<T> & { card?: CardLayout; grid: boolean }) {
  const cols = useMemo(() => {
    const flat: Col<T>[] = [];
    const walk = (list: Col<T>[]) =>
      list.forEach((c) => {
        if ((c as { hidden?: boolean }).hidden) return;
        if (c.children?.length) walk(c.children);
        else flat.push(c);
      });
    walk(columns as Col<T>[]);
    return flat.map((c, i) => ({ col: c, id: colId(c, i) }));
  }, [columns]);

  const titleId = card.title ?? cols[0]?.id;
  const actionsId = card.actions ?? cols.find((c) => c.id === 'actions' || c.id === 'action')?.id;
  const placed = new Set([titleId, actionsId, card.badge, ...(card.subtitle || []), ...(card.hide || [])]);
  const fieldCols = cols.filter((c) => !placed.has(c.id));
  const full = new Set(card.full || []);

  // Sorting: client-side with the column's own compare function.
  const sortable = cols.filter((c) => compareOf(c.col));
  const initialSort = (() => {
    const s = sortable.find((c) => c.col.sortOrder || c.col.defaultSortOrder);
    if (!s) return '';
    return `${s.id}:${s.col.sortOrder || s.col.defaultSortOrder}`;
  })();
  const [sort, setSort] = useState(initialSort);

  // Column filters (Ant `filters` + `onFilter`) become selects.
  const filterCols = cols.filter((c) => c.col.filters?.length && c.col.onFilter);
  const [filters, setFilters] = useState<Record<string, Key[]>>({});

  const keyOf = (r: T, i: number): Key =>
    typeof rowKey === 'function' ? (rowKey as (r: T, i?: number) => Key)(r, i) : ((r as Record<string, unknown>)[rowKey as string] as Key);

  const rows = useMemo(() => {
    let list = [...(dataSource as T[])];
    for (const fc of filterCols) {
      const vals = filters[fc.id];
      if (vals?.length) list = list.filter((r) => vals.some((v) => fc.col.onFilter!(v as never, r)));
    }
    if (sort) {
      const [id, order] = sort.split(':');
      const c = sortable.find((s) => s.id === id);
      const cmp = c && compareOf(c.col);
      if (cmp) list.sort((a, b) => (order === 'descend' ? -cmp(a, b) : cmp(a, b)));
    }
    return list;
  }, [dataSource, filters, sort]);

  const pageConf = pagination === false ? null : { pageSize: 20, ...(pagination || {}) };
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(pageConf?.pageSize ?? 20);
  const current = pageConf?.current ?? page;
  const size = pageConf?.pageSize && pageConf.current != null ? pageConf.pageSize : pageSize;
  const serverPaged = pageConf?.total != null && pageConf.total > rows.length;
  const visible = pageConf && !serverPaged ? rows.slice((current - 1) * size, current * size) : rows;

  const [openKeys, setOpenKeys] = useState<Key[]>([...(expandable?.defaultExpandedRowKeys || [])]);
  const expanded = expandable?.expandedRowKeys ?? openKeys;
  const toggleExpand = (record: T, key: Key) => {
    const isOpen = expanded.includes(key);
    const next = isOpen ? expanded.filter((k) => k !== key) : [...expanded, key];
    if (!expandable?.expandedRowKeys) setOpenKeys(next);
    expandable?.onExpand?.(!isOpen, record);
    expandable?.onExpandedRowsChange?.(next as never);
  };

  const selected = rowSelection?.selectedRowKeys || [];
  const setSelected = (keys: Key[]) => {
    const picked = (dataSource as T[]).filter((r, i) => keys.includes(keyOf(r, i)));
    rowSelection?.onChange?.(keys, picked, { type: 'multiple' });
  };
  const selectable = visible.filter((r) => !rowSelection?.getCheckboxProps?.(r)?.disabled);
  const pageKeys = selectable.map((r) => keyOf(r, (dataSource as T[]).indexOf(r)));
  const allOnPage = pageKeys.length > 0 && pageKeys.every((k) => selected.includes(k));

  const hasToolbar = Boolean(rowSelection) || sortable.length > 0 || filterCols.length > 0;

  if (loading && !(dataSource as T[]).length) {
    return (
      <div className={`ui-cardlist${grid ? ' ui-cardlist--grid' : ''}`}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="ui-rowcard">
            <Skeleton active title paragraph={{ rows: 2 }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`ui-cardlist-wrap${className ? ` ${className}` : ''}`}>
      {hasToolbar ? (
        <div className="ui-cardlist__toolbar">
          {rowSelection && rowSelection.type !== 'radio' ? (
            <Checkbox
              checked={allOnPage}
              indeterminate={!allOnPage && pageKeys.some((k) => selected.includes(k))}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? Array.from(new Set([...selected, ...pageKeys]))
                    : selected.filter((k) => !pageKeys.includes(k))
                )
              }
            >
              Select page
            </Checkbox>
          ) : null}
          {filterCols.map((fc) => (
            <Select
              key={fc.id}
              mode="multiple"
              allowClear
              maxTagCount="responsive"
              className="ui-cardlist__select"
              placeholder={titleOf(fc.col)}
              value={filters[fc.id] || []}
              onChange={(v) => {
                setFilters((f) => ({ ...f, [fc.id]: v }));
                setPage(1);
              }}
              options={fc.col.filters!.map((f) => ({ value: f.value as Key, label: f.text }))}
            />
          ))}
          {sortable.length ? (
            <Select
              className="ui-cardlist__select"
              prefix={<SwapOutlined rotate={90} />}
              aria-label="Sort"
              value={sort || undefined}
              placeholder="Sort"
              allowClear
              onChange={(v) => setSort(v || '')}
              options={sortable.flatMap((s) => [
                { value: `${s.id}:ascend`, label: <span>{titleOf(s.col)} ↑</span> },
                { value: `${s.id}:descend`, label: <span>{titleOf(s.col)} ↓</span> },
              ])}
            />
          ) : null}
        </div>
      ) : null}

      {loading ? <div className="ui-cardlist__loading" aria-busy /> : null}

      {!visible.length ? (
        <div className="ui-cardlist__empty">
          {locale?.emptyText != null ? (locale.emptyText as ReactNode) : <EmptyState compact title="Nothing here yet" />}
        </div>
      ) : (
        <div className={`ui-cardlist${grid ? ' ui-cardlist--grid' : ''}`}>
          {visible.map((record) => {
            const index = (dataSource as T[]).indexOf(record);
            const key = keyOf(record, index);
            const rowProps = (onRow?.(record, index) || {}) as HTMLAttributes<HTMLElement>;
            const clickable = Boolean(rowProps.onClick);
            const isSelected = selected.includes(key);
            const canExpand = expandable?.expandedRowRender && (expandable.rowExpandable?.(record) ?? true);
            const isOpen = expanded.includes(key);
            const cell = (id?: string) => {
              const c = id ? cols.find((x) => x.id === id) : undefined;
              return c ? cellValue(c.col, record, index) : null;
            };
            const subtitle = (card.subtitle || []).map(cell).filter((n) => !isEmpty(n));
            const badge = cell(card.badge);
            const actions = cell(actionsId);
            const fields = fieldCols
              .map((c) => ({ c, v: cellValue(c.col, record, index) }))
              .filter(({ v }) => !isEmpty(v));
            return (
              <article
                key={key}
                className={`ui-rowcard${clickable ? ' is-clickable' : ''}${isSelected ? ' is-selected' : ''}${rowProps.className ? ` ${rowProps.className}` : ''}`}
                onClick={rowProps.onClick as MouseEventHandler<HTMLElement>}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === 'Enter') (rowProps.onClick as MouseEventHandler<HTMLElement>)?.(e as never);
                      }
                    : undefined
                }
              >
                <div className="ui-rowcard__head">
                  {rowSelection ? (
                    <span className="ui-rowcard__check" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        disabled={rowSelection.getCheckboxProps?.(record)?.disabled}
                        onChange={(e) =>
                          setSelected(
                            rowSelection.type === 'radio'
                              ? [key]
                              : e.target.checked
                                ? [...selected, key]
                                : selected.filter((k) => k !== key)
                          )
                        }
                        aria-label="Select row"
                      />
                    </span>
                  ) : null}
                  <div className="ui-rowcard__titles">
                    <div className="ui-rowcard__title">{cell(titleId)}</div>
                    {subtitle.length ? (
                      <div className="ui-rowcard__subtitle">
                        {subtitle.map((n, i) => (
                          <span key={i}>{n}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {!isEmpty(badge) ? <div className="ui-rowcard__badge">{badge}</div> : null}
                  {!isEmpty(actions) ? (
                    <div className="ui-rowcard__actions" onClick={(e) => e.stopPropagation()}>
                      {actions}
                    </div>
                  ) : null}
                </div>
                {fields.length ? (
                  <dl className="ui-rowcard__fields">
                    {fields.map(({ c, v }) => (
                      <div key={c.id} className={`ui-rowcard__field${full.has(c.id) ? ' ui-rowcard__field--full' : ''}`}>
                        <dt>{titleOf(c.col)}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {canExpand ? (
                  <div className="ui-rowcard__more" onClick={(e) => e.stopPropagation()}>
                    <Button
                      type="text"
                      block
                      icon={isOpen ? <UpOutlined /> : <DownOutlined />}
                      onClick={() => toggleExpand(record, key)}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? 'Hide details' : 'Show details'}
                    </Button>
                    {isOpen ? <div className="ui-rowcard__expanded">{expandable!.expandedRowRender!(record, index, 0, true)}</div> : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {pageConf && (serverPaged ? pageConf.total! : rows.length) > size ? (
        <Pagination
          className="ui-cardlist__pager"
          current={current}
          pageSize={size}
          total={serverPaged ? pageConf.total : rows.length}
          showSizeChanger={false}
          showTotal={pageConf.showTotal}
          onChange={(p, s) => {
            setPage(p);
            setPageSize(s);
            pageConf.onChange?.(p, s);
          }}
        />
      ) : null}
    </div>
  );
}
