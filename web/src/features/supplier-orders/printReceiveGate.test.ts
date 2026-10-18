import { describe, expect, it } from 'vitest';
import {
  PRINT_BEFORE_RECEIVE_HINT,
  canReceiveOrder,
  printedStatusLabel,
} from './printReceiveGate';

describe('print before receive (Batch 4)', () => {
  it('disables receive until printedAt is set', () => {
    expect(canReceiveOrder(null)).toBe(false);
    expect(canReceiveOrder(undefined)).toBe(false);
    expect(canReceiveOrder('2026-10-18T08:30:00Z')).toBe(true);
    expect(PRINT_BEFORE_RECEIVE_HINT).toMatch(/Print the PO first/);
  });

  it('shows printed status or Not printed yet', () => {
    const fmt = (iso: string | null | undefined) =>
      iso ? 'Oct 18, 2026' : '—';
    expect(printedStatusLabel(null, null, fmt)).toBe('Not printed yet');
    expect(printedStatusLabel('2026-10-18T08:30:00Z', 'Ana Office', fmt)).toBe(
      'Printed Oct 18, 2026 by Ana Office'
    );
  });
});
