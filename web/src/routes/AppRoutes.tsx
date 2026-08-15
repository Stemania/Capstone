import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { AuthProvider } from '../hooks/useAuth';
import { ProtectedRoute } from './ProtectedRoute';
import RoleAwareLayout from './RoleAwareLayout';
import AppLayout from '../layouts/AppLayout';
import WorkerLayout from '../layouts/WorkerLayout';
import MyToolsPage from '../features/tool-tracking/MyToolsPage';
import LoginPage from '../features/auth/LoginPage';
import JobOrderListPage from '../features/job-orders/JobOrderListPage';
import JobOrderFormPage from '../features/job-orders/JobOrderFormPage';
import JobOrderPlanningPage from '../features/job-orders/JobOrderPlanningPage';
import JobOrderDetailPage from '../features/job-orders/JobOrderDetailPage';
import MyAssignmentsPage from '../features/my-assignments/MyAssignmentsPage';
import AssignmentDetailPage from '../features/my-assignments/AssignmentDetailPage';
import UsersPage from '../features/users/UsersPage';
import WorkerDetailPage from '../features/users/WorkerDetailPage';
import ToolsPage from '../features/tool-tracking/ToolsPage';
import ScanToolPage from '../features/tool-tracking/ScanToolPage';
import ScoringWeightsPage from '../features/settings/ScoringWeightsPage';
import ClientsPage from '../features/clients/ClientsPage';
import MachinesPage from '../features/machines/MachinesPage';
import ScheduleBoardPage from '../features/schedule/ScheduleBoardPage';
import ReportsHubPage from '../features/reports/ReportsHubPage';
import EfficiencyReportPage from '../features/reports/EfficiencyReportPage';
import InventoryReportPage from '../features/reports/InventoryReportPage';
import WorkerPerformanceReportPage from '../features/reports/WorkerPerformanceReportPage';
import JobOrderPrintPage from '../features/reports/JobOrderPrintPage';

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
            <Route
              element={
                <ProtectedRoute roles={['ADMIN', 'OFFICE_STAFF', 'PRODUCTION_WORKER']} />
              }
            >
              <Route path="/job-orders/:id/print" element={<JobOrderPrintPage />} />
            </Route>

            {/* Shared paths — one match for all roles; layout switches by role */}
            <Route
              element={
                <ProtectedRoute roles={['ADMIN', 'OFFICE_STAFF', 'PRODUCTION_WORKER']} />
              }
            >
              <Route element={<RoleAwareLayout />}>
                <Route path="/schedule" element={<ScheduleBoardPage />} />
                <Route path="/job-orders/:id" element={<JobOrderDetailPage />} />
              </Route>
            </Route>

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
                <Route path="/tools" element={<ToolsPage />} />
                <Route path="/clients" element={<ClientsPage />} />
                <Route path="/machines" element={<MachinesPage />} />
                <Route path="/reports" element={<ReportsHubPage />} />
                <Route path="/reports/efficiency" element={<EfficiencyReportPage />} />
                <Route path="/reports/inventory" element={<InventoryReportPage />} />
                <Route
                  path="/reports/worker-performance"
                  element={<WorkerPerformanceReportPage />}
                />
              </Route>

              <Route element={<ProtectedRoute roles={['ADMIN']} />}>
                <Route path="/job-orders/:id/plan" element={<JobOrderPlanningPage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/users/:id" element={<WorkerDetailPage />} />
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
