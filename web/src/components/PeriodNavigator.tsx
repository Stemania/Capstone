import { useMemo, useRef, useState } from 'react';
import { Button, DatePicker } from 'antd';
import { CalendarOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import updateLocale from 'dayjs/plugin/updateLocale';
import { periodBounds, type TimelineViewMode } from '../features/schedule/scheduleTimelineUtils';
import './periodNavigator.css';

dayjs.extend(updateLocale);
// Schedule weeks are Mon–Sun; keep the week picker aligned.
dayjs.updateLocale('en', { weekStart: 1 });

export type PeriodMode = TimelineViewMode;

/** Ant DatePicker mode for each schedule view. */
export function pickerKindForMode(mode: PeriodMode): 'date' | 'week' | 'month' {
  if (mode === 'week') return 'week';
  if (mode === 'month') return 'month';
  return 'date';
}

/** Bold period label for Day / Week / Month. */
export function formatPeriodLabel(anchor: Dayjs, mode: PeriodMode): string {
  const { from, to } = periodBounds(anchor, mode);
  if (mode === 'day') return from.format('ddd, MMM D, YYYY');
  if (mode === 'month') return from.format('MMMM YYYY');
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
 * Label and icon both open the picker; mode picks date / week / month.
 */
export default function PeriodNavigator({
  mode,
  value,
  onChange,
  onStep,
  className,
  hidePicker,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLButtonElement>(null);
  const label = formatPeriodLabel(value, mode);
  const picker = pickerKindForMode(mode);

  const step = (delta: -1 | 1) => {
    if (onStep) {
      onStep(delta);
      return;
    }
    if (mode === 'day') onChange(value.add(delta, 'day'));
    else if (mode === 'week') onChange(value.add(delta, 'week'));
    else onChange(value.add(delta, 'month').startOf('month'));
  };

  const applyPicked = (d: Dayjs | null) => {
    if (!d) return;
    if (mode === 'month') onChange(d.startOf('month'));
    else if (mode === 'week') {
      // Ant week value is the week's start under weekStart=1 (Monday).
      onChange(d.startOf('week'));
    } else onChange(d.startOf('day'));
    setOpen(false);
  };

  const pickerValue = useMemo(() => {
    if (mode === 'week') return value.startOf('week');
    if (mode === 'month') return value.startOf('month');
    return value.startOf('day');
  }, [mode, value]);

  const openPicker = () => setOpen(true);

  const chooseLabel =
    mode === 'month' ? 'Choose month' : mode === 'week' ? 'Choose week' : 'Choose date';

  return (
    <div
      ref={wrapRef}
      className={`period-nav${className ? ` ${className}` : ''}${open ? ' is-open' : ''}`}
    >
      <Button
        type="text"
        icon={<LeftOutlined />}
        onClick={() => step(-1)}
        aria-label={mode === 'month' ? 'Previous month' : 'Previous period'}
      />
      {!hidePicker ? (
        <>
          <button
            ref={labelRef}
            type="button"
            className="period-nav__label"
            onClick={openPicker}
            aria-label={chooseLabel}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            {label}
          </button>
          <Button
            type="text"
            className="period-nav__cal-btn"
            icon={<CalendarOutlined className="period-nav__cal-icon" />}
            onClick={openPicker}
            aria-label="Choose date"
            aria-haspopup="dialog"
            aria-expanded={open}
          />
          {/* Invisible controlled picker — opened by label / icon, anchored under label. */}
          <DatePicker
            picker={picker}
            value={pickerValue}
            open={open}
            onOpenChange={setOpen}
            allowClear={false}
            inputReadOnly
            suffixIcon={null}
            onChange={applyPicked}
            className="period-nav__picker"
            classNames={{
              popup: {
                root:
                  mode === 'week'
                    ? 'period-nav__popup period-nav__popup--week'
                    : 'period-nav__popup',
              },
            }}
            getPopupContainer={() => labelRef.current || wrapRef.current || document.body}
            aria-hidden
            tabIndex={-1}
            format={() => ''}
          />
        </>
      ) : (
        <span className="period-nav__label period-nav__label--static" aria-live="polite">
          {label}
        </span>
      )}
      <Button
        type="text"
        icon={<RightOutlined />}
        onClick={() => step(1)}
        aria-label={mode === 'month' ? 'Next month' : 'Next period'}
      />
    </div>
  );
}
