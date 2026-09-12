const CACHE_NAME = 'ciel-hub-cache-v3.5.0';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/styles.css?v=3.5.0',
  './js/crypto.js?v=3.5.0',
  './js/github.js?v=3.5.0',
  './js/ai.js?v=3.5.0',
  './js/app.js?v=3.5.0',
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
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Purge de l\'ancien cache :', k);
          return caches.delete(k);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Ignorer les requêtes non-GET et les requêtes vers l'API GitHub
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('api.github.com') || event.request.url.includes('raw.githubusercontent.com')) return;

  // Stratégie Network-First avec repli sur le Cache pour garantir la mise à jour immédiate
  event.respondWith(
    fetch(event.request).then(networkResponse => {
      if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseToCache);
        });
      }
      return networkResponse;
    }).catch(() => {
      return caches.match(event.request);
    })
  );
});
