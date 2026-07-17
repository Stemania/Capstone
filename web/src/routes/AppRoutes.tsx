import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '../hooks/useAuth';
import { ProtectedRoute } from './ProtectedRoute';
import AppLayout from '../layouts/AppLayout';
import LoginPage from '../features/auth/LoginPage';
import JobOrderListPage from '../features/job-orders/JobOrderListPage';
import JobOrderFormPage from '../features/job-orders/JobOrderFormPage';
import MyAssignmentsPage from '../features/my-assignments/MyAssignmentsPage';
import AssignmentDetailPage from '../features/my-assignments/AssignmentDetailPage';
import UsersPage from '../features/users/UsersPage';
import ToolsPage from '../features/tool-tracking/ToolsPage';
import ToolEventsPage from '../features/tool-tracking/ToolEventsPage';
import ScanToolPage from '../features/tool-tracking/ScanToolPage';

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
              </Route>

              <Route element={<ProtectedRoute roles={['ADMIN']} />}>
                <Route path="/users" element={<UsersPage />} />
                <Route path="/tools" element={<ToolsPage />} />
                <Route path="/tool-events" element={<ToolEventsPage />} />
              </Route>

              <Route element={<ProtectedRoute roles={['PRODUCTION_WORKER']} />}>
                <Route path="/my-assignments" element={<MyAssignmentsPage />} />
                <Route path="/my-assignments/:id" element={<AssignmentDetailPage />} />
                <Route path="/scan" element={<ScanToolPage />} />
              </Route>

              <Route path="/" element={<Navigate to="/login" replace />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
