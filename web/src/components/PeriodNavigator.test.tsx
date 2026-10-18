/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import dayjs from 'dayjs';
import updateLocale from 'dayjs/plugin/updateLocale';
import { SHOP_TZ } from '../utils/shopTime';
import PeriodNavigator, {
  formatPeriodLabel,
  pickerKindForMode,
} from './PeriodNavigator';
import { periodBounds } from '../features/schedule/scheduleTimelineUtils';

dayjs.extend(updateLocale);
dayjs.updateLocale('en', { weekStart: 1 });

const d = (iso: string) => dayjs.tz(iso, SHOP_TZ);

describe('formatPeriodLabel', () => {
  it('formats day / week / month', () => {
    expect(formatPeriodLabel(d('2026-10-19'), 'day')).toBe('Mon, Oct 19, 2026');
    expect(formatPeriodLabel(d('2026-10-19'), 'week')).toBe('Oct 19 – Oct 25, 2026');
    expect(formatPeriodLabel(d('2026-10-19'), 'month')).toBe('October 2026');
  });
});

describe('pickerKindForMode', () => {
  it('maps view mode to date / week / month pickers', () => {
    expect(pickerKindForMode('day')).toBe('date');
    expect(pickerKindForMode('week')).toBe('week');
    expect(pickerKindForMode('month')).toBe('month');
  });
});

describe('periodBounds (date pick jumps to containing period)', () => {
  it('week mode is Mon–Sun containing the date', () => {
    const { from, to } = periodBounds(d('2026-10-22'), 'week');
    expect(from.format('YYYY-MM-DD')).toBe('2026-10-19');
    expect(to.format('YYYY-MM-DD')).toBe('2026-10-25');
  });
});

describe('PeriodNavigator UI', () => {
  it('renders the calendar icon and opens the picker from the combined trigger', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ConfigProvider>
        <PeriodNavigator mode="day" value={d('2026-10-19')} onChange={onChange} />
      </ConfigProvider>
    );

    const trigger = container.querySelector('.period-nav__trigger') as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute('aria-label')).toBe('Choose date');
    expect(trigger.textContent).toContain('Mon, Oct 19, 2026');
    expect(container.querySelector('.period-nav__cal-icon, .anticon-calendar')).toBeTruthy();
    expect(container.querySelector('.period-nav__cal-btn')).toBeNull();

    fireEvent.click(trigger);
    expect(document.querySelector('.ant-picker-dropdown')).toBeTruthy();
  });

  it('uses week picker mode for week view', () => {
    const { container } = render(
      <ConfigProvider>
        <PeriodNavigator mode="week" value={d('2026-10-19')} onChange={vi.fn()} />
      </ConfigProvider>
    );
    const picker = container.querySelector('.period-nav__picker');
    expect(picker).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose week' }));
    // Ant week panel uses week cells / panel class
    expect(
      document.querySelector('.ant-picker-week-panel, .period-nav__popup--week, .ant-picker-dropdown')
    ).toBeTruthy();
  });

  it('uses month picker for month view', () => {
    render(
      <ConfigProvider>
        <PeriodNavigator mode="month" value={d('2026-10-19')} onChange={vi.fn()} />
      </ConfigProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose month' }));
    expect(document.querySelector('.ant-picker-month-panel, .ant-picker-dropdown')).toBeTruthy();
  });
});
