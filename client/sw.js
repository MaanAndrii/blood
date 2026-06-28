const CACHE = 'health-v40';
const API_CACHE = 'health-api-v40';

const STATIC_SHELL = [
  '/offline.html',
  '/manifest.json',
  '/icons/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
];

// API GET routes to cache for offline reading
// /api/auth/me excluded — auth state must never be served from cache
const CACHED_API = ['/api/entries'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE && k !== API_CACHE)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // API requests
  if (url.pathname.startsWith('/api/')) {
    const shouldCache = request.method === 'GET' &&
      CACHED_API.some(p => url.pathname === p || url.pathname.startsWith(p + '?'));

    if (shouldCache) {
      // Network-first: update cache on success, serve stale when offline
      e.respondWith(
        fetch(request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(API_CACHE).then(c => c.put(request, clone));
          }
          return res;
        }).catch(() => caches.match(request))
      );
    }
    // Mutations and uncached API calls: network-only (no fallback)
    return;
  }

  // HTML navigation — bypass HTTP cache (content is auth-dependent)
  // Fall back to offline page if server is unreachable
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() =>
        caches.match('/offline.html')
      )
    );
    return;
  }

  // Static assets — cache-first, fetch and cache on miss (GET only)
  if (request.method !== 'GET') return;
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
        }
        return res;
      });
    })
  );
});

self.addEventListener('push', e => {
  if (!e.data) return;
  try {
    const { title, body, data } = e.data.json();
    e.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="36" fill="%231a2744"/><text y="130" x="96" text-anchor="middle" font-size="110">❤️</text></svg>',
        tag: 'health-reminder',
        renotify: true,
        data,
      })
    );
  } catch {}
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => new URL(c.url).pathname === '/');
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
