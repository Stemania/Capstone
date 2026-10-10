import { shopNow } from '../../utils/shopTime';
import { Button, Space } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

/** Shared print toolbar + generation stamp (hidden when printing). */
export function ReportToolbar({
  title,
  periodFrom,
  periodTo,
  extra,
}: {
  title: string;
  periodFrom?: string;
  periodTo?: string;
  extra?: ReactNode;
}) {
  const generatedAt = shopNow().format('YYYY-MM-DD HH:mm');
  return (
    <div className="report-toolbar no-print" aria-label={`${title} toolbar`}>
      <div className="report-header">
        <div className="report-meta">
          Generated {generatedAt}
          {periodFrom && periodTo ? ` · Period ${periodFrom} → ${periodTo}` : ''}
        </div>
        <Space wrap size={8}>
          {extra}
          <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
            Print
          </Button>
        </Space>
      </div>
    </div>
  );
}

/** Print-only stamp so the screen header is not duplicated. */
export function ReportStamp({
  periodFrom,
  periodTo,
}: {
  periodFrom?: string;
  periodTo?: string;
}) {
  return (
    <div className="report-stamp">
      Generated {shopNow().format('YYYY-MM-DD HH:mm')}
      {periodFrom && periodTo ? ` · Period covered: ${periodFrom} → ${periodTo}` : ''}
    </div>
  );
}

export function ReportKpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="report-kpi">
      <div className="report-kpi__label">{label}</div>
      <div className="report-kpi__value">{value}</div>
      {hint ? <div className="report-kpi__hint">{hint}</div> : <div className="report-kpi__hint" />}
    </div>
  );
}

export function ReportSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="report-section">
      <h2 className="report-section__title">{title}</h2>
      {note ? <p className="report-section__note">{note}</p> : null}
      <div className="report-section__body">{children}</div>
    </section>
  );
}

export function displayOrDash(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  return String(value);
}
