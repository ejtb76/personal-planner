const CACHE_NAME = 'planner-v17';
const ASSETS = [
  '/personal-planner/',
  '/personal-planner/index.html',
  '/personal-planner/app.js',
  '/personal-planner/auth.js',
  '/personal-planner/sheets.js',
  '/personal-planner/calendar.js',
  '/personal-planner/ai.js',
  '/personal-planner/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network first for API calls, cache first for assets
  if (e.request.url.includes('googleapis.com') || e.request.url.includes('anthropic.com')) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
