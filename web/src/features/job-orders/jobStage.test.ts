import { describe, expect, it } from 'vitest';
import { isJobFinished, isJobReleasedForDelivery, nextDeliveryStep } from './jobStage';

describe('job delivery stages', () => {
  it('one next step at a time', () => {
    expect(nextDeliveryStep('IN_PROGRESS')).toBeNull();
    expect(nextDeliveryStep('COMPLETED')).toBe('FOR_DELIVERY');
    expect(nextDeliveryStep('FOR_DELIVERY')).toBe('DELIVERED');
    expect(nextDeliveryStep('DELIVERED')).toBeNull();
  });

  it('finished covers the three end stages', () => {
    expect(['COMPLETED', 'FOR_DELIVERY', 'DELIVERED'].every(isJobFinished)).toBe(true);
    expect(isJobFinished('IN_PROGRESS')).toBe(false);
  });

  it('the invoice locks from For Delivery on', () => {
    expect(isJobReleasedForDelivery({ status: 'COMPLETED' })).toBe(false);
    expect(isJobReleasedForDelivery({ status: 'FOR_DELIVERY' })).toBe(true);
    expect(isJobReleasedForDelivery({ status: 'DELIVERED' })).toBe(true);
  });
});
