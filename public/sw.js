/* Service Worker para EntradasJujuy Scanner PWA.
 * Estrategia:
 * - Pre-cachea el shell del escáner y la lib jsQR para uso offline
 * - Network-first para llamadas a la API (con fallback a cache vacío)
 * - Cache-first para assets estáticos
 */

const CACHE_VERSION = 'ej-scanner-v2';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const SHELL_URLS = [
  '/escaner.html',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg',
  /* jsQR — librería que usamos para decodificar QR en iOS y otros browsers
     sin BarcodeDetector. Lo precacheamos así funciona offline. */
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      /* addAll falla todo si un solo recurso falla. Usamos add() individual
         con catch para que la instalación funcione aunque algún CDN esté caído. */
      return Promise.all(
        SHELL_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] No se pudo cachear', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; /* No cachear POST/PUT/DELETE */

  const url = new URL(req.url);

  /* Llamadas a la API: network-first. Si no hay red, devolver respuesta de
     "offline" para que el frontend sepa que debe usar el cache local. */
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() =>
        new Response(JSON.stringify({ ok: false, offline: true, error: 'Sin conexión' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  /* Shell URLs y assets: cache-first */
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        /* Solo cachear respuestas OK del mismo origen + CDN de jsQR */
        if (res && res.ok && (url.origin === self.location.origin || url.host.includes('jsdelivr'))) {
          const clone = res.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, clone)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match('/escaner.html'));
    })
  );
});

/* Mensaje de update — el frontend puede pedirle que cambie de versión */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
