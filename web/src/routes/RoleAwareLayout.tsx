import { useAuth } from '../hooks/useAuth';
import AppLayout from '../layouts/AppLayout';
import WorkerLayout from '../layouts/WorkerLayout';

/**
 * Picks worker chrome vs admin/office chrome for routes both roles share
 * (schedule board, job order detail). Avoids duplicate path matches that
 * bounce workers off the office ProtectedRoute.
 */
export default function RoleAwareLayout() {
  const { isWorker } = useAuth();
  if (isWorker) return <WorkerLayout />;
  return <AppLayout />;
}
