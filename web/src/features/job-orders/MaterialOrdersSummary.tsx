import { formatShop } from '../../utils/shopTime';
import type { ReactNode } from 'react';
import { WarningOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import OverdueTag from '../../components/OverdueTag';
import StatusPill, { type PillColor } from '../../components/StatusPill';
import { ORDER_STATUS_PILL } from '../supplier-orders/supplierOrderUi';
import type { MaterialLineArrival, MaterialReadiness, PlannedMaterialSummary } from '../../types';

const MUTED = '#64748b';
const NAVY = '#0f172a';
const BORDER = '#e2e8f0';

const fmt = (iso?: string | null) => (iso ? formatShop(iso, 'MMM D, YYYY') : '—');

export const PLANNED_STATUS_PILL: Record<string, { label: string; color: PillColor }> = {
  TO_ORDER: { label: 'To order', color: 'red' },
  PARTLY_ORDERED: { label: 'To order', color: 'amber' },
  ON_DRAFT_ORDER: { label: 'On draft PO', color: 'gray' },
  PURCHASED: { label: 'Purchased', color: 'green' },
  FROM_STOCK: { label: 'From stock', color: 'blue' },
};

export function fmtQty(n: number | null | undefined, unit?: string | null) {
  if (n == null) return '—';
  const q = Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });
  return unit ? `${q} ${unit}` : q;
}

function limitingLineText(line: MaterialLineArrival) {
  const what = `${line.materialName}${line.gradeOrSpec ? ` (${line.gradeOrSpec})` : ''}`;
  const from = line.supplierName ? ` from ${line.supplierName}` : '';
  if (line.basis === 'RECEIVED') return `${what}${from}, received ${fmt(line.dateReceived)}`;
  if (line.daysOverdue && line.daysOverdue > 0) {
    const ref = line.poNumber ?? `ordered ${fmt(line.dateOrdered)}`;
    return `${what}${from}, ${ref} overdue by ${line.daysOverdue} day${
      line.daysOverdue === 1 ? '' : 's'
    }; expected tomorrow at the earliest`;
  }
  if (line.fromOrderDeliveryDate) {
    return `${what}${from}, ${line.poNumber ?? 'supplier order'} expected delivery`;
  }
  return `${what}${from}, ordered ${fmt(line.dateOrdered)} + ${line.leadTimeDays} day lead time`;
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        background: '#fffbeb',
        border: '1px solid #fde68a',
        borderRadius: 6,
        padding: '8px 10px',
        color: '#92400e',
        fontSize: 12,
      }}
    >
      <WarningOutlined style={{ marginTop: 2 }} />
      <span>{children}</span>
    </div>
  );
}

const th = { fontWeight: 600, padding: '0 8px 6px 0', textAlign: 'left' as const };
const thRight = { ...th, textAlign: 'right' as const };

