import type { PillColor } from '../../components/StatusPill';
import type { SupplierOrderStatus } from '../../types';

export const ORDER_STATUS_PILL: Record<SupplierOrderStatus, { label: string; color: PillColor }> = {
  DRAFT: { label: 'Draft', color: 'gray' },
  ISSUED: { label: 'Issued', color: 'blue' },
  PARTIALLY_RECEIVED: { label: 'Partly received', color: 'amber' },
  RECEIVED: { label: 'Received', color: 'green' },
  CANCELLED: { label: 'Cancelled', color: 'red' },
};

export const LINE_STATUS_PILL: Record<string, { label: string; color: PillColor }> = {
  DRAFT: { label: 'On draft PO', color: 'gray' },
  ORDERED: { label: 'Ordered', color: 'amber' },
  RECEIVED: { label: 'Received', color: 'green' },
  CONSUMED: { label: 'Consumed', color: 'gray' },
  CANCELLED: { label: 'Cancelled', color: 'red' },
};

export function fmtMoney(n?: number | null) {
  if (n == null) return '—';
  return `₱${Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtQty(n: number | null | undefined, unit?: string | null) {
  if (n == null) return '—';
  const q = Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });
  return unit ? `${q} ${unit}` : q;
}

export function fmtDay(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}
