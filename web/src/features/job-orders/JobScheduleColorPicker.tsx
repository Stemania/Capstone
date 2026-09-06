import { ColorPicker, Tooltip } from 'antd';
import type { Color } from 'antd/es/color-picker';

export const DEFAULT_SCHEDULE_COLOR = '#2563EB';

export const SCHEDULE_COLOR_PRESETS = [
  '#2563EB',
  '#0D9488',
  '#D97706',
  '#DC2626',
  '#7C3AED',
  '#DB2777',
  '#0891B2',
  '#65A30D',
  '#EA580C',
  '#4F46E5',
  '#0F766E',
  '#BE185D',
];

type Props = {
  value?: string | null;
  onChange: (hex: string) => void;
  disabled?: boolean;
};

export default function JobScheduleColorPicker({ value, onChange, disabled }: Props) {
  const color = value || DEFAULT_SCHEDULE_COLOR;

  const handleChange = (c: Color) => {
    onChange(c.toHexString().toUpperCase());
  };

  return (
    <Tooltip title="Schedule color for this job">
      <ColorPicker
        value={color}
        onChangeComplete={handleChange}
        disabled={disabled}
        disabledAlpha
        presets={[{ label: 'Schedule', colors: SCHEDULE_COLOR_PRESETS }]}
        trigger="click"
        arrow={false}
        placement="bottomRight"
      >
        <button
          type="button"
          className="jo-sched-color-btn"
          style={{ background: color }}
          aria-label="Choose schedule color"
          disabled={disabled}
        />
      </ColorPicker>
    </Tooltip>
  );
}
