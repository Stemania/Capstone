import { describe, expect, it } from 'vitest';
import { historyRangeLabel } from './workerHistoryPaging';

describe('historyRangeLabel', () => {
  it('labels a page of five', () => {
    expect(historyRangeLabel(27, 1)).toBe('1–5 of 27');
    expect(historyRangeLabel(27, 2)).toBe('6–10 of 27');
    expect(historyRangeLabel(27, 6)).toBe('26–27 of 27');
  });

  it('is empty when there is nothing to page', () => {
    expect(historyRangeLabel(0, 1)).toBe('');
  });
});
