import { shopToday } from '../../utils/shopTime';
import { Suspense, useMemo, useState } from 'react';
import { Button, DatePicker, Tooltip } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { PageSkeleton, TabBar } from '../../components/ui';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
  AnalyticsPeriodProvider,
  defaultAnalyticsRange,
  type AnalyticsRange,
} from './analyticsPeriod';
import './analytics.css';

/** Tabs follow objective 4: describe (Overview, Production), diagnose (Delays),
 *  predict (Sales & demand, Inventory), prescribe (Suppliers, Workers). */
const ADMIN_TABS = [
  { label: 'Overview', value: '/analytics' },
  { label: 'Production', value: '/analytics/production' },
  { label: 'Delays', value: '/analytics/delays' },
  { label: 'Sales & demand', value: '/analytics/sales' },
  { label: 'Inventory', value: '/analytics/inventory' },
  { label: 'Suppliers', value: '/analytics/suppliers' },
  { label: 'Workers', value: '/analytics/workers' },
  { label: 'Reports', value: '/analytics/reports' },
];

const OFFICE_TABS = [
  { label: 'Overview', value: '/analytics' },
  { label: 'Sales & demand', value: '/analytics/sales' },
  { label: 'Inventory', value: '/analytics/inventory' },
  { label: 'Suppliers', value: '/analytics/suppliers' },
  { label: 'Reports', value: '/analytics/reports' },
];

const PRESETS = [
  { label: 'Last 4 weeks', value: () => [shopToday().subtract(4, 'week'), shopToday()] },
  { label: 'Last 8 weeks', value: () => [shopToday().subtract(8, 'week'), shopToday()] },
  { label: 'Last 3 months', value: () => [shopToday().subtract(3, 'month'), shopToday()] },
  { label: 'This year', value: () => [shopToday().startOf('year'), shopToday()] },
].map((p) => ({ label: p.label, value: p.value() as [dayjs.Dayjs, dayjs.Dayjs] }));

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
  const noPeriod = active === '/analytics/reports' || active === '/analytics/inventory';

  return (
    <AnalyticsPeriodProvider range={range} setRange={setRange}>
      <div className="ui-page ui-page--stack analytics-page ana">
        <div className="ui-card analytics-page__toolbar ana-toolbar no-print">
          <TabBar<string>
            items={tabs.map((t) => ({ label: t.label, value: t.value }))}
            value={active}
            onChange={(v) => navigate(v)}
          />
          {!noPeriod && (
            <div className="ana-toolbar__right">
              <DatePicker.RangePicker
                value={range}
                allowClear={false}
                format="MMM D, YYYY"
                aria-label="Period"
                presets={PRESETS}
                onChange={(vals) => {
                  if (vals?.[0] && vals?.[1]) {
                    setRange([vals[0].startOf('day'), vals[1].endOf('day')]);
                  }
                }}
                disabledDate={(d) => d.isAfter(shopToday(), 'day')}
              />
              <Tooltip title="Print this tab">
                <Button icon={<PrinterOutlined />} aria-label="Print this tab" onClick={() => window.print()} />
              </Tooltip>
            </div>
          )}
        </div>
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </div>
    </AnalyticsPeriodProvider>
  );
}
