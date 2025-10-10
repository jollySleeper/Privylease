// Cache version - INCREMENT THIS for urgent hotfixes (e.g., 'v1.0.1')
const CACHE_VERSION = 'v1.0.0'; // ← Change this number for force refresh

const STATIC_CACHE = `privylease-static-${CACHE_VERSION}`;
const API_CACHE = `privylease-api-${CACHE_VERSION}`;

self.addEventListener('install', event => {
  console.log('Service Worker installing');
  self.skipWaiting(); // Force activation immediately

  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.addAll([
        '/index.html',
        '/styles/main.css',
        '/scripts/app.js'
      ]);
    })
  );
});

self.addEventListener('activate', event => {
  console.log('Service Worker activating');

  // Clean up old caches on version change
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== STATIC_CACHE && cacheName !== API_CACHE) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );

  // Take control immediately
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Static assets - Cache First strategy
  if (url.pathname.match(/\.(html|css|js)$/)) {
    event.respondWith(
      caches.match(event.request)
        .then(response => response || fetch(event.request))
    );
    return;
  }

  // API calls - Network First with cache fallback
  if (url.pathname.includes('/releases')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache successful responses
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(API_CACHE).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache if network fails
          return caches.match(event.request);
        })
    );
    return;
  }

  // Default - Network first for everything else
  event.respondWith(fetch(event.request));
});

// Handle messages from main thread for cache clearing
self.addEventListener('message', event => {
  if (event.data.action === 'clear-cache') {
    caches.delete(API_CACHE);
    event.ports[0].postMessage({success: true});
  }
});
