import { describe, expect, it } from 'vitest';
import { jobPrintBackPath } from './printNavigation';

describe('job print back', () => {
  it('always returns to the job orders list', () => {
    expect(jobPrintBackPath()).toBe('/job-orders');
  });
});
