import { formatShop } from '../../utils/shopTime';
import type { ReactNode } from 'react';
import { Table, Tooltip } from 'antd';
import { Link } from 'react-router-dom';
import OverdueTag from '../../components/OverdueTag';
import StatusPill, { type PillColor } from '../../components/StatusPill';
import type {
  MaterialLineArrival,
  MaterialPurchase,
  MaterialReadiness,
  PlannedMaterialSummary,
} from '../../types';

const MUTED = '#64748b';
const NAVY = '#0f172a';

const fmt = (iso?: string | null) => (iso ? formatShop(iso, 'MMM D, YYYY') : '—');

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

/** When the materials are expected, or why that cannot be worked out yet. */
export function materialArrivalText(readiness?: MaterialReadiness | null): string | null {
  const missing = readiness?.missingLeadTimeSuppliers ?? [];
  if (readiness?.expectedDate && readiness.limitingLine) {
    return `Expected arrival ${fmt(readiness.expectedDate)}, set by ${limitingLineText(readiness.limitingLine)}.`;
  }
  if (missing.length > 0) {
    return `Arrival unknown: ${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no lead time. Set the supplier's lead time, or an expected delivery date on the supplier order.`;
  }
  return null;
}

type RowStatus = 'TO_ORDER' | 'ON_DRAFT' | 'ORDERED' | 'RECEIVED' | 'CONSUMED' | 'FROM_STOCK';

const ROW_STATUS_PILL: Record<RowStatus, { label: string; color: PillColor }> = {
  TO_ORDER: { label: 'To order', color: 'red' },
  ON_DRAFT: { label: 'On draft PO', color: 'gray' },
  ORDERED: { label: 'Ordered', color: 'amber' },
  RECEIVED: { label: 'Received', color: 'green' },
  CONSUMED: { label: 'Consumed', color: 'gray' },
  FROM_STOCK: { label: 'From stock', color: 'blue' },
};

const LINE_RANK: Record<string, number> = { ON_DRAFT: 0, ORDERED: 1, RECEIVED: 2, CONSUMED: 3 };

function lineStatus(p: MaterialPurchase): RowStatus {
  if (p.status === 'DRAFT') return 'ON_DRAFT';
  if (p.status === 'CONSUMED' || p.consumedAt) return 'CONSUMED';
  if (p.status === 'RECEIVED' || p.dateReceived) return 'RECEIVED';
  return 'ORDERED';
}

/** The least advanced line decides the row: one undelivered line keeps it "Ordered". */
function leastAdvanced(lines: MaterialPurchase[]): RowStatus {
  return lines
    .map(lineStatus)
    .reduce((a, b) => (LINE_RANK[b] < LINE_RANK[a] ? b : a));
}

function plannedStatus(m: PlannedMaterialSummary, lines: MaterialPurchase[]): RowStatus {
  if (m.fromStock) return 'FROM_STOCK';
  if (m.status === 'TO_ORDER' || m.status === 'PARTLY_ORDERED') return 'TO_ORDER';
  if (lines.length) return leastAdvanced(lines);
  return m.status === 'ON_DRAFT_ORDER' ? 'ON_DRAFT' : 'ORDERED';
}

type Row = {
  key: string;
  name: string;
  quantity: string;
  status: RowStatus;
  lines: MaterialPurchase[];
  planned?: PlannedMaterialSummary;
  notPlanned?: boolean;
};

export function buildMaterialRows(
  planned: PlannedMaterialSummary[],
  purchases: MaterialPurchase[]
): Row[] {
  const active = purchases.filter((p) => p.status !== 'CANCELLED' && !p.cancelledAt);
  const byPlanned = new Map<string, MaterialPurchase[]>();
  for (const p of active) {
    if (!p.plannedMaterialId) continue;
    const list = byPlanned.get(p.plannedMaterialId) || [];
    list.push(p);
    byPlanned.set(p.plannedMaterialId, list);
  }
  const plannedIds = new Set(planned.map((m) => m.id));
  const rows: Row[] = planned.map((m) => {
    const lines = byPlanned.get(m.id) || [];
    return {
      key: m.id,
      name: m.name,
      quantity: fmtQty(m.plannedQuantity, m.unit),
      status: plannedStatus(m, lines),
      lines,
      planned: m,
    };
  });
  for (const p of active) {
    if (p.plannedMaterialId && plannedIds.has(p.plannedMaterialId)) continue;
    rows.push({
      key: p.id,
      name: p.materialName,
      quantity: fmtQty(p.quantity, p.unit),
      status: lineStatus(p),
      lines: [p],
      notPlanned: true,
    });
  }
  return rows;
}

