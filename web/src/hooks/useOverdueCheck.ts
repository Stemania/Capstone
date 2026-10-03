import { useEffect, useState } from 'react';
import { supplierOrdersApi } from '../api/supplierOrders.api';
import { useAuth } from './useAuth';

/**
 * Runs the overdue-delivery check when a page opens, so jobs held up by a late
 * supplier move even if nobody edits the order. Returns true once it has run
 * (or was skipped), so the page can load data that reflects it.
 */
export function useOverdueCheck(): boolean {
  const { isAdmin, isOfficeStaff } = useAuth();
  const allowed = isAdmin || isOfficeStaff;
  const [done, setDone] = useState(!allowed);

  useEffect(() => {
    if (!allowed) {
      setDone(true);
      return;
    }
    let cancelled = false;
    supplierOrdersApi
      .overdueCheck()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  return done;
}
