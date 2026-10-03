import { Tag, Tooltip } from 'antd';

/** "N days late" for a delivery past its current expected date and not received. */
export default function OverdueTag({ days, tooltip }: { days?: number | null; tooltip?: string }) {
  if (!days || days <= 0) return null;
  const tag = (
    <Tag color="red" style={{ marginInlineEnd: 0, fontWeight: 600 }}>
      {days} day{days === 1 ? '' : 's'} late
    </Tag>
  );
  return tooltip ? <Tooltip title={tooltip}>{tag}</Tooltip> : tag;
}
