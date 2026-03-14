// BTC Terminal Service Worker — GitHub Pages edition
const CACHE = 'btc-terminal-v1';

// Build absolute shell URLs relative to this SW's scope
const base = self.registration.scope; // e.g. https://user.github.io/BTC-Dashboard/

const APP_SHELL = [
  base,
  base + 'manifest.json',
  base + 'icons/icon.svg',
];

const CDN_CACHE = 'btc-cdn-v1';
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    Promise.all([
      caches.open(CACHE).then(c => c.addAll(APP_SHELL).catch(() => {})),
      caches.open(CDN_CACHE).then(c => c.addAll(CDN_ASSETS).catch(() => {})),
    ])
  );
  self.skipWaiting();
});

// ── Activate: purge old caches ────────────────────────────────────────────────
self.addEventListener('activate', e => {
  const valid = new Set([CACHE, CDN_CACHE]);
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !valid.has(k)).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e;

  // Only handle GET requests (Anthropic POST calls pass through)
  if (request.method !== 'GET') return;

  const url = request.url;

  // External APIs (Binance, Blockchain.info) — network-first with cache fallback
  if (url.includes('api.binance.com') || url.includes('api.blockchain.info')) {
    e.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => {
              // Stamp with cache time for stale detection
              clone.json().then(body => {
                const stamped = new Response(JSON.stringify(body), {
                  status: 200,
                  headers: {
                    'Content-Type': 'application/json',
                    'sw-cached-at': Date.now().toString(),
                  },
                });
                c.put(request, stamped);
              }).catch(() => {});
            });
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) {
            const body = await cached.json().catch(() => null);
            if (body) {
              body.__stale = true;
              body.__cachedAt = cached.headers.get('sw-cached-at');
              return new Response(JSON.stringify(body), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
          }
          return new Response(JSON.stringify({ error: 'Offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        })
    );
    return;
  }

  // CDN assets — cache-first (versioned, never changes)
  if (CDN_ASSETS.includes(url)) {
    e.respondWith(
      caches.open(CDN_CACHE).then(c =>
        c.match(request).then(cached => {
          if (cached) return cached;
          return fetch(request).then(res => {
            if (res.ok) c.put(request, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }

  // App shell — stale-while-revalidate
  e.respondWith(
    caches.open(CACHE).then(c =>
      c.match(request).then(cached => {
        const network = fetch(request)
          .then(res => { if (res.ok) c.put(request, res.clone()); return res; })
          .catch(() => null);
        return cached || network;
      })
    )
  );
});

// ── Update message ────────────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
