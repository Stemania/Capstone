import { Suspense, useMemo, useState } from 'react';
import { DatePicker, Segmented, Spin } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  AnalyticsPeriodProvider,
  defaultAnalyticsRange,
  type AnalyticsRange,
} from './analyticsPeriod';

const TABS = [
  { label: 'Overview', value: '/analytics' },
  { label: 'Performance', value: '/analytics/efficiency' },
  { label: 'Delays', value: '/analytics/delays' },
  { label: 'Sales', value: '/analytics/sales' },
  { label: 'What’s coming', value: '/analytics/forecast' },
  { label: 'Machine load', value: '/analytics/capacity' },
];

export default function AnalyticsLayout() {
  const [range, setRange] = useState<AnalyticsRange>(defaultAnalyticsRange);
  const navigate = useNavigate();
  const location = useLocation();

  const active = useMemo(() => {
    if (location.pathname.startsWith('/analytics/efficiency')) return '/analytics/efficiency';
    if (location.pathname.startsWith('/analytics/delays')) return '/analytics/delays';
    if (location.pathname.startsWith('/analytics/sales')) return '/analytics/sales';
    if (location.pathname.startsWith('/analytics/forecast')) return '/analytics/forecast';
    if (location.pathname.startsWith('/analytics/capacity')) return '/analytics/capacity';
    return '/analytics';
  }, [location.pathname]);

  return (
    <AnalyticsPeriodProvider range={range} setRange={setRange}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          className="admin-h-scroll"
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
        <Suspense
          fallback={
            <div style={{ padding: 48, textAlign: 'center' }}>
              <Spin size="large" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </div>
    </AnalyticsPeriodProvider>
  );
}
