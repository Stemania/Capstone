import { useState, type ReactNode } from 'react';
import { Button, Tooltip, Typography } from 'antd';
import { DownOutlined, DownloadOutlined, UpOutlined } from '@ant-design/icons';

const { Title, Paragraph } = Typography;

/** Width of a card on the 12-column grid (wide screens only; narrow screens stack). */
export type AnalyticsSpan = 4 | 5 | 6 | 7 | 8 | 12;

/** Row of analytics cards: side by side from 1200px, stacked below. */
export function AnalyticsGrid({ children }: { children: ReactNode }) {
  return <div className="analytics-grid">{children}</div>;
}

/** One question-sized block on an analytics tab: heading, controls, one CSV export, content. */
export function AnalyticsSection({
  title,
  description,
  controls,
  onExport,
  exportDisabled,
  span = 12,
  children,
}: {
  title: string;
  description?: ReactNode;
  controls?: ReactNode;
  onExport?: () => void;
  exportDisabled?: boolean;
  span?: AnalyticsSpan;
  children: ReactNode;
}) {
  return (
    <section className={`analytics-card analytics-span-${span}`}>
      <div className="analytics-card__head">
        <Title
          level={5}
          className="analytics-card__titles"
          style={{ margin: 0, color: '#0f1c2e', fontSize: 15 }}
        >
          {title}
        </Title>
        <div className="analytics-card__tools">
          {controls}
          {onExport ? (
            <Tooltip title="Export CSV">
              <Button
                className="no-print"
                size="small"
                aria-label="Export CSV"
                icon={<DownloadOutlined />}
                disabled={exportDisabled}
                onClick={onExport}
              />
            </Tooltip>
          ) : null}
        </div>
      </div>
      {description ? (
        <Paragraph
          type="secondary"
          ellipsis={{ rows: 2, tooltip: { title: description, placement: 'topLeft' } }}
          style={{ fontSize: 12, margin: '-4px 0 10px' }}
        >
          {description}
        </Paragraph>
      ) : null}
      <div className="analytics-card__body">{children}</div>
    </section>
  );
}

/** Table (or other detail) hidden until the user asks for it. */
export function ShowDetails({ children, label = 'Show details' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 10 }}>
      <Button
        type="link"
        size="small"
        style={{ padding: 0, fontWeight: 600 }}
        icon={open ? <UpOutlined /> : <DownOutlined />}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide details' : label}
      </Button>
      {open ? <div style={{ marginTop: 8 }}>{children}</div> : null}
    </div>
  );
}

/** Placeholder for an analysis that is planned but not built yet. */
export function ComingSoon({
  title,
  description,
  span = 12,
}: {
  title: string;
  description: string;
  span?: AnalyticsSpan;
}) {
  return (
    <section className={`analytics-card analytics-card--soon analytics-span-${span}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
        <Title level={5} style={{ margin: 0, color: '#0f1c2e', fontSize: 15 }}>
          {title}
        </Title>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: '#64748b',
            background: '#e2e8f0',
            borderRadius: 999,
            padding: '2px 8px',
          }}
        >
          Coming soon
        </span>
      </div>
      <Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
        {description}
      </Paragraph>
    </section>
  );
}

/** Drops rows whose listed values are all zero or empty. */
export function withoutAllZero<T>(rows: T[], values: (row: T) => (number | null | undefined)[]): T[] {
  return rows.filter((r) => values(r).some((v) => v != null && !Number.isNaN(v) && v !== 0));
}

export const CHART_BOX = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
} as const;
