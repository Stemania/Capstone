import { describe, expect, it } from 'vitest';
import { compareByDue } from './jobOrderSort';

describe('job order list order', () => {
  it('puts jobs due the same day in PO date order, then creation order', () => {
    const jobs = [
      { id: 'c', dueDate: '2026-10-20', poDate: null, createdAt: '2026-10-01T00:00:00Z' },
      { id: 'b', dueDate: '2026-10-20', poDate: '2026-10-05', createdAt: '2026-10-03T00:00:00Z' },
      { id: 'a', dueDate: '2026-10-20', poDate: '2026-10-05', createdAt: '2026-10-02T00:00:00Z' },
      { id: 'early', dueDate: '2026-10-18', poDate: '2026-10-09', createdAt: '2026-10-09T00:00:00Z' },
      { id: 'd', dueDate: '2026-10-20', poDate: '2026-10-01', createdAt: '2026-10-08T00:00:00Z' },
    ];
    expect([...jobs].sort(compareByDue).map((j) => j.id)).toEqual(['early', 'd', 'a', 'b', 'c']);
  });
});
