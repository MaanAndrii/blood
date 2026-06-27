const CACHE = 'health-v13';
const API_CACHE = 'health-api-v13';

const STATIC_SHELL = [
  '/',
  '/manifest.json',
  '/icons/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
];

// API GET routes to cache for offline reading
const CACHED_API = ['/api/entries', '/api/auth/me'];

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

  // HTML navigation — network-first, fall back to cached shell
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            caches.open(CACHE).then(c => c.put(request, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match('/') || caches.match(request))
    );
    return;
  }

  // Static assets — cache-first, fetch and cache on miss
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res.ok) {
          caches.open(CACHE).then(c => c.put(request, res.clone()));
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
