const CACHE_NAME = 'nortec-pwa-v1';
const urlsToCache = [
  '/',
  '/welcome.html',
  'logo.png',
  'home.webp',
  'teveta.png',
  'manifest.json'
];

// Install event - cache the core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[ServiceWorker] Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .catch(err => console.error('[ServiceWorker] Install error:', err))
  );
  self.skipWaiting(); // Activate immediately
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keyList => {
      return Promise.all(keyList.map(key => {
        if (key !== CACHE_NAME) {
          console.log('[ServiceWorker] Removing old cache:', key);
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim(); // Take control of all clients
});

// Fetch event - cache-first strategy
self.addEventListener('fetch', event => {
  // Only handle GET requests for our own domain/scope
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          // Return cached asset
          return response;
        }

        // If not in cache, fetch from network and cache it for future
        return fetch(event.request)
          .then(networkResponse => {
            // Check if we received a valid response
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }

            // Clone the response to store in cache and return the original
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                // Only cache same-origin requests to avoid bloating with external CDNs
                const url = new URL(event.request.url);
                if (url.origin === location.origin) {
                  cache.put(event.request, responseToCache);
                }
              });

            return networkResponse;
          })
          .catch(err => {
            console.warn('[ServiceWorker] Fetch failed:', err);
            // Optionally return a fallback offline page if needed
          });
      })
  );
});
