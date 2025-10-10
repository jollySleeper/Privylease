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
  if (url.pathname.includes('/releases') || url.pathname.includes('/download-url/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache successful responses with appropriate TTL
          if (response.ok) {
            const responseClone = response.clone();

            // For download URLs, add timestamp for 5-minute expiration
            const cacheResponse = url.pathname.includes('/download-url/')
              ? new Response(responseClone.body, {
                  status: responseClone.status,
                  statusText: responseClone.statusText,
                  headers: {
                    ...Object.fromEntries(responseClone.headers.entries()),
                    'sw-cache-timestamp': Date.now().toString(),
                    'sw-cache-ttl': (5 * 60 * 1000).toString() // 5 minutes
                  }
                })
              : responseClone;

            caches.open(API_CACHE).then(cache => {
              cache.put(event.request, cacheResponse);
            });
          }
          return response;
        })
        .catch(() => {
          // Check cache TTL for download URLs
          return caches.match(event.request).then(cachedResponse => {
            if (cachedResponse && url.pathname.includes('/download-url/')) {
              const cacheTimestamp = parseInt(cachedResponse.headers.get('sw-cache-timestamp') || '0');
              const cacheTTL = parseInt(cachedResponse.headers.get('sw-cache-ttl') || '0');
              const now = Date.now();

              if (now - cacheTimestamp > cacheTTL) {
                // Cache expired, don't use it
                return new Response(JSON.stringify({ error: 'Download URL expired' }), {
                  status: 410,
                  headers: { 'Content-Type': 'application/json' }
                });
              }
            }
            return cachedResponse;
          });
        })
    );
    return;
  }

  // Default - Network first for everything else
  event.respondWith(fetch(event.request));
});

// Handle background sync for failed downloads
self.addEventListener('sync', event => {
  if (event.tag === 'retry-failed-downloads') {
    event.waitUntil(retryFailedDownloads());
  }
});

// Handle messages from main thread for cache clearing and download retry
self.addEventListener('message', event => {
  if (event.data.action === 'clear-cache') {
    caches.delete(API_CACHE);
    event.ports[0].postMessage({success: true});
  } else if (event.data.action === 'retry-downloads') {
    retryFailedDownloads();
  }
});

// Retry failed downloads when connection is restored
async function retryFailedDownloads() {
  try {
    // Get stored failed downloads from IndexedDB or similar
    // For now, we'll implement a simple retry mechanism
    console.log('Retrying failed downloads...');

    // This would typically check for stored failed download URLs
    // and retry them. For PrivyLease, we could store failed asset downloads
    // and retry them when connectivity is restored.

    // Placeholder implementation - in a real app, you'd:
    // 1. Check IndexedDB for failed downloads
    // 2. Retry each failed download
    // 3. Update UI when successful
    // 4. Remove from failed list

    console.log('Background sync completed');
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}
