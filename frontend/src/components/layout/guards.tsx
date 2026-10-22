import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import type { Role } from '@/lib/types';
import { roleHome } from '@/lib/utils';
import { FullPageLoader } from '@/components/common';

/**
 * Client-side route guard for UX only — every protected API call is authorised on the server.
 */
export function RequireAuth({ roles, children }: { roles?: Role[]; children?: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to={roleHome[user.role]} replace />;
  return children ? <>{children}</> : <Outlet />;
}

/** Sends signed-in users away from login/register to their home dashboard. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (user) return <Navigate to={roleHome[user.role]} replace />;
  return <>{children}</>;
}
