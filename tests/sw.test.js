/* Service-worker handler checks: sw.js runs in a simulated worker scope
 * (Cache Storage and fetch are in-memory fakes), so this needs only Node —
 * no browser or server. Covers cache ownership on activation and the
 * cached-copy fallback for network failures, timeouts and HTTP errors.
 * Usage: node tests/sw.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { check, section, finish } = require('./lib');

const SCOPE = 'https://example.github.io/DE_WO_APP2/';
const OTHER = 'https://example.github.io/notes-app/';
const href = r => (typeof r === 'string' ? new URL(r, SCOPE).href : r.url);

class FakeCache {
  constructor() { this.entries = new Map(); }
  async match(r) { const res = this.entries.get(href(r)); return res ? res.clone() : undefined; }
  async put(r, res) { this.entries.set(href(r), res); }
  async keys() { return [...this.entries.keys()].map(url => ({ url })); }
  async addAll(urls) { for (const u of urls) this.entries.set(href(u), new Response(`shell ${u}`)); }
}
class FakeCacheStorage {
  constructor() { this.caches = new Map(); }
  async open(name) { if (!this.caches.has(name)) this.caches.set(name, new FakeCache()); return this.caches.get(name); }
  async keys() { return [...this.caches.keys()]; }
  async delete(name) { return this.caches.delete(name); }
  async match(r) { for (const c of this.caches.values()) { const hit = await c.match(r); if (hit) return hit; } return undefined; }
}

/* Load sw.js into a fresh worker-like scope; `network(url)` plays the server. */
function loadWorker(cacheStorage, network) {
  const handlers = {};
  const self = {
    registration: { scope: SCOPE },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const context = vm.createContext({
    self, caches: cacheStorage, URL, Response, Request, Promise, console,
    fetch: async req => network(href(req)),
    // The 4-second network timeout, shortened so the suite runs quickly.
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 30)),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), context);
  return handlers;
}
async function runEvent(handler, extra = {}) {
  let waited = Promise.resolve(), responded = null;
  handler({ ...extra, waitUntil: p => { waited = p; }, respondWith: p => { responded = p; } });
  await waited;
  return responded ? await responded : undefined;
}
const get = url => ({ request: new Request(url) });

(async () => {
  section('10 · Activation deletes only this app’s own old caches');
  const store = new FakeCacheStorage();
  const seedCache = async (name, urls) => { const c = await store.open(name); for (const u of urls) await c.put(u, new Response('x')); };
  await seedCache('unrelated-notes-offline-v1', [`${OTHER}index.html`]);
  await seedCache('workout-v2-4', [`${OTHER}index.html`]);
  await seedCache('workout-v2-5', [`${SCOPE}index.html`, `${SCOPE}js/app.js?v=6`]);
  await seedCache(`workout-v2:${SCOPE}:7`, [`${SCOPE}index.html`]);
  await seedCache(`workout-v2:${OTHER}:7`, [`${OTHER}index.html`]);
  let handlers = loadWorker(store, async () => new Response('fresh'));
  await runEvent(handlers.install);
  await runEvent(handlers.activate);
  const names = await store.keys();
  const current = names.find(n => n.startsWith(`workout-v2:${SCOPE}:`));
  check('an unrelated app’s cache survives', names.includes('unrelated-notes-offline-v1'));
  check('another app’s old-style cache of the same name pattern survives', names.includes('workout-v2-4'));
  check('another copy’s scoped cache survives', names.includes(`workout-v2:${OTHER}:7`));
  check('this app’s pre-scoping cache is deleted', !names.includes('workout-v2-5'));
  check('this app’s older scoped cache is deleted', !names.includes(`workout-v2:${SCOPE}:7`));
  check('exactly one current cache remains for this scope', names.filter(n => n.startsWith(`workout-v2:${SCOPE}:`)).length === 1 && !!current);
  check('the current cache holds the app shell', !!(await (await store.open(current)).match(`${SCOPE}index.html`)));

  section('11 · A cached copy beats a network failure or an HTTP error');
  const shell = `${SCOPE}js/app.js?v=8`;
  const respondWith = async (status) => {
    handlers = loadWorker(store, async url => {
      if (status === 'reject') throw new TypeError('offline');
      if (status === 'hang') return new Promise(() => {});
      return new Response(status === 200 ? 'new build' : `error ${status}`, { status });
    });
    return runEvent(handlers.fetch, get(shell));
  };
  await (await store.open(current)).put(shell, new Response('known good'));
  check('network rejection → cached copy', (await (await respondWith('reject')).text()) === 'known good');
  check('network timeout → cached copy', (await (await respondWith('hang')).text()) === 'known good');
  check('HTTP 503 → cached copy, not the error', (await (await respondWith(503)).text()) === 'known good');
  check('HTTP 404 → cached copy, not the error', (await (await respondWith(404)).text()) === 'known good');
  const fresh = await respondWith(200);
  check('a successful response is served fresh', fresh.status === 200 && (await fresh.text()) === 'new build');
  await new Promise(r => setTimeout(r, 10));
  check('…and refreshes the cache', (await (await (await store.open(current)).match(shell)).text()) === 'new build');
  await (await store.open(current)).put(shell, new Response('known good'));
  await respondWith(503);
  check('an error response never overwrites the cached copy', (await (await (await store.open(current)).match(shell)).text()) === 'known good');
  handlers = loadWorker(store, async () => new Response('missing', { status: 404 }));
  const uncached = await runEvent(handlers.fetch, get(`${SCOPE}not-cached.js`));
  check('with nothing cached, the HTTP error is passed through', uncached.status === 404);
  await (await store.open('unrelated-notes-offline-v1')).put(`${SCOPE}borrowed.js`, new Response('someone else’s'));
  handlers = loadWorker(store, async () => { throw new TypeError('offline'); });
  let borrowed = 'not served';
  try { borrowed = await (await runEvent(handlers.fetch, get(`${SCOPE}borrowed.js`))).text(); } catch (e) { borrowed = 'network error'; }
  check('another app’s cache is never used as a fallback', borrowed === 'network error');

  finish();
})().catch(e => { console.error('TEST CRASHED:', e); process.exit(1); });
