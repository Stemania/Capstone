import dayjs from 'dayjs';
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
  const generatedAt = dayjs().format('YYYY-MM-DD HH:mm');
  return (
    <div className="report-toolbar no-print" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#0f1c2e' }}>{title}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            Generated {generatedAt}
            {periodFrom && periodTo ? ` · Period ${periodFrom} → ${periodTo}` : ''}
          </div>
        </div>
        <Space>
          {extra}
          <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
            Print
          </Button>
        </Space>
      </div>
    </div>
  );
}

export function ReportStamp({
  periodFrom,
  periodTo,
}: {
  periodFrom?: string;
  periodTo?: string;
}) {
  return (
    <div className="report-stamp" style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>
      Generated {dayjs().format('YYYY-MM-DD HH:mm')}
      {periodFrom && periodTo ? ` · Period covered: ${periodFrom} → ${periodTo}` : ''}
    </div>
  );
}

export function displayOrDash(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  return String(value);
}
