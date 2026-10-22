import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '@/lib/api';
import type { Permission, SessionUser } from '@/lib/types';

interface RegisterInput {
  name: string;
  email: string;
  password: string;
  rollNumber?: string;
  department?: string;
  year?: number;
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  register: (input: RegisterInput) => Promise<SessionUser>;
  logout: () => Promise<void>;
  setUser: (u: SessionUser) => void;
  /**
   * Whether the signed-in user holds a permission. For showing/hiding UI only — every action is
   * authorised again on the server, which is the actual security boundary.
   */
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);
export const ME_KEY = ['auth', 'me'] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await api.get<SessionUser>('/auth/me');
      } catch (e) {
        if (e instanceof ApiRequestError && (e.status === 401 || e.status === 403)) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const setUser = useCallback((u: SessionUser | null) => qc.setQueryData(ME_KEY, u), [qc]);

  // Any API call that discovers the session has expired signs the user out locally.
  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
    };
    window.addEventListener('ef:unauthorized', onUnauthorized);
    return () => window.removeEventListener('ef:unauthorized', onUnauthorized);
  }, [qc, setUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const u = await api.post<SessionUser>('/auth/login', { email, password });
      qc.clear();
      setUser(u);
      return u;
    },
    [qc, setUser],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const u = await api.post<SessionUser>('/auth/register', input);
      qc.clear();
      setUser(u);
      return u;
    },
    [qc, setUser],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      qc.clear();
      setUser(null);
    }
  }, [qc, setUser]);

  const user = data ?? null;
  const can = useCallback((permission: Permission) => !!user?.permissions?.includes(permission), [user]);

  return (
    <AuthContext.Provider value={{ user, loading: isLoading, login, register, logout, setUser, can }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
