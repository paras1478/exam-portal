import { api, ApiRequestError } from '@/lib/api';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api';
const CSRF_COOKIE = 'ef_csrf';

function readCookie(name: string) {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.split('=')[1];
}

/**
 * DELETE with a JSON body (the shared client's `api.delete` takes no body). Uses the same
 * double-submit CSRF scheme and error envelope as `lib/api.ts`.
 */
export async function deleteWithBody<T>(path: string, body: unknown): Promise<T> {
  if (!readCookie(CSRF_COOKIE)) await api.get('/auth/csrf');
  const send = async () => {
    try {
      return await fetch(`${BASE}${path}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-CSRF-Token': decodeURIComponent(readCookie(CSRF_COOKIE) ?? ''),
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiRequestError(0, 'Network error. Check your connection and try again.', 'NETWORK_ERROR');
    }
  };

  let res = await send();
  let payload = await res.json().catch(() => null);
  if (res.status === 403 && payload?.error?.code === 'CSRF_INVALID') {
    await api.get('/auth/csrf');
    res = await send();
    payload = await res.json().catch(() => null);
  }
  if (!res.ok || !payload?.success) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('ef:unauthorized'));
    const err = payload?.error ?? {};
    throw new ApiRequestError(res.status, err.message ?? `Request failed (${res.status})`, err.code ?? 'ERROR', err.details);
  }
  return payload.data as T;
}
