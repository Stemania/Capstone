import { describe, expect, it } from 'vitest';
import { rowsToCsv } from './csvExport';

describe('csvExport formula escape', () => {
  it('prefixes =1+1 with an apostrophe', () => {
    const csv = rowsToCsv([{ note: '=1+1' }], [
      { key: 'note', header: 'note', value: (r) => r.note },
    ]);
    expect(csv).toContain("'=1+1");
  });

  it('leaves normal cells alone', () => {
    const csv = rowsToCsv([{ note: 'hello' }], [
      { key: 'note', header: 'note', value: (r) => r.note },
    ]);
    expect(csv.split('\r\n')[1]).toBe('hello');
  });
});
