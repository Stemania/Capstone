import { describe, expect, it } from 'vitest';
import {
  JOB_ORDER_LIST_TABS,
  MATERIALS_NEEDED_OPTIONS,
  isJobOrderListTab,
} from './jobOrderListTabs';

describe('Job Orders list tabs', () => {
  it('has no Archive tab in the day-to-day list', () => {
    expect(JOB_ORDER_LIST_TABS).toEqual(['production', 'drafts']);
    expect(JOB_ORDER_LIST_TABS.includes('archived' as never)).toBe(false);
  });

  it('treats production and drafts as list tabs', () => {
    expect(isJobOrderListTab('production')).toBe(true);
    expect(isJobOrderListTab('drafts')).toBe(true);
    // The Admin no longer has an Assigned tab: worker work is on worker accounts.
    expect(isJobOrderListTab('assigned')).toBe(false);
    expect(isJobOrderListTab('archived')).toBe(false);
    expect(isJobOrderListTab(null)).toBe(false);
  });
});

describe('Materials needed radios', () => {
  it('uses short horizontal labels without the old parenthetical', () => {
    expect(MATERIALS_NEEDED_OPTIONS.map((o) => o.label)).toEqual(['To order', 'Not required']);
    const joined = MATERIALS_NEEDED_OPTIONS.map((o) => o.label).join(' ');
    expect(joined).not.toMatch(/client-supplied/i);
    expect(joined).not.toMatch(/from stock/i);
  });
});
