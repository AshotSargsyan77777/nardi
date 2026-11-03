/**
 * Service worker (served from the site root so its scope is the whole app).
 * - never touches the API or the WebSocket: game state is always live from the server
 * - static build assets and icons: cache-first (they are content-hashed)
 * - pages: network-first, falling back to an offline page
 * - Web Push: shows the notification; a tap opens (or focuses) the game at the right page
 */
const SW = `
const CACHE = 'nardi-v1';
const OFFLINE = '/offline';
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE)).catch(() => undefined));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io')) return;
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/pwa/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
  }
});
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'NARDI', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'NARDI', {
    body: d.body || '', icon: '/pwa/icon-192.png', badge: '/pwa/icon-192.png', tag: d.tag, renotify: true, data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { c.navigate(url).catch(() => undefined); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
`;

export const dynamic = 'force-static';

export function GET() {
  return new Response(SW, {
    headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-cache', 'service-worker-allowed': '/' },
  });
}
