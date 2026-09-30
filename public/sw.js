const CACHE_NAME = 'adpulse-ots-v3';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/claude-shim.js',
  '/config.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap'
];

// Install event: Pre-cache app shell assets and activate immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('Pre-caching warning:', err);
      });
    })
  );
});

// Activate event: Evict ALL old caches and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event: Network-First for everything, fallback to cache when offline
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Ignore non-GET requests (e.g. POST, PUT, DELETE for Supabase)
  if (req.method !== 'GET') {
    return;
  }

  // Network-only for Supabase auth / database / API calls / external storage
  if (
    url.hostname.includes('supabase.co') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/rest/') ||
    url.pathname.startsWith('/storage/') ||
    url.pathname.startsWith('/_blob/')
  ) {
    return;
  }

  // Network-First strategy: Always get fresh code from server if online, fallback to cache if offline
  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          return caches.match('/index.html') || caches.match('/');
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })
  );
});
