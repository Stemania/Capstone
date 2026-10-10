import { shopToday } from '../../utils/shopTime';
import { Suspense, useMemo, useState } from 'react';
import { DatePicker } from 'antd';
import { PageSkeleton, TabBar } from '../../components/ui';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
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
  { label: 'Reports', value: '/analytics/reports' },
];

const OFFICE_TABS = [
  { label: 'Job orders & sales', value: '/analytics/sales' },
  { label: 'Forecast', value: '/analytics/forecast' },
  { label: 'Suppliers & purchasing', value: '/analytics/suppliers' },
  { label: 'Reports', value: '/analytics/reports' },
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
  const onReports = active === '/analytics/reports';

  return (
    <AnalyticsPeriodProvider range={range} setRange={setRange}>
      <div className="ui-page ui-page--stack analytics-page">
        <div className="ui-card analytics-page__toolbar no-print">
          <TabBar<string>
            items={tabs.map((t) => ({ label: t.label, value: t.value }))}
            value={active}
            onChange={(v) => navigate(v)}
          />
          {!onReports && (
            <DatePicker.RangePicker
              value={range}
              allowClear={false}
              format="MMM D, YYYY"
              aria-label="Period"
              onChange={(vals) => {
                if (vals?.[0] && vals?.[1]) {
                  setRange([vals[0].startOf('day'), vals[1].endOf('day')]);
                }
              }}
              disabledDate={(d) => d.isAfter(shopToday(), 'day')}
            />
          )}
        </div>
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </div>
    </AnalyticsPeriodProvider>
  );
}
