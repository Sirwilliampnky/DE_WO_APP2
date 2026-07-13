/* Workout v2 — service worker for offline use.
 * (v1 registered a worker from a blob: URL, which every browser rejects, so
 * offline support never actually worked.)
 * Strategy: precache the app shell on install; serve network-first with
 * cache fallback so updates arrive when online and the app still opens at
 * the gym with no signal. Bump CACHE_NAME (and the ?v= query strings in
 * index.html) when shipping a new version.
 */
const CACHE_NAME = 'workout-v2-3';
const APP_SHELL = [
  './',
  'index.html',
  'css/styles.css?v=4',
  'js/data.js?v=4',
  'js/app.js?v=4',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // Only cache successful responses — a 404/500 or captive-portal page must
  // never overwrite a good cached copy of the app shell.
  const networkFetch = fetch(event.request).then(response => {
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
    }
    return response;
  });
  networkFetch.catch(() => { /* handled below; avoids an unhandled rejection when the timeout wins */ });
  event.respondWith((async () => {
    try {
      // Weak gym signal shouldn't stall startup: fall back to the cache
      // after a few seconds instead of waiting on a hanging request.
      return await Promise.race([
        networkFetch,
        new Promise((_, reject) => setTimeout(() => reject(new Error('network timeout')), NETWORK_TIMEOUT_MS)),
      ]);
    } catch (e) {
      const cached = await caches.match(event.request);
      return cached || networkFetch;
    }
  })());
});
