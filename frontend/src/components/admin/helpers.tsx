import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/primitives';
import type { Role } from '@/lib/types';

export const roleLabel: Record<Role, string> = { STUDENT: 'Student', FACULTY: 'Faculty', ADMIN: 'Admin' };

export function RoleBadge({ role }: { role: Role }) {
  const variant = ({ STUDENT: 'default', FACULTY: 'violet', ADMIN: 'warning' } as const)[role];
  return <Badge variant={variant}>{roleLabel[role]}</Badge>;
}

/** "USER_ROLE_CHANGED" → "User role changed" */
export function humanizeAction(action: string) {
  const s = action.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function actionVariant(action: string) {
  if (/FAILED|SUSPEND|DELETED|ARCHIVED/.test(action)) return 'destructive' as const;
  if (/CREATED|REGISTERED|PUBLISHED|RESTORED|BOOTSTRAPPED/.test(action)) return 'success' as const;
  if (/ROLE|STATUS|PASSWORD/.test(action)) return 'warning' as const;
  if (/LOGIN/.test(action)) return 'muted' as const;
  return 'default' as const;
}

/**
 * Reads/writes list filters in the URL so they survive reloads and can be shared.
 * Changing any filter other than `page` resets to page 1.
 */
export function useUrlFilters<K extends string>(defaults: Record<K, string>) {
  const [params, setParams] = useSearchParams();
  const values = Object.fromEntries(
    (Object.keys(defaults) as K[]).map((k) => [k, params.get(k) ?? defaults[k]]),
  ) as Record<K, string>;

  const set = useCallback(
    (key: K, value: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === '' || value === defaults[key]) next.delete(key);
          else next.set(key, value);
          if (key !== 'page') next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams],
  );
  return [values, set] as const;
}

/** Select value used for "no filter" (Radix Select cannot use an empty string). */
export const ALL = 'all';
export const orUndefined = (v: string) => (v === ALL || v === '' ? undefined : v);
