import { Suspense, useMemo, useState } from 'react';
import { DatePicker, Segmented, Spin } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { useAuth } from '../../hooks/useAuth';
import {
  AnalyticsPeriodProvider,
  defaultAnalyticsRange,
  type AnalyticsRange,
} from './analyticsPeriod';

const ADMIN_TABS = [
  { label: 'Production', value: '/analytics' },
  { label: 'Delays', value: '/analytics/delays' },
  { label: 'Job orders & sales', value: '/analytics/sales' },
  { label: 'Forecast', value: '/analytics/forecast' },
  { label: 'Suppliers', value: '/analytics/suppliers' },
];

const OFFICE_TABS = [
  { label: 'Job orders & sales', value: '/analytics/sales' },
  { label: 'Forecast', value: '/analytics/forecast' },
  { label: 'Suppliers & purchasing', value: '/analytics/suppliers' },
];

export default function AnalyticsLayout() {
  const [range, setRange] = useState<AnalyticsRange>(defaultAnalyticsRange);
  const navigate = useNavigate();
  const location = useLocation();
  const tabs = useAuth().user?.role === 'ADMIN' ? ADMIN_TABS : OFFICE_TABS;

  const active = useMemo(
    () =>
      tabs.find((t) => t.value !== '/analytics' && location.pathname.startsWith(t.value))?.value ??
      tabs[0].value,
    [location.pathname, tabs]
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
            options={tabs.map((t) => ({ label: t.label, value: t.value }))}
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
