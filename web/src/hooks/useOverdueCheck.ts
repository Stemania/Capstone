import { useEffect } from 'react';
import { supplierOrdersApi } from '../api/supplierOrders.api';
import { useAuth } from './useAuth';

/**
 * Asks the server to run the overdue-delivery and at-risk checks in the
 * background when a page opens, so jobs held up by a late supplier move even if
 * nobody edits the order. The server throttles it; the page never waits for it.
 */
export function useOverdueCheck(): void {
  const { isAdmin, isOfficeStaff } = useAuth();
  const allowed = isAdmin || isOfficeStaff;

  useEffect(() => {
    if (allowed) supplierOrdersApi.overdueCheck().catch(() => undefined);
  }, [allowed]);
}
