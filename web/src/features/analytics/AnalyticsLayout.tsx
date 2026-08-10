import { useMemo, useState } from 'react';
import { DatePicker, Segmented } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  AnalyticsPeriodProvider,
  defaultAnalyticsRange,
  type AnalyticsRange,
} from './analyticsPeriod';

const TABS = [
  { label: 'Overview', value: '/analytics' },
  { label: 'Efficiency', value: '/analytics/efficiency' },
  { label: 'Delays', value: '/analytics/delays' },
];

export default function AnalyticsLayout() {
  const [range, setRange] = useState<AnalyticsRange>(defaultAnalyticsRange);
  const navigate = useNavigate();
  const location = useLocation();

  const active = useMemo(() => {
    if (location.pathname.startsWith('/analytics/efficiency')) return '/analytics/efficiency';
    if (location.pathname.startsWith('/analytics/delays')) return '/analytics/delays';
    return '/analytics';
  }, [location.pathname]);

  return (
    <AnalyticsPeriodProvider range={range} setRange={setRange}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Segmented
            options={TABS.map((t) => ({ label: t.label, value: t.value }))}
            value={active}
            onChange={(v) => navigate(String(v))}
            size="large"
          />
          <DatePicker.RangePicker
            value={range}
            allowClear={false}
            format="YYYY-MM-DD"
            onChange={(vals) => {
              if (vals?.[0] && vals?.[1]) {
                setRange([vals[0].startOf('day'), vals[1].endOf('day')]);
              }
            }}
            disabledDate={(d) => d.isAfter(dayjs(), 'day')}
            size="large"
          />
        </div>
        <Outlet />
      </div>
    </AnalyticsPeriodProvider>
  );
}
