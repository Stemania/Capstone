import type { HTMLAttributes, KeyboardEvent, MouseEvent } from 'react';

const INNER_CONTROL = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'label',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="combobox"]',
  '.ant-dropdown-trigger',
  '.ant-select',
  '.ant-checkbox-wrapper',
  '.ant-switch',
  '[data-row-stop]',
].join(',');

/** A click that started on the row itself, not on an inner control or inside a portal (menu, modal). */
function isRowClick(e: MouseEvent<HTMLElement>) {
  const row = e.currentTarget;
  const target = e.target as HTMLElement;
  if (!row.contains(target)) return false;
  const control = target.closest(INNER_CONTROL);
  return !control || control === row || !row.contains(control);
}

/** Props that make a whole table row or card open something: pointer, hover, Enter key. */
export function rowOpenProps(open: () => void): HTMLAttributes<HTMLElement> {
  return {
    className: 'ui-row-open',
    tabIndex: 0,
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (isRowClick(e)) open();
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Enter' && e.target === e.currentTarget) open();
    },
  };
}
