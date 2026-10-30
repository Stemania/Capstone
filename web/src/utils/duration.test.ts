import { describe, expect, it } from 'vitest';
import { formatHoursMinutes } from './duration';

describe('formatHoursMinutes', () => {
  it('formats hours and minutes', () => {
    expect(formatHoursMinutes(0.0446)).toBe('3m');
    expect(formatHoursMinutes(2.25)).toBe('2h 15m');
    expect(formatHoursMinutes(6)).toBe('6h');
    expect(formatHoursMinutes(1.9999)).toBe('2h');
    expect(formatHoursMinutes(null)).toBe('—');
  });
});
