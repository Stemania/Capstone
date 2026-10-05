import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from '../hooks/useAuth';
import { useNavMemory } from '../navigation/navMemory';
import type { UserRole } from '../types';

interface ProtectedRouteProps {
  roles?: UserRole[];
}

export function ProtectedRoute({ roles }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const { markDenied } = useNavMemory();

  if (loading) {
    return (
      <div className="page-spinner-fullscreen">
        <Spin size="large" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (roles && !roles.includes(user.role)) {
    const fallback = user.role === 'PRODUCTION_WORKER' ? '/my-assignments' : '/schedule';
    markDenied(`${location.pathname}${location.search}`);
    return <Navigate to={fallback} replace />;
  }

  return <Outlet />;
}
