// Adich Keri Vaa! offline support
const VERSION = 'akv-v3';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './privacy.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // live data (leaderboard, visitor counting) always goes to the network
  if (url.origin === location.origin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_vercel/'))) return;
  // Pages: try the network first so updates show up, fall back to the saved copy offline
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put('./index.html', copy)); return res; })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
    return;
  }
  // Everything else (icons, fonts, face-detection library): saved copy first, then network
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  })));
});
