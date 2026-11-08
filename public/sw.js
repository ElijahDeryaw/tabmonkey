// TabMonkey offline support. scripts/build.js fills in VERSION and SHELL (the app's files, version-stamped).
// - The app shell is precached, so the app opens instantly and offline.
// - The page itself is network-first (new deploys show up), falling back to the cached copy offline.
// - alphaTab, its fonts, the soundfont and Google Fonts are cached the first time they're used.
// Song data is cached by the app itself (songs.js), so songs you've opened work offline too.
const VERSION = '__VERSION__';
const SHELL = __SHELL__;
const SHELL_CACHE = `tm-shell-${VERSION}`;
const ASSETS = 'tm-assets-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('tm-shell-') && k !== SHELL_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === location.origin;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req, { signal: AbortSignal.timeout(4000) });
        (await caches.open(SHELL_CACHE)).put('./', res.clone());
        return res;
      } catch {
        return (await caches.match('./')) || (await caches.match('index.html')) || Response.error();
      }
    })());
    return;
  }
  // Big, rarely-changing files: cache on first use.
  const cacheFirst = (same && /\/(alphatab|soundfont|vendor)\//.test(url.pathname)) || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (cacheFirst) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') (await caches.open(ASSETS)).put(req, res.clone());
      return res;
    })());
    return;
  }
  // App files: version-stamped, so the cache is always right; fall back to the network.
  if (same) e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
