const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api';
const CSRF_COOKIE = 'ef_csrf';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  [key: string]: unknown;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
    public details?: { fieldErrors?: Record<string, string[]>; problems?: string[]; [k: string]: unknown },
  ) {
    super(message);
  }
  /** First validation message for a field, if any. */
  field(name: string) {
    return this.details?.fieldErrors?.[name]?.[0];
  }
}

function readCookie(name: string) {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.split('=')[1];
}

let csrfInFlight: Promise<void> | null = null;
async function ensureCsrf(force = false) {
  if (!force && readCookie(CSRF_COOKIE)) return;
  csrfInFlight ??= fetch(`${BASE}/auth/csrf`, { credentials: 'include' })
    .then(() => undefined)
    .finally(() => {
      csrfInFlight = null;
    });
  await csrfInFlight;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Query = Record<string, string | number | boolean | undefined | null>;

export function buildQuery(q?: Query) {
  if (!q) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : '';
}

async function raw(method: Method, path: string, body?: unknown, retried = false): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') {
    await ensureCsrf();
    headers['X-CSRF-Token'] = decodeURIComponent(readCookie(CSRF_COOKIE) ?? '');
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, 'Network error. Check your connection and try again.', 'NETWORK_ERROR');
  }

  if (res.status === 403 && !retried && method !== 'GET') {
    const clone = res.clone();
    const payload = await clone.json().catch(() => null);
    if (payload?.error?.code === 'CSRF_INVALID') {
      await ensureCsrf(true);
      return raw(method, path, body, true);
    }
  }
  return res;
}

async function parse<T>(res: Response, path: string): Promise<{ data: T; meta?: PageMeta }> {
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload?.success) {
    const err = payload?.error ?? {};
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('ef:unauthorized'));
    throw new ApiRequestError(res.status, err.message ?? `Request failed (${res.status})`, err.code ?? 'ERROR', err.details);
  }
  return { data: payload.data as T, meta: payload.meta };
}

async function call<T>(method: Method, path: string, body?: unknown) {
  return (await parse<T>(await raw(method, path, body), path)).data;
}

export const api = {
  get: <T>(path: string, query?: Query) => call<T>('GET', `${path}${buildQuery(query)}`),
  post: <T>(path: string, body?: unknown) => call<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => call<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => call<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string) => call<T>('DELETE', path),

  /** GET a paginated collection, keeping the `meta` block. */
  async page<T>(path: string, query?: Query): Promise<Paginated<T>> {
    const p = `${path}${buildQuery(query)}`;
    const { data, meta } = await parse<T[]>(await raw('GET', p), p);
    return { data, meta: meta! };
  },

  /** Downloads a file (e.g. CSV export) through the authenticated session. */
  async download(path: string, fallbackName: string, query?: Query) {
    const res = await raw('GET', `${path}${buildQuery(query)}`);
    if (!res.ok) await parse(res, path);
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

export function errorMessage(err: unknown, fallback = 'Something went wrong') {
  if (err instanceof ApiRequestError) {
    const problems = err.details?.problems;
    return problems?.length ? `${err.message}: ${problems.join('; ')}` : err.message;
  }
  return err instanceof Error ? err.message : fallback;
}
