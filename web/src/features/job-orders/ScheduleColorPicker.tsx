import { Popover } from 'antd';

export const DEFAULT_SCHEDULE_COLOR = '#2563eb';

/** Single default palette — distinct hues that stay readable on the board. */
export const SCHEDULE_COLOR_PALETTE = [
  '#2563eb', // blue (default)
  '#0d9488', // teal
  '#7c3aed', // violet
  '#db2777', // pink
  '#ea580c', // orange
  '#ca8a04', // gold
  '#16a34a', // green
  '#dc2626', // red
  '#0891b2', // cyan
  '#4f46e5', // indigo
  '#9333ea', // purple
  '#64748b', // slate
] as const;

type Props = {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
};

export default function ScheduleColorPicker({ value, onChange, disabled }: Props) {
  const selected = value || DEFAULT_SCHEDULE_COLOR;

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      title="Schedule color"
      content={
        <div className="jo-sched-color__grid" role="listbox" aria-label="Schedule colors">
          {SCHEDULE_COLOR_PALETTE.map((color) => {
            const active = color.toLowerCase() === selected.toLowerCase();
            return (
              <button
                key={color}
                type="button"
                role="option"
                aria-selected={active}
                aria-label={color}
                className={`jo-sched-color__swatch${active ? ' jo-sched-color__swatch--active' : ''}`}
                style={{ background: color }}
                onClick={() => onChange(color)}
              />
            );
          })}
        </div>
      }
    >
      <button
        type="button"
        className="jo-sched-color__trigger"
        aria-label="Choose schedule color"
        title="Schedule color"
        disabled={disabled}
        style={{ background: selected }}
      />
    </Popover>
  );
}