/** Planned materials with how much of each is already on a placed supplier order. */
export function PlannedMaterialsTable({
  materials,
  showStatus = true,
  renderAction,
}: {
  materials: PlannedMaterialSummary[];
  showStatus?: boolean;
  renderAction?: (m: PlannedMaterialSummary) => ReactNode;
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: MUTED, fontSize: 11 }}>
            <th style={th}>Material</th>
            <th style={thRight}>Planned</th>
            <th style={thRight}>Purchased</th>
            <th style={thRight}>Still to order</th>
            <th style={{ paddingBottom: 6 }} />
          </tr>
        </thead>
        <tbody>
          {materials.map((m) => {
            const pill = PLANNED_STATUS_PILL[m.status];
            return (
              <tr key={m.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                <td style={{ padding: '6px 8px 6px 0', color: NAVY, fontWeight: 600 }}>{m.name}</td>
                <td style={{ textAlign: 'right', color: MUTED, paddingRight: 8 }}>
                  {fmtQty(m.plannedQuantity, m.unit)}
                </td>
                <td style={{ textAlign: 'right', color: MUTED, paddingRight: 8 }}>
                  {fmtQty(m.purchasedQuantity, m.unit)}
                  {m.draftQuantity > 0 ? (
                    <div style={{ fontSize: 11 }}>+ {fmtQty(m.draftQuantity, m.unit)} on draft PO</div>
                  ) : null}
                </td>
                <td style={{ textAlign: 'right', color: MUTED, paddingRight: 8 }}>
                  {fmtQty(m.remainingQuantity, m.unit)}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {(showStatus || m.fromStock) && pill ? (
                    <StatusPill color={pill.color} compact>
                      {pill.label}
                    </StatusPill>
                  ) : null}
                  {renderAction?.(m)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** When the materials are expected, or why that cannot be worked out yet. */
export function MaterialArrivalNote({ readiness }: { readiness?: MaterialReadiness | null }) {
  const orders = readiness?.supplierOrders ?? [];
  const missing = readiness?.missingLeadTimeSuppliers ?? [];
  const onlyDrafts = orders.length > 0 && orders.every((o) => o.status === 'DRAFT');

  if (readiness?.expectedDate && readiness.limitingLine) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
          background: '#f8fafc',
          borderRadius: 6,
          padding: '8px 10px',
        }}
      >
        <span style={{ fontSize: 12, color: MUTED }}>Expected arrival</span>
        <span style={{ fontWeight: 700, color: NAVY, fontSize: 14 }}>
          {fmt(readiness.expectedDate)}
        </span>
        <span style={{ fontSize: 12, color: MUTED }}>
          Set by {limitingLineText(readiness.limitingLine)}
        </span>
      </div>
    );
  }
  if (missing.length > 0) {
    return (
      <Warning>
        Arrival unknown: {missing.join(', ')} {missing.length === 1 ? 'has' : 'have'} no lead
        time. Set the supplier&apos;s lead time, or an expected delivery date on the supplier
        order.
      </Warning>
    );
  }
  if (onlyDrafts) {
    return (
      <Warning>
        The materials are on a draft order. They count as ordered once Office Staff issue it from
        Supplier Orders.
      </Warning>
    );
  }
  return null;
}

/**
 * Read-only view of planned materials next to the supplier orders covering
 * them. Material is changed on supplier orders, never here.
 */
export default function MaterialOrdersSummary({
  planned,
  readiness,
}: {
  planned?: PlannedMaterialSummary[] | null;
  readiness?: MaterialReadiness | null;
}) {
  const orders = readiness?.supplierOrders ?? [];

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff', padding: 12 }}>
      {planned?.length ? (
        <PlannedMaterialsTable materials={planned} />
      ) : (
        <div style={{ fontSize: 13, color: MUTED }}>No planned materials.</div>
      )}

      {orders.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: NAVY, marginBottom: 6 }}>
            Supplier orders · {orders.length}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: MUTED, fontSize: 11 }}>
                  <th style={th}>PO</th>
                  <th style={th}>Supplier</th>
                  <th style={th}>Status</th>
                  <th style={{ ...thRight, paddingRight: 0 }}>Expected delivery</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const pill = o.status ? ORDER_STATUS_PILL[o.status] : null;
                  return (
                    <tr
                      key={o.supplierOrderId ?? `no-po-${o.supplierName}`}
                      style={{ borderTop: `1px solid ${BORDER}` }}
                    >
                      <td style={{ padding: '7px 8px 7px 0', fontWeight: 600, color: NAVY }}>
                        {o.supplierOrderId ? (
                          <Link to={`/supplier-orders/${o.supplierOrderId}`}>
                            {o.poNumber ?? 'Draft (no PO yet)'}
                          </Link>
                        ) : (
                          <span style={{ color: MUTED, fontWeight: 400 }}>No PO</span>
                        )}
                      </td>
                      <td style={{ paddingRight: 8 }}>{o.supplierName ?? '—'}</td>
                      <td style={{ paddingRight: 8 }}>
                        {pill ? (
                          <StatusPill color={pill.color} compact>
                            {pill.label}
                          </StatusPill>
                        ) : (
                          <StatusPill color="blue" compact>
                            Recorded
                          </StatusPill>
                        )}
                      </td>
                      <td style={{ color: MUTED, textAlign: 'right' }}>
                        {fmt(o.expectedDeliveryDate)}
                        {o.daysOverdue ? (
                          <span style={{ marginLeft: 6 }}>
                            <OverdueTag days={o.daysOverdue} />
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 10 }}>
        <MaterialArrivalNote readiness={readiness} />
      </div>
    </div>
  );
}
