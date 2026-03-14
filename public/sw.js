// BTC Terminal Service Worker
const CACHE_NAME = 'btc-terminal-v1';
const STATIC_CACHE = 'btc-static-v1';

// App shell — pre-cached on install
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable.png',
];

// Long-lived CDN assets
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
];

// ── Install: pre-cache app shell ─────────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((c) => c.addAll(APP_SHELL).catch(() => {})),
      caches.open(STATIC_CACHE).then((c) => c.addAll(CDN_ASSETS).catch(() => {})),
    ])
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ───────────────────────────────────────────────
self.addEventListener('activate', (e) => {
  const valid = new Set([CACHE_NAME, STATIC_CACHE]);
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !valid.has(k)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch strategy ───────────────────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Skip non-GET (POST /api/predict, /api/backtest pass through)
  if (request.method !== 'GET') return;

  // CDN assets → cache-first (immutable versioned files)
  if (CDN_ASSETS.includes(request.url)) {
    e.respondWith(
      caches.open(STATIC_CACHE).then((c) =>
        c.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((res) => {
            c.put(request, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }

  // GET /api/market → network-first; cache fallback with stale banner
  if (url.pathname === '/api/market') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => {
            // Store with a timestamp header for stale detection
            const headers = new Headers(clone.headers);
            headers.set('sw-cached-at', Date.now().toString());
            clone.json().then((body) => {
              const stamped = new Response(JSON.stringify(body), {
                status: clone.status,
                headers,
              });
              c.put(request, stamped);
            });
          });
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) {
            // Inject a stale flag so the UI can show an offline notice
            const body = await cached.json();
            const cachedAt = cached.headers.get('sw-cached-at');
            body.__stale = true;
            body.__cachedAt = cachedAt ? parseInt(cachedAt) : null;
            return new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ error: 'Offline and no cached data.' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        })
    );
    return;
  }

  // App shell (HTML, icons, manifest) → stale-while-revalidate
  e.respondWith(
    caches.open(CACHE_NAME).then((c) =>
      c.match(request).then((cached) => {
        const network = fetch(request)
          .then((res) => {
            if (res.ok) c.put(request, res.clone());
            return res;
          })
          .catch(() => null);
        return cached || network;
      })
    )
  );
});

// ── Background sync message handler ─────────────────────────────────────────
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
