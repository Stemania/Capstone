import type { JobOrderStatus } from '../../types';

/** Production is finished: Completed, For Delivery or Delivered. */
export function isJobFinished(status?: JobOrderStatus | string | null): boolean {
  return status === 'COMPLETED' || status === 'FOR_DELIVERY' || status === 'DELIVERED';
}

/** Set For Delivery or later: the sales invoice is locked. */
export function isJobReleasedForDelivery(job: {
  status?: JobOrderStatus | string | null;
  forDeliveryAt?: string | null;
  deliveredAt?: string | null;
}): boolean {
  return (
    job.status === 'FOR_DELIVERY' ||
    job.status === 'DELIVERED' ||
    Boolean(job.forDeliveryAt) ||
    Boolean(job.deliveredAt)
  );
}

/** The Admin's one next delivery step for a job, if any. */
export type DeliveryStep = 'FOR_DELIVERY' | 'DELIVERED' | null;

export function nextDeliveryStep(status?: JobOrderStatus | string | null): DeliveryStep {
  if (status === 'COMPLETED') return 'FOR_DELIVERY';
  if (status === 'FOR_DELIVERY') return 'DELIVERED';
  return null;
}
