/* iSMART service worker
 * - Pages and scripts: network first (you always get your latest version),
 *   falling back to the saved copy when there is no connection.
 * - Supabase and CDN requests are never touched.
 * Bump VERSION when you add or rename files. */
const VERSION = 'ismart-v1';
const SHELL = [
  './', 'index.html', 'dashboard.html', 'assets.html', 'borrow.html', 'return.html',
  'students.html', 'activity.html', 'settings.html', 'nav.css', 'notifications.js', 'pwa.js',
  'manifest.webmanifest', 'offline.html',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      // one missing file must not break the whole install
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase, fonts, CDNs: not ours

  event.respondWith(
    fetch(req, { cache: 'no-cache' })                // revalidate so GitHub's 10-minute cache never shows stale pages
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then(hit => {
          if (hit) return hit;
          if (req.mode === 'navigate') return caches.match('offline.html');
          return Response.error();
        })
      )
  );
});
