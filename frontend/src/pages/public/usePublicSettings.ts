import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PublicSettings } from '@/lib/types';

/** Institution name and registration policy for the sign-in / sign-up screens (no authentication needed). */
export function usePublicSettings() {
  return useQuery({
    queryKey: ['public-settings'],
    queryFn: () => api.get<PublicSettings>('/auth/public-settings'),
    staleTime: 5 * 60_000,
  });
}
