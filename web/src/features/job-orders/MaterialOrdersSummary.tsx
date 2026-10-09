import { formatShop } from '../../utils/shopTime';
import type { ReactNode } from 'react';
import { Table, Tooltip } from 'antd';
import { Link } from 'react-router-dom';
import OverdueTag from '../../components/OverdueTag';
import StatusPill, { type PillColor } from '../../components/StatusPill';
import type {
  JobMaterialLine,
  MaterialLineArrival,
  MaterialPurchase,
  MaterialReadiness,
  RawMaterial,
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

type LineStatus = 'ON_DRAFT' | 'ORDERED' | 'RECEIVED' | 'CONSUMED';

const LINE_STATUS_PILL: Record<LineStatus, { label: string; color: PillColor }> = {
  ON_DRAFT: { label: 'On draft PO', color: 'gray' },
  ORDERED: { label: 'Ordered', color: 'amber' },
  RECEIVED: { label: 'Received', color: 'green' },
  CONSUMED: { label: 'Consumed', color: 'gray' },
};

function lineStatus(status: string | null | undefined, dateReceived?: string | null): LineStatus {
  if (status === 'DRAFT') return 'ON_DRAFT';
  if (status === 'CONSUMED') return 'CONSUMED';
  if (status === 'RECEIVED' || dateReceived) return 'RECEIVED';
  return 'ORDERED';
}

/** One ordered material line, from the full purchase (Office/Admin) or the cost-free summary. */
export type MaterialLineRow = {
  id: string;
  materialName: string;
  gradeOrSpec: string | null;
  quantity: number | null;
  unit: string | null;
  status: LineStatus;
  poNumber: string | null;
  supplierName?: string | null;
  supplierOrderId?: string | null;
  expectedDate: string | null;
  dateReceived: string | null;
  daysOverdue?: number;
  purchase?: MaterialPurchase;
};

export function rowsFromPurchases(purchases: MaterialPurchase[]): MaterialLineRow[] {
  return purchases
    .filter((p) => p.status !== 'CANCELLED' && !p.cancelledAt)
    .map((p) => ({
      id: p.id,
      materialName: p.materialName,
      gradeOrSpec: p.gradeOrSpec ?? null,
      quantity: p.quantity,
      unit: p.unit,
      status: lineStatus(p.consumedAt ? 'CONSUMED' : p.status, p.dateReceived),
      poNumber: p.poNumber ?? null,
      supplierName: p.supplierName,
      supplierOrderId: p.supplierOrderId,
      expectedDate: p.currentExpectedDate || p.expectedDeliveryDate || null,
      dateReceived: p.dateReceived ?? null,
      daysOverdue: p.daysOverdue,
      purchase: p,
    }));
}

export function rowsFromSummary(lines: JobMaterialLine[]): MaterialLineRow[] {
  return lines.map((l) => ({
    id: l.id,
    materialName: l.materialName,
    gradeOrSpec: l.gradeOrSpec,
    quantity: l.quantity,
    unit: l.unit,
    status: lineStatus(l.status, l.dateReceived),
    poNumber: l.poNumber,
    expectedDate: l.expectedDate,
    dateReceived: l.dateReceived,
  }));
}

function SupplierOrderRef({ row }: { row: MaterialLineRow }) {
  const supplier = row.supplierName;
  if (!row.supplierOrderId) {
    return row.poNumber ? (
      <span>{row.poNumber}</span>
    ) : (
      <span>
        {supplier ? `${supplier} ` : ''}
        <span style={{ color: MUTED, fontSize: 12 }}>{supplier ? '· No PO' : 'No PO'}</span>
      </span>
    );
  }
  return (
    <Link to={`/supplier-orders/${row.supplierOrderId}`}>
      {supplier ? `${supplier} · ` : ''}
      {row.poNumber || 'Draft'}
    </Link>
  );
}

function LineDate({ row }: { row: MaterialLineRow }) {
  if (row.dateReceived) return <div>Received {fmt(row.dateReceived)}</div>;
  if (row.status === 'ON_DRAFT') return <div style={{ color: '#94a3b8' }}>Not issued</div>;
  return (
    <div>
      {row.expectedDate ? `Expected ${fmt(row.expectedDate)}` : '—'}
      {row.daysOverdue ? (
        <span style={{ marginLeft: 6 }}>
          <OverdueTag days={row.daysOverdue} />
        </span>
      ) : null}
    </div>
  );
}

/**
 * The job's ordered material lines: what, how much, on which supplier order,
 * and when it is expected or was received.
 */
export function JobMaterialsTable({
  lines,
  renderLineAction,
}: {
  lines: MaterialLineRow[];
  renderLineAction?: (row: MaterialLineRow) => ReactNode;
}) {
  return (
    <Table<MaterialLineRow>
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={lines}
      locale={{ emptyText: 'Nothing ordered for this job yet.' }}
      columns={[
        {
          title: 'Material',
          key: 'name',
          render: (_: unknown, r) => (
            <>
              <div style={{ color: NAVY, fontWeight: 600 }}>{r.materialName}</div>
              {r.gradeOrSpec ? (
                <div style={{ fontSize: 11, color: MUTED }}>{r.gradeOrSpec}</div>
              ) : null}
            </>
          ),
        },
        {
          title: 'Quantity',
          key: 'qty',
          width: 110,
          render: (_: unknown, r) => <span style={{ color: MUTED }}>{fmtQty(r.quantity, r.unit)}</span>,
        },
        {
          title: 'Supplier order',
          key: 'order',
          render: (_: unknown, r) => <SupplierOrderRef row={r} />,
        },
        {
          title: 'Status',
          key: 'status',
          width: 120,
          render: (_: unknown, r) => {
            const pill = LINE_STATUS_PILL[r.status];
            return (
              <StatusPill color={pill.color} compact>
                {pill.label}
              </StatusPill>
            );
          },
        },
        {
          title: 'Expected / received',
          key: 'date',
          width: 190,
          render: (_: unknown, r) => (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: MUTED }}>
              <LineDate row={r} />
              {renderLineAction?.(r)}
            </div>
          ),
        },
      ]}
    />
  );
}

/** Planned materials entered on the job order form before materials were typed
 *  when ordering. Kept for reference only. */
export function EarlierPlannedMaterials({ materials }: { materials: RawMaterial[] }) {
  const rows = materials.filter((m) => m.name?.trim());
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <Tooltip title="Entered on the job order form under the earlier process. Read-only.">
        <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 4 }}>
          Planned (earlier record)
        </div>
      </Tooltip>
      {rows.map((m, i) => (
        <div key={m.id || `${m.name}-${i}`} style={{ fontSize: 13, color: MUTED, marginBottom: 2 }}>
          <span style={{ color: NAVY }}>{m.name}</span>
          {m.quantity != null || m.unit ? ` — ${fmtQty(m.quantity ?? null, m.unit)}` : ''}
          {m.fromStock ? ' · from stock' : ''}
        </div>
      ))}
    </div>
  );
}
