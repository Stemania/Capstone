import { Button, DatePicker } from 'antd';
import { CalendarOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { periodBounds, type TimelineViewMode } from '../features/schedule/scheduleTimelineUtils';
import './periodNavigator.css';

export type PeriodMode = TimelineViewMode;

/** Bold period label for Day / Week / Month. */
export function formatPeriodLabel(anchor: Dayjs, mode: PeriodMode): string {
  const { from, to } = periodBounds(anchor, mode);
  if (mode === 'day') return from.format('ddd, MMM D, YYYY');
  if (mode === 'month') return from.format('MMMM YYYY');
  // Week: same year → "MMM D – MMM D, YYYY"; cross-year rare
  if (from.year() === to.year()) {
    return `${from.format('MMM D')} – ${to.format('MMM D, YYYY')}`;
  }
  return `${from.format('MMM D, YYYY')} – ${to.format('MMM D, YYYY')}`;
}

type Props = {
  mode: PeriodMode;
  value: Dayjs;
  onChange: (next: Dayjs) => void;
  /** Step when clicking ‹ / › (defaults to one period). */
  onStep?: (delta: -1 | 1) => void;
  className?: string;
  /** Hide the calendar icon button (rare). */
  hidePicker?: boolean;
};

/**
 * Shared ‹  bold label  📅  › navigator used on Schedule and Work calendar.
 * Picking a date jumps to the period that contains it.
 */
export default function PeriodNavigator({
  mode,
  value,
  onChange,
  onStep,
  className,
  hidePicker,
}: Props) {
  const label = formatPeriodLabel(value, mode);
  const step = (delta: -1 | 1) => {
    if (onStep) {
      onStep(delta);
      return;
    }
    if (mode === 'day') onChange(value.add(delta, 'day'));
    else if (mode === 'week') onChange(value.add(delta, 'week'));
    else onChange(value.add(delta, 'month').startOf('month'));
  };

  return (
    <div className={`period-nav${className ? ` ${className}` : ''}`}>
      <Button
        type="text"
        icon={<LeftOutlined />}
        onClick={() => step(-1)}
        aria-label={mode === 'month' ? 'Previous month' : 'Previous period'}
      />
      <span className="period-nav__label" aria-live="polite">
        {label}
      </span>
      {!hidePicker ? (
        <DatePicker
          picker={mode === 'month' ? 'month' : 'date'}
          value={value}
          allowClear={false}
          inputReadOnly
          suffixIcon={<CalendarOutlined />}
          onChange={(d) => {
            if (!d) return;
            onChange(mode === 'month' ? d.startOf('month') : d.startOf('day'));
          }}
          className="period-nav__picker"
          aria-label={mode === 'month' ? 'Jump to month' : 'Jump to date'}
          // Hide the typed value; the bold label is the source of truth.
          format={() => ''}
        />
      ) : null}
      <Button
        type="text"
        icon={<RightOutlined />}
        onClick={() => step(1)}
        aria-label={mode === 'month' ? 'Next month' : 'Next period'}
      />
    </div>
  );
}
