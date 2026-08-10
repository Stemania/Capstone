import { Typography } from 'antd';

const { Text } = Typography;

/** Honest denominator note shown on every analytics page. */
export function AnalyticsPeriodNote({
  from,
  to,
  excludedOperationCount,
  minimumOperationCount,
}: {
  from: string;
  to: string;
  excludedOperationCount: number;
  minimumOperationCount?: number;
}) {
  return (
    <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 16 }}>
      Period {from} → {to}. {excludedOperationCount} completed operation
      {excludedOperationCount === 1 ? '' : 's'} without an estimate{' '}
      {excludedOperationCount === 1 ? 'is' : 'are'} excluded from variance metrics
      {minimumOperationCount != null
        ? `; averages require at least ${minimumOperationCount} operations (minOps)`
        : ''}
      .
    </Text>
  );
}

export function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        padding: '14px 16px',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#0f1c2e', lineHeight: 1.2 }}>
        {value}
      </div>
      {hint ? (
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{hint}</div>
      ) : null}
    </div>
  );
}
