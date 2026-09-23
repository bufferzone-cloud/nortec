/* ═══════════════════════════════════════════════════════════════
   NORTEC Service Worker  ·  v1.1.0
   Fixes redirect loop: NEVER serves index.html for non-index pages.
   ═══════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'nortec-v1.1.0';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE   = `${CACHE_VERSION}-runtime`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './logo.png'
  // NOTE: do NOT precache student.html — it may not exist yet
];

/* ─────────── INSTALL ─────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => Promise.all(
        APP_SHELL.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
            console.warn('[SW] Skipped:', url, err.message);
          })
        )
      ))
      .then(() => self.skipWaiting())
  );
});

/* ─────────── ACTIVATE ─────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ─────────── FETCH ─────────── */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  if (!url.protocol.startsWith('http')) return;

  // ── Never intercept Firebase / Cloudinary API calls ──
  const host = url.hostname;
  if (
    host.includes('firebaseio.com') ||
    host.includes('firebaseapp.com') ||
    host.includes('identitytoolkit.googleapis.com') ||
    host.includes('securetoken.googleapis.com') ||
    host.includes('api.cloudinary.com') ||
    host.includes('upload-widget.cloudinary.com')
  ) {
    return; // let the browser handle it directly
  }

  /* ──────────────────────────────────────────────
     STRATEGY 1 — Same-origin navigation requests
     Key fix: only fall back to index.html for the
     index page itself, NOT for arbitrary pages
     like student.html (this was causing the loop).
     ────────────────────────────────────────────── */
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    const path = url.pathname;
    const isIndexPage =
      path.endsWith('/') ||
      path.endsWith('/index.html') ||
      path === '/nortec/';

    event.respondWith(
      fetch(req)
        .then((res) => {
          // ONLY cache successful responses — never cache 404s
          if (res && res.ok && res.status === 200) {
            const copy = res.clone();
            caches.open(APP_SHELL_CACHE)
              .then((c) => c.put(req, copy))
              .catch(() => {});
          }
          return res;
        })
        .catch(() => {
          // Network failed — try cache
          return caches.match(req).then((cached) => {
            if (cached) return cached;

            // Only serve the app shell for the index/root page
            if (isIndexPage) {
              return caches.match('./index.html').then((idx) =>
                idx || offlineResponse('You are offline')
              );
            }

            // For any other page (e.g. student.html), DON'T fall back to
            // index.html — that's what caused the infinite redirect loop.
            return offlineResponse('This page is not available offline.');
          });
        })
    );
    return;
  }

  /* ──────────────────────────────────────────────
     STRATEGY 2 — Same-origin static assets
     Cache-first with background refresh
     ────────────────────────────────────────────── */
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) {
          // Refresh in background
          fetch(req).then((res) => {
            if (res && res.ok && res.status === 200) {
              caches.open(APP_SHELL_CACHE)
                .then((c) => c.put(req, res.clone()))
                .catch(() => {});
            }
          }).catch(() => {});
          return cached;
        }
        return fetch(req).then((res) => {
          if (res && res.ok && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(APP_SHELL_CACHE)
              .then((c) => c.put(req, copy))
              .catch(() => {});
          }
          return res;
        });
      })
    );
    return;
  }

  /* ──────────────────────────────────────────────
     STRATEGY 3 — Cross-origin static (fonts, FA, CDN)
     Stale-while-revalidate
     ────────────────────────────────────────────── */
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
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

/* Helper: tiny offline fallback page */
function offlineResponse(message) {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Offline</title>
     <meta name="viewport" content="width=device-width,initial-scale=1">
     </head><body style="font-family:Inter,sans-serif;background:#070b14;color:#fff;
     display:flex;align-items:center;justify-content:center;height:100vh;margin:0;
     text-align:center;padding:24px">
     <div><h1 style="font-size:22px;margin-bottom:10px">Offline</h1>
     <p style="color:#94a3b8;font-size:14px">${message}</p></div>
     </body></html>`,
    { status: 503, headers: { 'Content-Type': 'text/html' } }
  );
}

/* ─────────── MESSAGES ─────────── */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
  }
});
