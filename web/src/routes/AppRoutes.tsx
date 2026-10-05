import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { Spin } from 'antd';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { ProtectedRoute } from './ProtectedRoute';
import RoleAwareLayout from './RoleAwareLayout';
import { NavMemoryProvider } from '../navigation/navMemory';
import MyToolsPage from '../features/tool-tracking/MyToolsPage';
import LoginPage from '../features/auth/LoginPage';
import SetPasswordPage from '../features/auth/SetPasswordPage';
import ForgotPasswordPage from '../features/auth/ForgotPasswordPage';
import ResetPasswordPage from '../features/auth/ResetPasswordPage';
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
import ToolsPage from '../features/tool-tracking/ToolsPage';
import ScanToolPage from '../features/tool-tracking/ScanToolPage';
import ClientsPage from '../features/clients/ClientsPage';
import ClientDetailPage from '../features/clients/ClientDetailPage';
import SuppliersPage from '../features/suppliers/SuppliersPage';
import SupplierOrdersPage from '../features/supplier-orders/SupplierOrdersPage';
import SupplierOrderDetailPage from '../features/supplier-orders/SupplierOrderDetailPage';
import SupplierOrderPrintPage from '../features/reports/SupplierOrderPrintPage';
import MachinesPage from '../features/machines/MachinesPage';
import WorkCalendarPage from '../features/calendar/WorkCalendarPage';
import ScheduleBoardPage from '../features/schedule/ScheduleBoardPage';
import ReportsHubPage from '../features/reports/ReportsHubPage';
import EfficiencyReportPage from '../features/reports/EfficiencyReportPage';
import InventoryReportPage from '../features/reports/InventoryReportPage';
import WorkerPerformanceReportPage from '../features/reports/WorkerPerformanceReportPage';
import JobOrderPrintPage from '../features/reports/JobOrderPrintPage';
import SalesInvoicePrintPage from '../features/reports/SalesInvoicePrintPage';

const AnalyticsLayout = lazy(() => import('../features/analytics/AnalyticsLayout'));
const AnalyticsOverviewPage = lazy(() => import('../features/analytics/AnalyticsOverviewPage'));
const AnalyticsDelaysPage = lazy(() => import('../features/analytics/AnalyticsDelaysPage'));
const AnalyticsForecastPage = lazy(() => import('../features/analytics/AnalyticsForecastPage'));
const AnalyticsSuppliersPage = lazy(() => import('../features/analytics/AnalyticsSuppliersPage'));
const AnalyticsJobOrdersPage = lazy(() => import('../features/analytics/AnalyticsJobOrdersPage'));

function AnalyticsIndex() {
  const { user } = useAuth();
  return user?.role === 'ADMIN' ? <AnalyticsOverviewPage /> : <Navigate to="/analytics/sales" replace />;
}

function WorkerSetupFromUser() {
  const { id } = useParams();
  return <Navigate to={id ? `/worker-setup?tab=roster&worker=${id}` : '/worker-setup'} replace />;
}

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
        <NavMemoryProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/set-password" element={<SetPasswordPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            <Route element={<ProtectedRoute />}>
              <Route
                element={
                  <ProtectedRoute roles={['ADMIN', 'OFFICE_STAFF', 'PRODUCTION_WORKER']} />
                }
              >
                <Route path="/account/security" element={<AccountSecurityPage />} />
                <Route path="/job-orders/:id/print" element={<JobOrderPrintPage />} />
              </Route>
              <Route element={<ProtectedRoute roles={['ADMIN', 'OFFICE_STAFF']} />}>
                <Route
                  path="/job-orders/:id/invoice/print"
                  element={<SalesInvoicePrintPage />}
                />
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

                  <Route element={<ProtectedRoute roles={['ADMIN', 'OFFICE_STAFF']} />}>
                    <Route path="/job-orders" element={<JobOrderListPage />} />
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
                      <Route index element={<AnalyticsIndex />} />
                      <Route element={<ProtectedRoute roles={['ADMIN']} />}>
                        <Route path="delays" element={<AnalyticsDelaysPage />} />
                      </Route>
                      <Route path="sales" element={<AnalyticsJobOrdersPage />} />
                      <Route path="forecast" element={<AnalyticsForecastPage />} />
                      <Route path="suppliers" element={<AnalyticsSuppliersPage />} />
                      <Route path="efficiency" element={<Navigate to="/analytics" replace />} />
                      <Route path="capacity" element={<Navigate to="/analytics/forecast" replace />} />
                      <Route path="purchasing" element={<Navigate to="/analytics/suppliers" replace />} />
                    </Route>
                    <Route path="/tools" element={<ToolsPage />} />
                    <Route path="/clients" element={<ClientsPage />} />
                    <Route path="/clients/:id" element={<ClientDetailPage />} />
                    <Route path="/suppliers" element={<SuppliersPage />} />
                    <Route path="/supplier-orders" element={<SupplierOrdersPage />} />
                    <Route path="/supplier-orders/:id" element={<SupplierOrderDetailPage />} />
                    <Route path="/machines" element={<MachinesPage />} />
                    <Route path="/work-calendar" element={<WorkCalendarPage />} />
                    <Route path="/reports" element={<ReportsHubPage />} />
                    <Route path="/reports/inventory" element={<InventoryReportPage />} />
                  </Route>

                  <Route element={<ProtectedRoute roles={['ADMIN']} />}>
                    <Route path="/reports/efficiency" element={<EfficiencyReportPage />} />
                    <Route
                      path="/reports/worker-performance"
                      element={<WorkerPerformanceReportPage />}
                    />
                  </Route>

                  <Route element={<ProtectedRoute roles={['ADMIN']} />}>
                    <Route path="/job-orders/:id/plan" element={<JobOrderPlanningPage />} />
                    <Route path="/users" element={<UsersPage />} />
                    <Route path="/users/:id" element={<WorkerSetupFromUser />} />
                    <Route path="/worker-setup" element={<WorkerSetupPage />} />
                    <Route path="/attendance" element={<AttendancePage />} />
                    <Route
                      path="/settings/scoring-weights"
                      element={<Navigate to="/worker-setup" replace />}
                    />
                  </Route>

                  {/* After /new, /edit, /plan so :id does not steal those paths */}
                  <Route path="/job-orders/:id" element={<JobOrderDetailPage />} />

                  <Route element={<ProtectedRoute roles={['PRODUCTION_WORKER']} />}>
                    <Route path="/my-assignments" element={<MyAssignmentsPage />} />
                    <Route path="/my-assignments/:id" element={<AssignmentDetailPage />} />
                    <Route path="/scan" element={<ScanToolPage />} />
                    <Route path="/my-tools" element={<MyToolsPage />} />
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
