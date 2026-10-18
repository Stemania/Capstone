import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useParams } from 'react-router-dom';
import { OfflineProvider } from '../offline/OfflineProvider';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import IdleSessionWatcher from '../auth/IdleSessionWatcher';
import { ProtectedRoute } from './ProtectedRoute';
import RoleAwareLayout from './RoleAwareLayout';
import { NavMemoryProvider } from '../navigation/navMemory';
import InventoryPage from '../features/worker/InventoryPage';
import WorkerHomePage from '../features/worker/WorkerHomePage';
import WorkerProfilePage from '../features/worker/WorkerProfilePage';
import LoginPage from '../features/auth/LoginPage';
import SetPasswordPage from '../features/auth/SetPasswordPage';
import ForgotPasswordPage from '../features/auth/ForgotPasswordPage';
import ResetPasswordPage from '../features/auth/ResetPasswordPage';
import PrivacyPolicyPage from '../features/auth/PrivacyPolicyPage';
import AccountSecurityPage from '../features/auth/AccountSecurityPage';
import JobOrderListPage from '../features/job-orders/JobOrderListPage';
import JobOrderFormPage from '../features/job-orders/JobOrderFormPage';
import JobOrderPlanningPage from '../features/job-orders/JobOrderPlanningPage';
import JobOrderDetailPage from '../features/job-orders/JobOrderDetailPage';
import MyAssignmentsPage from '../features/my-assignments/MyAssignmentsPage';
import AssignmentDetailPage from '../features/my-assignments/AssignmentDetailPage';
import UsersPage from '../features/users/UsersPage';
import WorkerSetupPage from '../features/workers/WorkerSetupPage';
import AttendancePage from '../features/attendance/AttendancePage';
import ShopDetailsPage from '../features/settings/ShopDetailsPage';
import ToolsPage from '../features/tool-tracking/ToolsPage';
import ScanToolPage from '../features/tool-tracking/ScanToolPage';
import ClientsPage from '../features/clients/ClientsPage';
import ClientDetailPage from '../features/clients/ClientDetailPage';
import SuppliersAndOrdersPage from '../features/suppliers/SuppliersAndOrdersPage';
import SupplierOrderDetailPage from '../features/supplier-orders/SupplierOrderDetailPage';
import SupplierOrderPrintPage from '../features/reports/SupplierOrderPrintPage';
import MachinesPage from '../features/machines/MachinesPage';
import WorkCalendarPage from '../features/calendar/WorkCalendarPage';
import ScheduleBoardPage from '../features/schedule/ScheduleBoardPage';
import DashboardPage from '../features/dashboard/DashboardPage';
import ReportsHubPage from '../features/reports/ReportsHubPage';
import EfficiencyReportPage from '../features/reports/EfficiencyReportPage';
import InventoryReportPage from '../features/reports/InventoryReportPage';
import WorkerPerformanceReportPage from '../features/reports/WorkerPerformanceReportPage';
import JobOrderPrintPage from '../features/reports/JobOrderPrintPage';
import { PageSkeleton } from '../components/ui';
const AnalyticsLayout = lazy(() => import('../features/analytics/AnalyticsLayout'));
const AnalyticsOverviewPage = lazy(() => import('../features/analytics/AnalyticsOverviewPage'));
const AnalyticsProductionPage = lazy(() => import('../features/analytics/AnalyticsProductionPage'));
const AnalyticsDelaysPage = lazy(() => import('../features/analytics/AnalyticsDelaysPage'));
const AnalyticsSalesPage = lazy(() => import('../features/analytics/AnalyticsSalesPage'));
const AnalyticsInventoryPage = lazy(() => import('../features/analytics/AnalyticsInventoryPage'));
const AnalyticsSuppliersPage = lazy(() => import('../features/analytics/AnalyticsSuppliersPage'));

function ReportsRedirect() {
  const rest = useParams()['*'];
  return <Navigate to={rest ? `/analytics/reports/${rest}` : '/analytics/reports'} replace />;
}

function WorkerSetupFromUser() {
  const { id } = useParams();
  return <Navigate to={id ? `/worker-setup?tab=roster&worker=${id}` : '/worker-setup'} replace />;
}

/** Workers already get the offline queue from their layout; an Admin recording work needs it here. */
function AssignmentsShell() {
  const { isWorker } = useAuth();
  if (isWorker) return <Outlet />;
  return (
    <OfflineProvider>
      <Outlet />
    </OfflineProvider>
  );
}

function AnalyticsSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <PageSkeleton variant="cards" />
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
        <IdleSessionWatcher />
        <NavMemoryProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/set-password" element={<SetPasswordPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />

            <Route element={<ProtectedRoute />}>
              <Route
                element={
                  <ProtectedRoute roles={['ADMIN', 'OFFICE_STAFF', 'PRODUCTION_WORKER']} />
                }
              >
                <Route path="/job-orders/:id/print" element={<JobOrderPrintPage />} />
              </Route>
              <Route element={<ProtectedRoute roles={['ADMIN', 'OFFICE_STAFF']} />}>
                <Route
                  path="/supplier-orders/:id/print"
                  element={<SupplierOrderPrintPage />}
                />
              </Route>

              {/*
                Single RoleAwareLayout so office AppLayout (and worker shell) stay
                mounted across section switches — enables keep-alive + last-path nav.
              */}
              <Route
                element={
                  <ProtectedRoute roles={['ADMIN', 'OFFICE_STAFF', 'PRODUCTION_WORKER']} />
                }
              >
                <Route element={<RoleAwareLayout />}>
                  <Route path="/schedule" element={<ScheduleBoardPage />} />
                  <Route path="/account/security" element={<AccountSecurityPage />} />

                  <Route element={<ProtectedRoute roles={['ADMIN', 'OFFICE_STAFF']} />}>
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/job-orders" element={<JobOrderListPage />} />
                    <Route
                      path="/job-orders/archived"
                      element={<JobOrderListPage mode="archived" />}
                    />
                    <Route element={<ProtectedRoute roles={['OFFICE_STAFF']} />}>
                      <Route path="/job-orders/new" element={<JobOrderFormPage />} />
                    </Route>
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
                      <Route element={<ProtectedRoute roles={['ADMIN']} />}>
                        <Route path="production" element={<AnalyticsProductionPage />} />
                        <Route path="delays" element={<AnalyticsDelaysPage />} />
                      </Route>
                      <Route path="workers" element={<Navigate to="/analytics/production" replace />} />
                      <Route path="sales" element={<AnalyticsSalesPage />} />
                      <Route path="inventory" element={<AnalyticsInventoryPage />} />
                      <Route path="suppliers" element={<AnalyticsSuppliersPage />} />
                      <Route path="reports" element={<ReportsHubPage />} />
                      <Route path="reports/inventory" element={<InventoryReportPage />} />
                      <Route element={<ProtectedRoute roles={['ADMIN']} />}>
                        <Route path="reports/efficiency" element={<EfficiencyReportPage />} />
                        <Route
                          path="reports/worker-performance"
                          element={<WorkerPerformanceReportPage />}
                        />
                      </Route>
                      <Route path="efficiency" element={<Navigate to="/analytics/production" replace />} />
                      <Route path="capacity" element={<Navigate to="/analytics/production" replace />} />
                      <Route path="forecast" element={<Navigate to="/analytics/sales" replace />} />
                      <Route path="purchasing" element={<Navigate to="/analytics/suppliers" replace />} />
                    </Route>
                    <Route path="/tools" element={<ToolsPage />} />
                    <Route path="/clients" element={<ClientsPage />} />
                    <Route path="/clients/:id" element={<ClientDetailPage />} />
                    <Route path="/suppliers" element={<SuppliersAndOrdersPage />} />
                    <Route path="/supplier-orders" element={<SuppliersAndOrdersPage />} />
                    <Route path="/supplier-orders/:id" element={<SupplierOrderDetailPage />} />
                    <Route path="/machines" element={<MachinesPage />} />
                    <Route path="/work-calendar" element={<WorkCalendarPage />} />
                    <Route path="/reports/*" element={<ReportsRedirect />} />
                  </Route>

                  <Route element={<ProtectedRoute roles={['ADMIN']} />}>
                    <Route path="/job-orders/:id/plan" element={<JobOrderPlanningPage />} />
                    <Route path="/users" element={<UsersPage />} />
                    <Route path="/users/:id" element={<WorkerSetupFromUser />} />
                    <Route path="/worker-setup" element={<WorkerSetupPage />} />
                    <Route path="/attendance" element={<AttendancePage />} />
                    <Route path="/settings/shop" element={<ShopDetailsPage />} />
                    <Route
                      path="/settings/scoring-weights"
                      element={<Navigate to="/worker-setup" replace />}
                    />
                  </Route>

                  {/* After /new, /edit, /plan so :id does not steal those paths */}
                  <Route path="/job-orders/:id" element={<JobOrderDetailPage />} />

                  <Route element={<ProtectedRoute roles={['PRODUCTION_WORKER', 'ADMIN']} />}>
                    <Route element={<AssignmentsShell />}>
                      <Route path="/my-assignments" element={<MyAssignmentsPage />} />
                      <Route path="/my-assignments/:id" element={<AssignmentDetailPage />} />
                    </Route>
                  </Route>

                  <Route element={<ProtectedRoute roles={['PRODUCTION_WORKER']} />}>
                    <Route path="/home" element={<WorkerHomePage />} />
                    <Route path="/scan" element={<ScanToolPage />} />
                    <Route path="/inventory" element={<InventoryPage />} />
                    <Route path="/my-tools" element={<Navigate to="/inventory" replace />} />
                    <Route path="/account/profile" element={<WorkerProfilePage />} />
                  </Route>

                  <Route path="/" element={<Navigate to="/login" replace />} />
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </NavMemoryProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
