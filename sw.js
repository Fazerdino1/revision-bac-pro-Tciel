const CACHE_NAME = 'ciel-hub-cache-v3.3.0';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/styles.css?v=3.3.0',
  './js/crypto.js?v=3.3.0',
  './js/github.js?v=3.3.0',
  './js/app.js?v=3.3.0',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Ignorer les appels API GitHub en écriture (PUT, POST)
  if (event.request.method !== 'GET') return;

  // Stratégie Stale-While-Revalidate pour les assets statiques
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
