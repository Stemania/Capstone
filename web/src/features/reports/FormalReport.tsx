import dayjs from 'dayjs';
import type { Key, ReactNode } from 'react';
import { useAuth } from '../../hooks/useAuth';
import type { ShopDetails } from '../../api/shopDetails.api';
import { shopNow } from '../../utils/shopTime';
import { SignatureBlock } from './PrintTemplate';

/**
 * Building blocks for the printed analytics reports: a centred title block,
 * numbered sections, captioned and fully ruled tables, notes, and signatures,
 * in the same plain style as the shop's printed purchase and job orders.
 */

const ROLE_TITLE: Record<string, string> = {
  ADMIN: 'Administrator',
  OFFICE_STAFF: 'Office Staff',
  PRODUCTION_WORKER: 'Production Worker',
};

export function longDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = dayjs(value);
  return d.isValid() ? d.format('MMMM D, YYYY') : value;
}

/** Title, period covered, and when the report was generated. */
export function ReportTitleBlock({
  title,
  from,
  to,
  asOf,
}: {
  title: string;
  from?: string;
  to?: string;
  /** For reports of current stock: "As of" instead of a period. */
  asOf?: boolean;
}) {
  const now = shopNow();
  return (
    <div className="fr-title">
      <h1 className="fr-title__name">{title}</h1>
      {from && to ? (
        <div className="fr-title__period">
          For the period {longDate(from)} to {longDate(to)}
        </div>
      ) : null}
      {asOf ? (
        <div className="fr-title__period">
          Stock levels as of {now.format('MMMM D, YYYY, h:mm A')}
        </div>
      ) : null}
      <div className="fr-title__meta">Date generated: {now.format('MMMM D, YYYY, h:mm A')}</div>
    </div>
  );
}

/** Numbered section heading, e.g. "2. Labor Efficiency by Operation Type". */
export function ReportHeading({ n, children }: { n: number; children: ReactNode }) {
  return (
    <h2 className="fr-heading">
      <span className="fr-heading__n">{n}.</span>
      {children}
    </h2>
  );
}

export type FormalColumn<T> = {
  title: ReactNode;
  render: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** CSS width, e.g. "14%". */
  width?: string;
  nowrap?: boolean;
  /** Extra class on the body cells, e.g. "fr-code". */
  className?: string;
};

/** A captioned, fully ruled table. The heading row repeats on every printed page. */
export function FormalTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
  total,
  rowClassName,
  numbered,
}: {
  caption: ReactNode;
  columns: FormalColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => Key;
  empty: string;
  /** Cells of a closing "Total" row, one per column. */
  total?: ReactNode[];
  rowClassName?: (row: T) => string | undefined;
  /** Adds a "No." column. */
  numbered?: boolean;
}) {
  const span = columns.length + (numbered ? 1 : 0);
  return (
    <div className={rows.length <= 14 ? 'fr-block fr-keep' : 'fr-block'}>
      <div className="fr-table__caption">{caption}</div>
      <table className="fr-table">
        <colgroup>
          {numbered ? <col style={{ width: '6%' }} /> : null}
          {columns.map((c, i) => (
            <col key={i} style={c.width ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {numbered ? <th>No.</th> : null}
            {columns.map((c, i) => (
              <th key={i}>{c.title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={span} className="fr-table__empty">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, ri) => (
              <tr key={rowKey(row, ri)} className={rowClassName?.(row)}>
                {numbered ? <td className="fr-c">{ri + 1}</td> : null}
                {columns.map((c, ci) => (
                  <td
                    key={ci}
                    className={
                      [
                        c.align === 'right' ? 'fr-r' : c.align === 'center' ? 'fr-c' : '',
                        c.nowrap ? 'fr-nw' : '',
                        c.className || '',
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                  >
                    {c.render(row, ri)}
                  </td>
                ))}
              </tr>
            ))
          )}
          {total && rows.length > 0 ? (
            <tr className="fr-table__total">
              {numbered ? <td /> : null}
              {total.map((cell, i) => (
                <td
                  key={i}
                  className={
                    columns[i]?.align === 'right'
                      ? 'fr-r'
                      : columns[i]?.align === 'center'
                        ? 'fr-c'
                        : undefined
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/** Two-column summary of the key figures. */
export function SummaryTable({
  caption,
  items,
}: {
  caption: ReactNode;
  items: { label: ReactNode; value: ReactNode; remark?: ReactNode }[];
}) {
  const withRemarks = items.some((i) => i.remark);
  return (
    <div className="fr-block fr-keep">
      <div className="fr-table__caption">{caption}</div>
      <table className="fr-table fr-table--summary">
        <colgroup>
          <col style={{ width: withRemarks ? '40%' : '62%' }} />
          <col style={{ width: withRemarks ? '20%' : '38%' }} />
          {withRemarks ? <col style={{ width: '40%' }} /> : null}
        </colgroup>
        <thead>
          <tr>
            <th>Indicator</th>
            <th>Value</th>
            {withRemarks ? <th>Remarks</th> : null}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td>{it.label}</td>
              <td className="fr-r fr-nw fr-b">{it.value}</td>
              {withRemarks ? <td>{it.remark ?? ''}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Notes printed under a table. */
export function ReportNotes({ items }: { items: ReactNode[] }) {
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return (
    <div className="fr-notes">
      <span className="fr-notes__label">Note{list.length > 1 ? 's' : ''}:</span>
      {list.length === 1 ? (
        <span> {list[0]}</span>
      ) : (
        <ol>
          {list.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** "Prepared by" (the person printing) and "Noted by" (the shop's approver). */
export function ReportSignatures({ shop }: { shop: ShopDetails }) {
  const { user } = useAuth();
  return (
    <>
      <div className="shop-print-signatures fr-signatures">
        <SignatureBlock
          label="Prepared by:"
          name={user?.fullName}
          title={user?.role ? ROLE_TITLE[user.role] || null : null}
        />
        <SignatureBlock label="Noted by:" name={shop.joApproverName} title={shop.joApproverTitle} />
      </div>
      <div className="fr-end">*** End of report ***</div>
    </>
  );
}

/** Signed variance vs target: "−0.4%" (faster) or "+2.1%" (slower). */
export function signedPct(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (Math.abs(value) < 0.05) return '0.0%';
  const abs = Math.abs(value).toFixed(digits);
  return value > 0 ? `+${abs}%` : `−${abs}%`;
}

export function num(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-PH', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function qty(value: number | null | undefined, unit?: string | null): string {
  if (value == null || Number.isNaN(value)) return '—';
  const n = value.toLocaleString('en-PH', { maximumFractionDigits: 2 });
  return unit ? `${n} ${unit}` : n;
}

export function sum<T>(rows: T[], pick: (r: T) => number | null | undefined): number | null {
  let total = 0;
  let any = false;
  for (const r of rows) {
    const v = pick(r);
    if (v != null && !Number.isNaN(v)) {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}
