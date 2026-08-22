import dayjs from 'dayjs';
import { Button, Space, Typography } from 'antd';
import { ArrowLeftOutlined, PrinterOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';

const NAVY = '#0f1c2e';
const { Title, Text } = Typography;

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
  const navigate = useNavigate();
  const generatedAt = dayjs().format('YYYY-MM-DD HH:mm');
  return (
    <div className="report-toolbar no-print">
      <div className="report-header">
        <Space wrap align="center" size={12}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reports')}>
            Back
          </Button>
          <div>
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>
              Reports
            </Text>
            <Title level={4} style={{ margin: 0, color: NAVY }}>
              {title}
            </Title>
          </div>
        </Space>
        <Space wrap size={8}>
          {extra}
          <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
            Print
          </Button>
        </Space>
      </div>
      <div className="report-meta">
        Generated {generatedAt}
        {periodFrom && periodTo ? ` · Period ${periodFrom} → ${periodTo}` : ''}
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
      Generated {dayjs().format('YYYY-MM-DD HH:mm')}
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
