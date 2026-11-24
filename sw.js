// Offline support: network first (always fresh when online), cached copy when offline.
const CACHE = 'bp-snap-v4';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/stats.js', 'js/chart.js', 'js/exif.js', 'js/image.js',
  'js/merge.js', 'js/sync.js', 'js/words.js', 'js/config.js',
  'js/ocr/client.js', 'js/ocr/worker.js', 'js/ocr/sevenseg.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first (bypassing the HTTP cache so one deploy never mixes old and new files),
// but fall back to the cached copy after 3 s on a weak signal.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // A navigation Request can't be re-created with options, so fetch its URL instead.
  const fresh = req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(req, { cache: 'no-cache' });
  const net = fetch(fresh).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  });
  const cached = () => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : null));
  const slow = new Promise((resolve) => setTimeout(resolve, 3000)).then(cached);
  e.respondWith(
    Promise.race([net.catch(() => cached()), slow.then((hit) => hit || net)])
      .then((res) => res || net)
      .catch(() => cached().then((hit) => hit || Response.error())),
  );
});
