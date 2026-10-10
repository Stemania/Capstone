import { Typography } from 'antd';
import InfoTip from '../../components/InfoTip';
import { StatCard } from '../../components/ui';

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
  const excluded = excludedOperationCount;
  return (
    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
      Period {from} → {to}.{' '}
      {excluded === 0
        ? 'All finished operations in this period had a target time.'
        : `${excluded} finished operation${excluded === 1 ? '' : 's'} had no target time and ${
            excluded === 1 ? 'was' : 'were'
          } not counted`}
      {minimumOperationCount != null
        ? `. Averages need at least ${minimumOperationCount} finished operations — fewer than that shows counts only`
        : ''}
      .
    </Text>
  );
}

/** Longer explanations go behind the (i) so the tile stays one line. */
const HINT_MAX = 48;

export function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  const long = !!hint && hint.length > HINT_MAX;
  return (
    <StatCard
      label={
        long ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {label}
            <InfoTip content={hint} label={`About ${label}`} />
          </span>
        ) : (
          label
        )
      }
      value={value}
      hint={long ? undefined : hint}
    />
  );
}
