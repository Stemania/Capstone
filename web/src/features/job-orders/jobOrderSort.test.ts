import { describe, expect, it } from 'vitest';
import { compareByDue, compareOpenFirst } from './jobOrderSort';

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

describe('default list order', () => {
  it('lists open jobs by due date, then finished jobs newest first', () => {
    const jobs = [
      { id: 'old-delivered', status: 'DELIVERED', dueDate: '2025-11-02' },
      { id: 'late-open', status: 'IN_PROGRESS', dueDate: '2026-10-25' },
      { id: 'recent-delivered', status: 'DELIVERED', dueDate: '2026-10-20' },
      { id: 'next-open', status: 'SCHEDULED', dueDate: '2026-11-04' },
      { id: 'cancelled', status: 'CANCELLED', dueDate: '2026-09-01' },
    ];
    expect([...jobs].sort(compareOpenFirst).map((j) => j.id)).toEqual([
      'late-open', 'next-open', 'recent-delivered', 'cancelled', 'old-delivered',
    ]);
  });
});
