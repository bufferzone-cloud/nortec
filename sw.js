/* ═══════════════════════════════════════════════════════════════
   NORTEC Service Worker
   Strategy:
     • App shell (HTML, logo, manifest) → cache-first, fallback to network
     • Static CDN (fonts, FA, Firebase SDK, Cloudinary) → stale-while-revalidate
     • Firebase / Cloudinary API calls → network-only (never cached)
   ═══════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'nortec-v1.0.0';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE   = `${CACHE_VERSION}-runtime`;

/* Files cached on install — add real image names if you have more assets */
const APP_SHELL = [
  './',
  './index.html',
  './student.html',
  './manifest.json',
  './logo.png',
  './home.webp'
];

/* Domains we should never cache (auth, realtime DB, uploads) */
const NEVER_CACHE = [
  'firebaseio.com',
  'firebaseapp.com',
  'googleapis.com/identitytoolkit',
  'securetoken.googleapis.com',
  'cloudinary.com/v1_1',
  'upload-widget.cloudinary.com'
];

/* ─────────── INSTALL ─────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => {
        // Use individual add() so one missing file doesn't break the whole install
        return Promise.all(
          APP_SHELL.map((url) =>
            cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
              console.warn('[SW] Skipped caching:', url, err.message);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

/* ─────────── ACTIVATE ─────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ─────────── FETCH ─────────── */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Skip non-http(s) schemes (chrome-extension, etc.)
  if (!url.protocol.startsWith('http')) return;

  // Never cache Firebase / Cloudinary API calls
  if (NEVER_CACHE.some((host) => url.hostname.includes(host.split('/')[0]) && url.href.includes(host.split('/').slice(1).join('/') || ''))) {
    return; // let the browser handle it directly
  }
  if (url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('firebaseapp.com') ||
      url.hostname.includes('securetoken.googleapis.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('api.cloudinary.com')) {
    return;
  }

  // ── 1. Same-origin navigation requests → app shell fallback ──
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(APP_SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // ── 2. Same-origin static assets → cache-first ──
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) {
          // Refresh in background
          fetch(req).then((res) => {
            if (res && res.status === 200) {
              caches.open(APP_SHELL_CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
            }
          }).catch(() => {});
          return cached;
        }
        return fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(APP_SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        });
      })
    );
    return;
  }

  // ── 3. Cross-origin static (fonts, FA, Cloudinary widget) → stale-while-revalidate ──
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && (res.status === 200 || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});

/* ─────────── MESSAGES (force update) ─────────── */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
  }
});
