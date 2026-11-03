export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const readCookie = (name: string) => (typeof document === 'undefined' ? undefined : document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`))?.[1]);

let csrfPromise: Promise<void> | null = null;
async function ensureCsrf() {
  if (readCookie('bb_csrf')) return;
  csrfPromise ??= fetch('/api/auth/csrf', { credentials: 'same-origin' }).then(() => undefined).finally(() => (csrfPromise = null));
  await csrfPromise;
}

let refreshing: Promise<boolean> | null = null;
function refreshOnce() {
  refreshing ??= (async () => {
    await ensureCsrf();
    const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'x-csrf-token': readCookie('bb_csrf') ?? '' } });
    return r.ok;
  })().finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

const NO_REFRESH = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout', '/auth/csrf'];

/** Same-origin JSON client: adds the CSRF header and transparently refreshes an expired session once. */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  if (method !== 'GET') await ensureCsrf();
  const go = () =>
    fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-csrf-token': readCookie('bb_csrf') ?? '' } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  let res = await go();
  // an expired access token is renewed with the long-lived refresh cookie (also for /auth/me, so a
  // returning player stays signed in); only the sign-in endpoints themselves are never retried
  if (res.status === 401 && !NO_REFRESH.some((p) => path.startsWith(p))) {
    if (await refreshOnce()) res = await go();
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.code ?? 'ERROR', data?.message ?? res.statusText);
  return data as T;
}

export const fetcher = (path: string) => api(path);
export const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
