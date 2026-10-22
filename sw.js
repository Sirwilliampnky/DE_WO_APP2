/* Workout v2 — service worker for offline use.
 * (v1 registered a worker from a blob: URL, which every browser rejects, so
 * offline support never actually worked.)
 * Strategy: precache the app shell on install; serve network-first with
 * cache fallback so updates arrive when online and the app still opens at
 * the gym with no signal. Bump VERSION (and the ?v= query strings in
 * index.html) when shipping a new version.
 *
 * Cache Storage is shared by the whole origin, not per worker — and GitHub
 * Pages serves every repository of an account from one origin. So this
 * app's caches are named by its scope, it only ever reads its own cache,
 * and activation deletes only its own older caches, never another app's.
 */
const VERSION = '8';
const SCOPE = self.registration.scope;
const CACHE_PREFIX = `workout-v2:${SCOPE}:`;
const CACHE_NAME = CACHE_PREFIX + VERSION;
/* Names used before caches were scoped (workout-v2-1 … workout-v2-6). */
const LEGACY_CACHE = /^workout-v2-\d+$/;
const APP_SHELL = [
  './',
  'index.html',
  'css/styles.css?v=8',
  'js/data.js?v=8',
  'js/app.js?v=8',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

/* An old-style name is only ours if it holds this scope's own app page. */
async function isOwnLegacyCache(name) {
  if (!LEGACY_CACHE.test(name)) return false;
  const requests = await (await caches.open(name)).keys();
  return requests.some(r => r.url === SCOPE || r.url === `${SCOPE}index.html`);
}

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(async name => {
      if (name === CACHE_NAME) return;
      if (name.startsWith(CACHE_PREFIX) || await isOwnLegacyCache(name)) await caches.delete(name);
    }));
    await self.clients.claim();
  })());
});

const NETWORK_TIMEOUT_MS = 4000;

async function cachedCopy(request) {
  const cache = await caches.open(CACHE_NAME);
  return cache.match(request);
}

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
    let response;
    try {
      // Weak gym signal shouldn't stall startup: fall back to the cache
      // after a few seconds instead of waiting on a hanging request.
      response = await Promise.race([
        networkFetch,
        new Promise((_, reject) => setTimeout(() => reject(new Error('network timeout')), NETWORK_TIMEOUT_MS)),
      ]);
    } catch (e) {
      return (await cachedCopy(event.request)) || networkFetch;
    }
    // An HTTP error (a 503 from a flaky connection, a 404 mid-deploy) for
    // something already cached: the known-good copy beats the error page.
    if (!response.ok && response.type !== 'opaque') {
      const cached = await cachedCopy(event.request);
      if (cached) return cached;
    }
    return response;
  })());
});
