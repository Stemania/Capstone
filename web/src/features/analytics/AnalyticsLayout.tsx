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
  { label: 'Delays', value: '/analytics/delays' },
  { label: 'Forecast', value: '/analytics/forecast' },
  { label: 'Suppliers', value: '/analytics/suppliers' },
];

export default function AnalyticsLayout() {
  const [range, setRange] = useState<AnalyticsRange>(defaultAnalyticsRange);
  const navigate = useNavigate();
  const location = useLocation();

  const active = useMemo(
    () =>
      TABS.find((t) => t.value !== '/analytics' && location.pathname.startsWith(t.value))?.value ??
      '/analytics',
    [location.pathname]
  );

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
