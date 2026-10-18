/*
 * Service worker do Finah: só instalabilidade e cache dos assets versionados do Next.
 * Páginas e dados sempre vêm da rede (o app não precisa funcionar offline).
 */
const CACHE = 'finah-static-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // /_next/static/* tem hash no nome: cache-first é seguro.
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/_next/static/')) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }),
  );
});