function SupplierOrderRef({ line, showQty }: { line: MaterialPurchase; showQty: boolean }) {
  const supplier = line.supplierName || 'Supplier';
  const qty = showQty ? (
    <span style={{ color: MUTED, fontSize: 11 }}> · {fmtQty(line.quantity, line.unit)}</span>
  ) : null;
  if (!line.supplierOrderId) {
    return (
      <div>
        {supplier} <span style={{ color: MUTED, fontSize: 12 }}>· No PO</span>
        {qty}
      </div>
    );
  }
  return (
    <div>
      <Link to={`/supplier-orders/${line.supplierOrderId}`}>
        {supplier} · {line.poNumber || 'Draft'}
      </Link>
      {qty}
    </div>
  );
}

function LineDate({ line }: { line: MaterialPurchase }) {
  if (line.dateReceived) return <div>Received {fmt(line.dateReceived)}</div>;
  if (line.status === 'DRAFT') return <div style={{ color: '#94a3b8' }}>Not issued</div>;
  const expected = line.currentExpectedDate || line.expectedDeliveryDate;
  return (
    <div>
      {expected ? `Expected ${fmt(expected)}` : '—'}
      {line.daysOverdue ? (
        <span style={{ marginLeft: 6 }}>
          <OverdueTag days={line.daysOverdue} />
        </span>
      ) : null}
    </div>
  );
}

const lineGap = { display: 'flex', flexDirection: 'column' as const, gap: 4 };

/**
 * One row per planned material with where it stands: on which supplier order,
 * and when it is expected or was received. Lines not tied to a planned
 * material (older data) follow as "Not planned" rows.
 */
export function JobMaterialsTable({
  planned,
  purchases,
  showStatus = true,
  showOrders = true,
  renderLineAction,
  renderRowAction,
}: {
  planned: PlannedMaterialSummary[];
  purchases: MaterialPurchase[];
  showStatus?: boolean;
  showOrders?: boolean;
  renderLineAction?: (line: MaterialPurchase) => ReactNode;
  renderRowAction?: (m: PlannedMaterialSummary) => ReactNode;
}) {
  const rows = buildMaterialRows(planned, showOrders ? purchases : []);
  return (
    <Table<Row>
      size="small"
      rowKey="key"
      pagination={false}
      dataSource={rows}
      locale={{ emptyText: 'No planned materials.' }}
      columns={[
        {
          title: 'Material',
          key: 'name',
          render: (_: unknown, r) => (
            <>
              <div style={{ color: NAVY, fontWeight: 600 }}>{r.name}</div>
              {r.lines[0]?.gradeOrSpec ? (
                <div style={{ fontSize: 11, color: MUTED }}>{r.lines[0].gradeOrSpec}</div>
              ) : null}
              {r.notPlanned ? (
                <Tooltip title="Ordered before only planned materials could be ordered.">
                  <span style={{ fontSize: 11, color: MUTED }}>Not planned</span>
                </Tooltip>
              ) : null}
            </>
          ),
        },
        {
          title: 'Quantity',
          key: 'qty',
          width: 110,
          render: (_: unknown, r) => <span style={{ color: MUTED }}>{r.quantity}</span>,
        },
        {
          title: 'Status',
          key: 'status',
          width: 150,
          render: (_: unknown, r) => {
            const pill = ROW_STATUS_PILL[r.status];
            return (
              <div>
                {showStatus || r.status === 'FROM_STOCK' ? (
                  <StatusPill color={pill.color} compact>
                    {pill.label}
                  </StatusPill>
                ) : null}
                {r.planned ? renderRowAction?.(r.planned) : null}
              </div>
            );
          },
        },
        ...(showOrders
          ? [
              {
                title: 'Supplier order',
                key: 'order',
                render: (_: unknown, r: Row) =>
                  r.lines.length ? (
                    <div style={lineGap}>
                      {r.lines.map((ln) => (
                        <SupplierOrderRef key={ln.id} line={ln} showQty={r.lines.length > 1} />
                      ))}
                    </div>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>—</span>
                  ),
              },
              {
                title: 'Expected / received',
                key: 'date',
                width: 190,
                render: (_: unknown, r: Row) =>
                  r.lines.length ? (
                    <div style={{ ...lineGap, fontSize: 12, color: MUTED }}>
                      {r.lines.map((ln) => (
                        <div key={ln.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <LineDate line={ln} />
                          {renderLineAction?.(ln)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>—</span>
                  ),
              },
            ]
          : []),
      ]}
    />
  );
}
