import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { AuthProvider } from '../hooks/useAuth';
import { ProtectedRoute } from './ProtectedRoute';
import AppLayout from '../layouts/AppLayout';
import WorkerLayout from '../layouts/WorkerLayout';
import MyToolsPage from '../features/tool-tracking/MyToolsPage';
import LoginPage from '../features/auth/LoginPage';
import JobOrderListPage from '../features/job-orders/JobOrderListPage';
import JobOrderFormPage from '../features/job-orders/JobOrderFormPage';
import MyAssignmentsPage from '../features/my-assignments/MyAssignmentsPage';
import AssignmentDetailPage from '../features/my-assignments/AssignmentDetailPage';
import UsersPage from '../features/users/UsersPage';
import WorkerDetailPage from '../features/users/WorkerDetailPage';
import ToolsPage from '../features/tool-tracking/ToolsPage';
import ScanToolPage from '../features/tool-tracking/ScanToolPage';
import ScoringWeightsPage from '../features/settings/ScoringWeightsPage';

const AnalyticsLayout = lazy(() => import('../features/analytics/AnalyticsLayout'));
const AnalyticsOverviewPage = lazy(() => import('../features/analytics/AnalyticsOverviewPage'));
const AnalyticsEfficiencyPage = lazy(() => import('../features/analytics/AnalyticsEfficiencyPage'));
const AnalyticsDelaysPage = lazy(() => import('../features/analytics/AnalyticsDelaysPage'));
const AnalyticsSalesPage = lazy(() => import('../features/analytics/AnalyticsSalesPage'));
const AnalyticsForecastPage = lazy(() => import('../features/analytics/AnalyticsForecastPage'));
const AnalyticsCapacityPage = lazy(() => import('../features/analytics/AnalyticsCapacityPage'));

function AnalyticsSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 48, textAlign: 'center' }}>
          <Spin size="large" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route element={<ProtectedRoute roles={['ADMIN', 'OFFICE_STAFF']} />}>
                <Route path="/job-orders" element={<JobOrderListPage />} />
                <Route path="/job-orders/new" element={<JobOrderFormPage />} />
                <Route path="/job-orders/:id/edit" element={<JobOrderFormPage />} />
                <Route
                  path="/analytics"
                  element={
                    <AnalyticsSuspense>
                      <AnalyticsLayout />
                    </AnalyticsSuspense>
                  }
                >
                  <Route index element={<AnalyticsOverviewPage />} />
                  <Route path="efficiency" element={<AnalyticsEfficiencyPage />} />
                  <Route path="delays" element={<AnalyticsDelaysPage />} />
                  <Route path="sales" element={<AnalyticsSalesPage />} />
                  <Route path="forecast" element={<AnalyticsForecastPage />} />
                  <Route path="capacity" element={<AnalyticsCapacityPage />} />
                </Route>
              </Route>

              <Route element={<ProtectedRoute roles={['ADMIN']} />}>
                <Route path="/users" element={<UsersPage />} />
                <Route path="/users/:id" element={<WorkerDetailPage />} />
                <Route path="/tools" element={<ToolsPage />} />
                <Route path="/settings/scoring-weights" element={<ScoringWeightsPage />} />
              </Route>

              <Route path="/" element={<Navigate to="/login" replace />} />
            </Route>

            <Route element={<ProtectedRoute roles={['PRODUCTION_WORKER']} />}>
              <Route element={<WorkerLayout />}>
                <Route path="/my-assignments" element={<MyAssignmentsPage />} />
                <Route path="/my-assignments/:id" element={<AssignmentDetailPage />} />
                <Route path="/scan" element={<ScanToolPage />} />
                <Route path="/my-tools" element={<MyToolsPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
